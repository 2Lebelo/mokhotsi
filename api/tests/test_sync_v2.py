"""Sync v2 (contracts/sync.v2.schema.json): device auth, push, pull, snapshot and photos."""

import base64
import hashlib
import struct
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

import pytest
from cloudinary import utils

from tests.helpers import (
    V1,
    admin_headers,
    create_cashier,
    create_owner,
    device_headers,
    error_code,
)

pytestmark = pytest.mark.requires_mongo

MODEL = "mobilenetv2@test"
AT = "2026-10-27T08:00:00.000Z"


def uid() -> str:
    return str(uuid4())


def f16(*values: float) -> str:
    return base64.b64encode(struct.pack(f"<{len(values)}e", *values)).decode()


def variant(variant_id: str | None = None, price: int = 4599) -> dict[str, Any]:
    return {
        "id": variant_id or uid(),
        "size_milli": 1000,
        "unit": "pcs",
        "price_cents": price,
        "cost_cents": None,
        "barcode": None,
        "position": 0,
        "archived_at": None,
    }


def product(by: str, product_id: str | None = None, name: str = "Maize meal", **kw) -> dict:
    return {
        "id": product_id or uid(),
        "name": name,
        "category": "Groceries",
        "photos": [],
        "updated_by": by,
        "created_at": AT,
        "updated_at": AT,
        "variants": kw.get("variants") or [variant()],
    }


def sale(by: str, device: str, p: dict, qty: int = 2, imported: bool = False) -> dict:
    v = p["variants"][0]
    return {
        "id": uid(),
        "total_cents": v["price_cents"] * qty,
        "tendered_cents": None,
        "change_cents": None,
        "actor_user_id": by,
        "device_id": device,
        "imported": imported,
        "created_at": AT,
        "items": [
            {
                "id": uid(),
                "product_id": p["id"],
                "variant_id": v["id"],
                "product_name": p["name"],
                "variant_label": "Each",
                "category": p["category"],
                "barcode": None,
                "quantity": qty,
                "unit_price_cents": v["price_cents"],
                "line_total_cents": v["price_cents"] * qty,
                "unit_cost_cents": None,
            }
        ],
    }


def reversal(by: str, device: str, s: dict, qty: int = 1, restocked: bool = True) -> dict:
    line = s["items"][0]
    refund = line["unit_price_cents"] * qty
    return {
        "id": uid(),
        "sale_id": s["id"],
        "reason": "Customer changed their mind",
        "refund_cents": refund,
        "actor_user_id": by,
        "device_id": device,
        "imported": False,
        "created_at": AT,
        "items": [
            {
                "id": uid(),
                "sale_item_id": line["id"],
                "quantity": qty,
                "restocked": restocked,
                "refund_cents": refund,
            }
        ],
    }


def movement(by: str, device: str, p: dict, delta: int, kind: str = "adjustment") -> dict:
    return {
        "id": uid(),
        "variant_id": p["variants"][0]["id"],
        "delta": delta,
        "kind": kind,
        "actor_user_id": by,
        "device_id": device,
        "created_at": AT,
    }


def embedding(p: dict, embedding_id: str | None = None, vector: str | None = None) -> dict:
    return {
        "id": embedding_id or uid(),
        "product_id": p["id"],
        "model_version": MODEL,
        "source": "photo",
        "image_sha256": None,
        "dim": 4,
        "vector_f16": vector or f16(0.6, 0.8, 0, 0),
        "created_at": AT,
    }


def op(entity: str, payload: dict, kind: str = "upsert", op_id: str | None = None) -> dict:
    return {
        "op_id": op_id or uid(),
        "entity": entity,
        "entity_id": payload["id"],
        "op": kind,
        "payload": payload,
    }


class Phone:
    """A registered phone of one shop, speaking sync v2 with its device token."""

    def __init__(self, client: Any, owner: Any) -> None:
        self.client = client
        self.owner = owner
        self.shop_id = owner.shop_id
        self.device_id = owner.device.device_id
        self.user_id = owner.user["id"]
        self.headers = device_headers(client, owner.device)
        self.url = f"{V1}/shops/{self.shop_id}/sync"

    def push(self, *ops: dict, **overrides: Any) -> Any:
        body = {"device_id": self.device_id, "schema_version": 2, "ops": list(ops), **overrides}
        return self.client.post(f"{self.url}/push", json=body, headers=self.headers)

    def pushed(self, *ops: dict) -> dict:
        response = self.push(*ops)
        assert response.status_code == 200, response.text
        return response.json()

    def pull(self, cursor: str = "", limit: int = 500) -> Any:
        return self.client.get(
            f"{self.url}/pull", params={"cursor": cursor, "limit": limit}, headers=self.headers
        )

    def snapshot(self, entity: str, **params: Any) -> dict:
        response = self.client.get(
            f"{self.url}/snapshot", params={"entity": entity, **params}, headers=self.headers
        )
        assert response.status_code == 200, response.text
        return response.json()


