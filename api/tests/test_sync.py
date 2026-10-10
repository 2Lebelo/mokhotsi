"""Device sync: POST/GET /api/v1/shops/{shop_id}/sync/{push,pull} against a real MongoDB."""

import base64
import struct
from typing import Any
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from tests.helpers import (
    ADMIN_EMAIL,
    ADMIN_PASSWORD,
    V1,
    admin_headers,
    bearer,
    create_keeper,
    create_sitter,
    error_code,
    login,
)

pytestmark = pytest.mark.requires_mongo

NOW = "2026-10-06T09:15:00Z"
DEVICE = str(uuid4())


def _id() -> str:
    return str(uuid4())


def product_op(product_id: str, name: str = "Maize meal 2.5kg", **overrides: Any) -> dict[str, Any]:
    payload = {
        "id": product_id,
        "name": name,
        "price_cents": 4599,
        "barcode": None,
        "deleted": False,
        "updated_at": NOW,
        **overrides,
    }
    return {
        "op_id": _id(),
        "entity": "products",
        "entity_id": product_id,
        "op": "upsert",
        "payload": payload,
    }


def embedding_op(embedding_id: str, product_id: str, dim: int = 4) -> dict[str, Any]:
    vector = base64.b64encode(struct.pack(f"<{dim}f", 1.0, *([0.0] * (dim - 1)))).decode()
    return {
        "op_id": _id(),
        "entity": "embeddings",
        "entity_id": embedding_id,
        "op": "upsert",
        "payload": {
            "id": embedding_id,
            "product_id": product_id,
            "vector_b64": vector,
            "dim": dim,
            "model_version": "test@1",
            "deleted": False,
            "created_at": NOW,
        },
    }


def sale_op(
    sale_id: str, device_id: str, product_id: str, qty: int = 2, total: int | None = None
) -> dict[str, Any]:
    return {
        "op_id": _id(),
        "entity": "sales",
        "entity_id": sale_id,
        "op": "upsert",
        "payload": {
            "id": sale_id,
            "device_id": device_id,
            "total_cents": qty * 4599 if total is None else total,
            "items": [
                {
                    "id": _id(),
                    "product_id": product_id,
                    "qty": qty,
                    "unit_price_cents": 4599,
                    "match_score": None,
                    "match_method": "manual",
                }
            ],
            "deleted": False,
            "created_at": NOW,
        },
    }


def push(
    client: TestClient, headers: dict[str, str], shop_id: str, ops: list[dict[str, Any]]
) -> Any:
    return client.post(
        f"{V1}/shops/{shop_id}/sync/push",
        json={"device_id": DEVICE, "ops": ops},
        headers=headers,
    )


def pushed(
    client: TestClient, headers: dict[str, str], shop_id: str, ops: list[dict[str, Any]]
) -> dict[str, Any]:
    response = push(client, headers, shop_id, ops)
    assert response.status_code == 200, response.text
    return response.json()


