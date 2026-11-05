"""Sync issues: phones report them; only the system admin lists and resolves them."""

from typing import Any
from uuid import uuid4

import pytest

from tests.helpers import V1, admin_headers, create_cashier, create_owner, device_headers

pytestmark = pytest.mark.requires_mongo


def issue(**overrides: Any) -> dict[str, Any]:
    return {
        "id": str(uuid4()),
        "kind": "rejected",
        "entity": "sales",
        "entity_id": str(uuid4()),
        "op_id": str(uuid4()),
        "code": "total_mismatch",
        "message": "The lines do not add up to the total",
        "created_at": "2026-10-28T08:00:00.000Z",
        **overrides,
    }


def report(client, owner, *issues: dict[str, Any], shop_id: str | None = None) -> Any:
    return client.post(
        f"{V1}/shops/{shop_id or owner.shop_id}/sync/issues",
        json={"issues": list(issues)},
        headers=device_headers(client, owner.device),
    )


def test_a_phone_reports_issues_once_and_the_admin_resolves_them(client, mongo) -> None:
    admin = admin_headers(client, mongo)
    owner = create_owner(client, admin)
    first, second = issue(), issue(kind="conflict", op_id=None, code="missing_reference")

    response = report(client, owner, first, second)
    assert response.status_code == 200, response.text
    assert set(response.json()["accepted"]) == {first["id"], second["id"]}
    # Sent again (the phone never heard back): stored once.
    assert report(client, owner, first).status_code == 200
    assert mongo["sync_issues"].count_documents({}) == 2

    assert client.get(f"{V1}/sync-issues/count", headers=admin).json() == {"open": 2}
    listed = client.get(f"{V1}/sync-issues", headers=admin).json()["data"]
    assert {row["id"] for row in listed} == {first["id"], second["id"]}
    row = next(row for row in listed if row["id"] == first["id"])
    assert row["shop_name"] == "Main Shop"
    assert row["owner_name"] == "Owner"
    assert row["owner_phone"] == owner.phone
    assert row["device_id"] == owner.device.device_id
    assert row["resolved_at"] is None

    resolved = client.post(f"{V1}/sync-issues/{first['id']}/resolve", headers=admin)
    assert resolved.status_code == 200
    assert resolved.json()["resolved_at"] is not None
    again = client.post(f"{V1}/sync-issues/{first['id']}/resolve", headers=admin)
    assert again.json()["resolved_at"] == resolved.json()["resolved_at"]
    assert mongo["audit_logs"].count_documents({"action": "sync_issue.resolved"}) == 1

    open_ids = [r["id"] for r in client.get(f"{V1}/sync-issues", headers=admin).json()["data"]]
    assert open_ids == [second["id"]]
    done = client.get(f"{V1}/sync-issues", params={"status": "resolved"}, headers=admin)
    assert [r["id"] for r in done.json()["data"]] == [first["id"]]
    assert client.get(f"{V1}/sync-issues/count", headers=admin).json() == {"open": 1}

    missing = client.post(f"{V1}/sync-issues/{uuid4()}/resolve", headers=admin)
    assert missing.status_code == 404


def test_owners_and_cashiers_cannot_see_sync_issues(client, mongo) -> None:
    owner = create_owner(client, admin_headers(client, mongo))
    _, cashier = create_cashier(client, owner)
    report(client, owner, issue())
    for headers in (owner.headers, cashier):
        assert client.get(f"{V1}/sync-issues", headers=headers).status_code == 403
        assert client.get(f"{V1}/sync-issues/count", headers=headers).status_code == 403


def test_a_phone_reports_only_for_its_own_shops(client, mongo) -> None:
    admin = admin_headers(client, mongo)
    owner = create_owner(client, admin)
    other = create_owner(client, admin, shop_name="Other Shop")
    response = report(client, owner, issue(), shop_id=other.shop_id)
    assert response.status_code == 404
    assert mongo["sync_issues"].count_documents({}) == 0


def test_a_report_is_checked(client, mongo) -> None:
    owner = create_owner(client, admin_headers(client, mongo))
    assert report(client, owner).status_code == 422  # Nothing to report.
    assert report(client, owner, issue(kind="lost")).status_code == 422
    assert report(client, owner, issue(message="x" * 1001)).status_code == 422