@pytest.fixture
def admin(client, mongo) -> dict[str, str]:
    return admin_headers(client, mongo)


@pytest.fixture
def owner(client, admin):
    return create_owner(client, admin)


@pytest.fixture
def phone(client, owner) -> Phone:
    return Phone(client, owner)


def stock(mongo: Any, p: dict) -> int:
    doc = mongo["stock_levels"].find_one({"_id": UUID(p["variants"][0]["id"])})
    return doc["stock"] if doc else 0


# --- Auth ---


def test_sync_needs_the_phone_not_a_person(client, owner, phone) -> None:
    response = client.post(
        f"{phone.url}/push",
        json={"device_id": phone.device_id, "schema_version": 2, "ops": []},
        headers=owner.headers,
    )
    assert response.status_code == 401


def test_a_phone_of_another_shop_gets_not_found(client, admin, phone) -> None:
    other = Phone(client, create_owner(client, admin))
    response = client.get(f"{phone.url}/pull", headers=other.headers)
    assert response.status_code == 404


def test_a_revoked_phone_is_refused(client, mongo, phone) -> None:
    mongo["devices"].update_one(
        {"_id": UUID(phone.device_id)}, {"$set": {"revoked_at": datetime.now(UTC)}}
    )
    assert error_code(phone.pull()) == "device_revoked"


def test_push_checks_the_device_the_version_and_the_size(phone) -> None:
    p = op("products", product(phone.user_id))
    assert error_code(phone.push(p, device_id=uid())) == "device_mismatch"
    old = phone.push(p, schema_version=1)
    assert old.status_code == 426
    assert error_code(old) == "client_update_required"
    big = phone.push(p, padding="x" * 2_000_001)
    assert big.status_code == 413


def test_a_suspended_shop_can_read_but_not_write(mongo, phone) -> None:
    mongo["shops"].update_one({"_id": UUID(phone.shop_id)}, {"$set": {"status": "suspended"}})
    assert error_code(phone.push(op("products", product(phone.user_id)))) == "shop_suspended"
    assert phone.pull().status_code == 200


# --- Push ---


def test_an_op_is_applied_once_however_often_it_is_sent(mongo, phone) -> None:
    p = product(phone.user_id)
    s = sale(phone.user_id, phone.device_id, p)
    ops = [
        op("products", p),
        op("stock_movements", movement(phone.user_id, phone.device_id, p, 10, "opening")),
        op("sales", s),
    ]
    first = phone.pushed(*ops)
    again = phone.pushed(*ops)
    assert first["rejected"] == again["rejected"] == []
    assert sorted(again["acked"]) == sorted(o["op_id"] for o in ops)
    assert mongo["sales"].count_documents({}) == 1
    assert stock(mongo, p) == 8
    assert again["seq"] == first["seq"]  # Nothing new was recorded.


def test_the_last_product_edit_to_arrive_wins(mongo, phone) -> None:
    p = product(phone.user_id, name="Old name")
    phone.pushed(op("products", p))
    phone.pushed(op("products", {**p, "name": "New name"}))  # A coalesced edit: new op_id.
    stored = mongo["products"].find_one({"_id": UUID(p["id"])})
    assert stored["name"] == "New name"
    assert stored["updated_by"] == UUID(phone.user_id)


def test_ids_and_op_ids_belong_to_one_shop(client, admin, mongo, phone) -> None:
    other = Phone(client, create_owner(client, admin))
    p = op("products", product(phone.user_id))
    phone.pushed(p)
    stolen = other.pushed(op("products", {**p["payload"], "updated_by": other.user_id}))
    assert stolen["rejected"][0]["code"] == "id_conflict"
    replayed = other.pushed({**p, "payload": {**p["payload"], "updated_by": other.user_id}})
    assert replayed["rejected"][0]["code"] == "op_conflict"