def pull(
    client: TestClient, headers: dict[str, str], shop_id: str, cursor: str = "", limit: int = 500
) -> dict[str, Any]:
    response = client.get(
        f"{V1}/shops/{shop_id}/sync/pull",
        params={"cursor": cursor, "limit": limit},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    return response.json()


def admin_headers_again(client: TestClient) -> dict[str, str]:
    """Admin headers once the admin exists (`admin_headers` inserts it)."""
    return bearer(login(client, ADMIN_EMAIL, ADMIN_PASSWORD)["access_token"])


@pytest.fixture
def keeper(client: TestClient, mongo: Any) -> tuple[dict[str, str], str]:
    _, headers, shop_id = create_keeper(client, admin_headers(client, mongo))
    assert shop_id is not None
    return headers, shop_id


def test_same_op_pushed_twice_is_written_once(client: TestClient, mongo: Any, keeper) -> None:
    headers, shop_id = keeper
    op = product_op(_id())
    first = pushed(client, headers, shop_id, [op])
    second = pushed(client, headers, shop_id, [op])
    assert first == second == {"acked": [op["op_id"]], "rejected": []}
    assert mongo["products"].count_documents({}) == 1
    assert mongo["counters"].find_one()["seq"] == 1  # The replay reserved no seq.
    assert mongo["applied_ops"].count_documents({}) == 1
    # The same op twice in ONE request is also applied once.
    again = product_op(_id())
    assert pushed(client, headers, shop_id, [again, again])["acked"] == [again["op_id"]]
    assert mongo["products"].count_documents({}) == 2


def test_shop_comes_from_the_path_and_membership_not_the_body(
    client: TestClient, mongo: Any, keeper
) -> None:
    headers, shop_id = keeper
    _, other_headers, other_shop = create_keeper(client, admin_headers_again(client))
    assert other_shop is not None

    # A shop_id smuggled into the payload is refused (contract records have no shop_id).
    sneaky = product_op(_id(), shop_id=other_shop)
    body = pushed(client, headers, shop_id, [sneaky])
    assert body["acked"] == []
    assert body["rejected"][0]["reason"].startswith("invalid_payload")

    # Pushing to a shop you are not a member of looks like it does not exist.
    response = push(client, headers, other_shop, [product_op(_id())])
    assert response.status_code == 404
    assert error_code(response) == "not_found"
    assert mongo["products"].count_documents({}) == 0

    # An id that already belongs to another shop cannot be taken over.
    product_id = _id()
    pushed(client, other_headers, other_shop, [product_op(product_id)])
    takeover = pushed(client, headers, shop_id, [product_op(product_id, name="Mine now")])
    assert takeover["rejected"][0]["reason"].startswith("id_conflict")
    doc = mongo["products"].find_one()
    assert str(doc["shop_id"]) == other_shop
    assert doc["name"] == "Maize meal 2.5kg"


def test_pull_pages_by_cursor_and_returns_soft_deletes(client: TestClient, keeper) -> None:
    headers, shop_id = keeper
    p1, p2, e1 = _id(), _id(), _id()
    pushed(
        client,
        headers,
        shop_id,
        [product_op(p1), product_op(p2, name="Sugar 1kg"), embedding_op(e1, p1)],
    )
    delete = {"op_id": _id(), "entity": "products", "entity_id": p1, "op": "delete", "payload": {}}
    assert pushed(client, headers, shop_id, [delete])["rejected"] == []

    # seqs: p1=1, p2=2, e1=3. A change takes a new seq, so after the delete the shop holds
    # p2=2, p1=4 (soft-deleted) and e1=5 (soft-deleted with its product).
    page1 = pull(client, headers, shop_id, limit=2)
    assert [p["id"] for p in page1["changes"]["products"]] == [p2, p1]
    assert page1["changes"]["products"][1]["deleted"] is True
    assert page1["changes"]["products"][1]["seq"] == 4
    assert page1["changes"]["embeddings"] == []
    assert page1["has_more"] is True
    assert page1["next_cursor"] == "4"

    page2 = pull(client, headers, shop_id, cursor=page1["next_cursor"], limit=2)
    assert page2["has_more"] is False
    assert page2["next_cursor"] == "5"
    assert page2["changes"]["products"] == []
    embedding = page2["changes"]["embeddings"][0]
    assert embedding["id"] == e1
    assert embedding["deleted"] is True
    assert struct.unpack("<4f", base64.b64decode(embedding["vector_b64"])) == (1.0, 0, 0, 0)

    # An empty page keeps the cursor; an overlapping (smaller) cursor re-reads safely.
    assert pull(client, headers, shop_id, cursor="5")["next_cursor"] == "5"
    overlap = pull(client, headers, shop_id, cursor=str(max(0, 5 - 50)))
    assert {p["id"] for p in overlap["changes"]["products"]} == {p1, p2}

    bad = client.get(f"{V1}/shops/{shop_id}/sync/pull?cursor=abc", headers=headers)
    assert bad.status_code == 400
    assert error_code(bad) == "invalid_cursor"


def test_a_shop_never_reads_another_shops_data(client: TestClient, keeper) -> None:
    headers, shop_id = keeper
    _, other_headers, other_shop = create_keeper(client, admin_headers_again(client))
    assert other_shop is not None
    product_id = _id()
    pushed(client, other_headers, other_shop, [product_op(product_id)])
    pushed(client, other_headers, other_shop, [sale_op(_id(), DEVICE, product_id)])

    mine = pull(client, headers, shop_id)
    assert mine["changes"] == {"products": [], "embeddings": [], "sales": []}
    assert client.get(f"{V1}/shops/{other_shop}/sync/pull", headers=headers).status_code == 404

    # A sale in my shop that references the other shop's product is refused.
    body = pushed(client, headers, shop_id, [sale_op(_id(), DEVICE, product_id)])
    assert body["rejected"][0]["reason"].startswith("unknown_product")


def test_sitter_can_sell_but_not_edit_the_catalogue(client: TestClient, keeper) -> None:
    headers, shop_id = keeper
    product_id = _id()
    pushed(client, headers, shop_id, [product_op(product_id)])
    _, sitter = create_sitter(client, headers, shop_id)

    sale = sale_op(_id(), DEVICE, product_id)
    edit = product_op(product_id, name="Cheaper", price_cents=1)
    body = pushed(client, sitter, shop_id, [edit, sale])
    assert body["acked"] == [sale["op_id"]]
    assert body["rejected"][0]["op_id"] == edit["op_id"]
    assert body["rejected"][0]["reason"].startswith("permission_denied")

    # Without sales:read a sitter only pulls back their own sales.
    pushed(client, headers, shop_id, [sale_op(_id(), DEVICE, product_id)])
    sitter_view = pull(client, sitter, shop_id)
    assert [s["id"] for s in sitter_view["changes"]["sales"]] == [sale["entity_id"]]
    assert len(pull(client, headers, shop_id)["changes"]["sales"]) == 2


def test_sales_are_insert_only_and_must_add_up(client: TestClient, mongo: Any, keeper) -> None:
    headers, shop_id = keeper
    product_id, sale_id = _id(), _id()
    pushed(client, headers, shop_id, [product_op(product_id)])
    assert (
        pushed(client, headers, shop_id, [sale_op(sale_id, DEVICE, product_id)])["rejected"] == []
    )

    # A second upsert of the same sale (new op_id, different total) is acked but changes nothing.
    changed = sale_op(sale_id, DEVICE, product_id, qty=5)
    assert pushed(client, headers, shop_id, [changed])["acked"] == [changed["op_id"]]
    assert mongo["sales"].find_one()["total_cents"] == 2 * 4599

    delete = {
        "op_id": _id(),
        "entity": "sales",
        "entity_id": sale_id,
        "op": "delete",
        "payload": {},
    }
    assert pushed(client, headers, shop_id, [delete])["rejected"][0]["reason"].startswith(
        "insert_only"
    )

    wrong_total = sale_op(_id(), DEVICE, product_id, total=1)
    reason = pushed(client, headers, shop_id, [wrong_total])["rejected"][0]["reason"]
    assert reason.startswith("total_mismatch")

    # Every accepted change is in the shop's audit log with the device that sent it.
    entries = list(mongo["audit_logs"].find({"action": "sale.created"}))
    assert len(entries) == 1
    assert str(entries[0]["device_id"]) == DEVICE
    assert mongo["devices"].find_one({})["_id"] is not None