def test_stock_follows_sales_reversals_and_movements(mongo, phone) -> None:
    me, dev = phone.user_id, phone.device_id
    p = product(me)
    s = sale(me, dev, p, qty=2)
    phone.pushed(
        op("products", p),
        op("stock_movements", movement(me, dev, p, 24, "opening")),
        op("sales", s),
        op("reversals", reversal(me, dev, s, qty=1, restocked=True)),
        op("stock_movements", movement(me, dev, p, -3)),
    )
    assert stock(mongo, p) == 24 - 2 + 1 - 3
    kinds = sorted(m["kind"] for m in mongo["stock_movements"].find())
    assert kinds == ["adjustment", "opening", "reversal", "sale"]


def test_imported_sales_leave_stock_alone(mongo, phone) -> None:
    mongo["shops"].update_one(
        {"_id": UUID(phone.shop_id)}, {"$set": {"data_claimed_by_device": UUID(phone.device_id)}}
    )
    p = product("local")
    phone.pushed(
        op("products", p),
        op("stock_movements", movement("local", "local", p, 5, "opening")),
        op("sales", sale("local", "local", p, qty=2, imported=True)),
    )
    assert stock(mongo, p) == 5
    stored = mongo["sales"].find_one()
    assert stored["actor_user_id"] == UUID(phone.user_id)  # "local" is the owner.


def test_local_changes_only_come_from_the_phone_that_claimed_the_data(phone) -> None:
    result = phone.pushed(op("products", product("local")))
    assert result["rejected"][0]["code"] == "unknown_actor"


def test_reversals_need_their_sale_and_over_reversals_are_flagged(mongo, phone) -> None:
    me, dev = phone.user_id, phone.device_id
    p = product(me)
    s = sale(me, dev, p, qty=2)
    orphan = reversal(me, dev, sale(me, dev, p))
    result = phone.pushed(op("products", p), op("sales", s), op("reversals", orphan))
    assert result["rejected"][0]["code"] == "unknown_sale"

    too_many = op("reversals", reversal(me, dev, s, qty=3))
    result = phone.pushed(too_many)
    assert result["flagged"] == [too_many["op_id"]]
    assert mongo["reversals"].find_one()["flags"] == ["over_reversed"]


# --- Lost rights: facts kept, edits refused ---


def test_a_removed_cashiers_offline_sale_is_kept_and_flagged(client, mongo, owner, phone) -> None:
    member, _ = create_cashier(client, owner)
    p = product(phone.user_id)
    phone.pushed(op("products", p))
    removed = client.delete(
        f"{V1}/shops/{phone.shop_id}/members/{member['user_id']}", headers=owner.headers
    )
    assert removed.status_code == 204
    s = op("sales", sale(member["user_id"], phone.device_id, p))
    result = phone.pushed(s)
    assert result["acked"] == result["flagged"] == [s["op_id"]]
    assert mongo["sales"].find_one()["flags"] == ["removed_actor"]
    assert stock(mongo, p) == -2  # It really left the shelf.


def test_a_cashier_cannot_edit_the_catalogue_but_can_sell(client, mongo, owner, phone) -> None:
    member, _ = create_cashier(client, owner)
    p = product(member["user_id"])
    assert phone.pushed(op("products", p))["rejected"][0]["code"] == "permission_denied"

    p = product(phone.user_id)
    s = op("sales", sale(member["user_id"], phone.device_id, p))
    result = phone.pushed(op("products", p), s)
    assert result["rejected"] == result["flagged"] == []
    count = op("stock_movements", movement(member["user_id"], phone.device_id, p, 4))
    assert phone.pushed(count)["flagged"] == [count["op_id"]]  # stock:write not granted.


def test_strangers_are_refused(phone) -> None:
    p = product(phone.user_id)
    result = phone.pushed(op("products", p), op("sales", sale(uid(), phone.device_id, p)))
    assert [r["code"] for r in result["rejected"]] == ["unknown_actor"]


# --- Embeddings ---


def test_a_deleted_embedding_never_comes_back(mongo, phone) -> None:
    p = product(phone.user_id)
    e = embedding(p)
    phone.pushed(op("products", p), op("embeddings", e))
    phone.pushed(op("embeddings", {"id": e["id"]}, kind="delete"))
    phone.pushed(op("embeddings", e))  # A late re-send of the upsert.
    stored = mongo["embeddings"].find_one({"_id": UUID(e["id"])})
    assert stored["deleted_at"] is not None
    assert len(bytes(stored["vector"])) == 8


def test_embeddings_need_a_known_product_and_a_whole_vector(phone) -> None:
    p = product(phone.user_id)
    result = phone.pushed(
        op("embeddings", embedding(product(phone.user_id))),
        op("products", p),
        op("embeddings", embedding(p, vector=f16(0.6, 0.8))),
        op("products", {**p, "id": uid()}, kind="delete"),
    )
    codes = [r["code"] for r in result["rejected"]]
    assert codes == ["unknown_product", "invalid_payload", "invalid_op"]


# --- Pull and snapshot ---


def test_snapshot_then_pull_gives_the_current_state(phone) -> None:
    me, dev = phone.user_id, phone.device_id
    products = [product(me, name=f"P{n}") for n in range(3)]
    phone.pushed(*[op("products", p) for p in products])

    first = phone.snapshot("products", limit=2)
    assert first["has_more"] is True
    # A till keeps selling while the new phone pages through the snapshot.
    renamed = {**products[0], "name": "Renamed"}
    phone.pushed(op("products", renamed), op("sales", sale(me, dev, products[1])))
    second = phone.snapshot("products", limit=2, after=first["after"])
    assert second["has_more"] is False

    state = {r["id"]: r for r in first["records"] + second["records"]}
    pulled = phone.pull(first["snapshot_seq"]).json()
    for change in pulled["changes"]:
        if change["entity"] == "products":
            state[change["record"]["id"]] = change["record"]
    assert state[products[0]["id"]]["name"] == "Renamed"
    assert {c["entity"] for c in pulled["changes"]} == {"products", "sales", "stock_levels"}
    assert pulled["has_more"] is False
    assert phone.pull(pulled["next_cursor"]).json()["changes"] == []


def test_pull_sends_each_record_once_as_it_is_now(phone) -> None:
    p = product(phone.user_id, name="First")
    phone.pushed(op("products", p))
    phone.pushed(op("products", {**p, "name": "Second"}))
    changes = phone.pull().json()["changes"]
    assert [(c["entity"], c["record"]["name"]) for c in changes] == [("products", "Second")]
    assert changes[0]["seq"] == 2


def test_pull_pages_follow_the_cursor_without_gaps(phone) -> None:
    phone.pushed(*[op("products", product(phone.user_id, name=f"P{n}")) for n in range(5)])
    seen, cursor = [], ""
    while True:
        page = phone.pull(cursor, limit=2).json()
        seen += [c["seq"] for c in page["changes"]]
        cursor = page["next_cursor"]
        if not page["has_more"]:
            break
    assert seen == [1, 2, 3, 4, 5]


def test_a_cursor_older_than_the_history_must_resnapshot(mongo, phone) -> None:
    phone.pushed(*[op("products", product(phone.user_id)) for _ in range(3)])
    mongo["changes"].delete_one({"seq": 1})  # What the 180-day TTL does.
    assert error_code(phone.pull("0")) == "cursor_expired"
    assert phone.pull("1").status_code == 200
    assert error_code(phone.pull("99")) == "cursor_expired"


def test_a_pull_page_carries_at_most_250_vectors(phone) -> None:
    p = product(phone.user_id)
    phone.pushed(op("products", p), *[op("embeddings", embedding(p)) for _ in range(150)])
    phone.pushed(*[op("embeddings", embedding(p)) for _ in range(150)])
    page = phone.pull().json()
    assert sum(c["entity"] == "embeddings" for c in page["changes"]) == 250
    assert page["has_more"] is True


def test_embedding_snapshots_are_per_model(phone) -> None:
    p = product(phone.user_id)
    phone.pushed(op("products", p), op("embeddings", embedding(p)))
    assert len(phone.snapshot("embeddings", model_version=MODEL)["records"]) == 1
    assert phone.snapshot("embeddings", model_version="other@1")["records"] == []


def test_two_tills_pushing_at_once_leave_a_contiguous_feed(client, mongo, phone) -> None:
    me, dev = phone.user_id, phone.device_id
    p = product(me)
    phone.pushed(op("products", p))
    batches = [
        [op("stock_movements", movement(me, dev, p, 1)) for _ in range(100)] for _ in range(2)
    ]
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda ops: phone.pushed(*ops), batches))
    assert all(r["rejected"] == [] for r in results)
    seqs = sorted(c["seq"] for c in mongo["changes"].find({"shop_id": UUID(phone.shop_id)}))
    assert seqs == list(range(1, len(seqs) + 1))
    assert stock(mongo, p) == 200


# --- Photos ---

CLOUD = {
    "cloudinary_cloud_name": "demo",
    "cloudinary_api_key": "123456",
    "cloudinary_api_secret": "test-secret",
}
SHA = hashlib.sha256(b"a product photo").hexdigest()


@pytest.fixture
def cloud_phone(make_client, mongo) -> Phone:
    client = make_client(**CLOUD)
    return Phone(client, create_owner(client, admin_headers(client, mongo)))


def test_cloudinary_signatures_follow_the_documented_algorithm() -> None:
    params = {
        "eager": "w_400,h_300,c_pad|w_260,h_200,c_crop",
        "public_id": "sample_image",
        "timestamp": "1315060510",
    }
    joined = (
        "eager=w_400,h_300,c_pad|w_260,h_200,c_crop&public_id=sample_image&timestamp=1315060510"
    )
    expected = hashlib.sha1((joined + "abcd").encode()).hexdigest()  # noqa: S324 — Cloudinary's
    assert utils.api_sign_request(params, "abcd") == expected


def test_a_photo_is_ticketed_confirmed_and_served(cloud_phone) -> None:
    phone = cloud_phone
    url = f"{phone.url}/photos"
    item = {"sha256": SHA, "kind": "photo", "bytes": 120_000}
    tickets = phone.client.post(f"{url}/uploads", json={"items": [item]}, headers=phone.headers)
    ticket = tickets.json()["tickets"][0]
    fields = ticket["fields"]
    assert ticket["existing"] is False
    assert ticket["upload_url"] == "https://api.cloudinary.com/v1_1/demo/image/upload"
    assert fields["public_id"] == f"shops/{phone.shop_id}/{SHA}"
    assert fields["type"] == "authenticated" and fields["overwrite"] == "false"
    signed = {k: v for k, v in fields.items() if k not in ("signature", "api_key")}
    assert fields["signature"] == utils.api_sign_request(signed, "test-secret")

    version = 1730000000
    genuine = utils.api_sign_request(
        {"public_id": fields["public_id"], "version": version}, "test-secret", signature_version=1
    )
    upload = {
        "sha256": SHA,
        "kind": "photo",
        "public_id": fields["public_id"],
        "version": version,
        "format": "jpg",
        "bytes": 120_000,
        "width": 1080,
        "height": 1080,
    }
    elsewhere = {**upload, "public_id": f"shops/{uid()}/{SHA}"}
    forged = {**upload, "signature": "0" * 40}
    confirmed = phone.client.post(
        f"{url}/confirm",
        json={
            "items": [{**upload, "signature": genuine}, {**elsewhere, "signature": genuine}, forged]
        },
        headers=phone.headers,
    ).json()
    assert confirmed["confirmed"] == [SHA]
    assert [r["code"] for r in confirmed["rejected"]] == ["wrong_public_id", "bad_signature"]

    again = phone.client.post(f"{url}/uploads", json={"items": [item]}, headers=phone.headers)
    assert again.json()["tickets"][0]["existing"] is True

    other = hashlib.sha256(b"never uploaded").hexdigest()
    urls = phone.client.post(
        f"{url}/urls", json={"sha256s": [SHA, other]}, headers=phone.headers
    ).json()["urls"]
    assert urls[other] is None
    assert urls[SHA].startswith("https://res.cloudinary.com/demo/image/authenticated/s--")
    assert urls[SHA].endswith(f"/v{version}/shops/{phone.shop_id}/{SHA}.jpg")


def test_too_large_images_get_no_ticket(cloud_phone) -> None:
    item = {"sha256": SHA, "kind": "photo", "bytes": 6_000_000}
    ticket = cloud_phone.client.post(
        f"{cloud_phone.url}/photos/uploads", json={"items": [item]}, headers=cloud_phone.headers
    ).json()["tickets"][0]
    assert ticket["problem"] == "too_large" and ticket["fields"] is None


def test_photos_are_unavailable_without_cloudinary(make_client, mongo) -> None:
    client = make_client(
        cloudinary_cloud_name=None, cloudinary_api_key=None, cloudinary_api_secret=None
    )
    phone = Phone(client, create_owner(client, admin_headers(client, mongo)))
    response = client.post(
        f"{phone.url}/photos/urls", json={"sha256s": [SHA]}, headers=phone.headers
    )
    assert response.status_code == 503
    assert error_code(response) == "photos_unavailable"
