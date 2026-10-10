"""Tenancy and shop-scoped RBAC: shops, members (sitters) and the per-shop audit log."""

from uuid import uuid4

import pytest

from tests.helpers import (
    TEMP_PASSWORD,
    V1,
    admin_headers,
    create_keeper,
    create_sitter,
    error_code,
)

pytestmark = pytest.mark.requires_mongo


def test_keeper_creates_and_lists_own_shops(client, mongo) -> None:
    admin = admin_headers(client, mongo)
    keeper, headers, _ = create_keeper(client, admin)

    created = client.post(f"{V1}/shops", json={"name": "Second Shop"}, headers=headers)
    assert created.status_code == 201
    shop = created.json()
    assert created.headers["location"] == f"/api/v1/shops/{shop['id']}"
    assert shop["owner_id"] == keeper["id"]
    assert shop["my_role"] == "keeper"
    assert "members:manage" in shop["my_permissions"]

    listed = client.get(f"{V1}/shops?sort=name", headers=headers).json()["data"]
    assert [s["name"] for s in listed] == ["Main Shop", "Second Shop"]

    other = client.post(
        f"{V1}/shops", json={"name": "Not mine", "owner_id": str(uuid4())}, headers=headers
    )
    assert other.status_code == 403


def test_admin_sees_all_shops_and_creates_for_a_keeper(client, mongo) -> None:
    admin = admin_headers(client, mongo)
    keeper, _, _ = create_keeper(client, admin)
    create_keeper(client, admin, shop_name="Another")

    assert len(client.get(f"{V1}/shops", headers=admin).json()["data"]) == 2
    missing_owner = client.post(f"{V1}/shops", json={"name": "X"}, headers=admin)
    assert error_code(missing_owner) == "owner_required"
    created = client.post(
        f"{V1}/shops", json={"name": "For keeper", "owner_id": keeper["id"]}, headers=admin
    )
    assert created.status_code == 201
    mine = client.get(f"{V1}/shops?owner_id={keeper['id']}", headers=admin).json()["data"]
    assert len(mine) == 2


def test_shops_are_isolated_between_tenants(client, mongo) -> None:
    admin = admin_headers(client, mongo)
    _, keeper_a, shop_a = create_keeper(client, admin)
    _, keeper_b, shop_b = create_keeper(client, admin, shop_name="B Shop")
    _, sitter_a = create_sitter(client, keeper_a, shop_a)

    for headers in (keeper_b, sitter_a):
        target = shop_a if headers is keeper_b else shop_b
        # 404, not 403: other tenants' shops are indistinguishable from missing ones.
        assert client.get(f"{V1}/shops/{target}", headers=headers).status_code == 404
        assert client.get(f"{V1}/shops/{target}/members", headers=headers).status_code == 404
        assert client.get(f"{V1}/shops/{target}/audit-logs", headers=headers).status_code == 404
        patch = client.patch(f"{V1}/shops/{target}", json={"name": "Hijacked"}, headers=headers)
        assert patch.status_code == 404
    assert [s["id"] for s in client.get(f"{V1}/shops", headers=keeper_b).json()["data"]] == [shop_b]


def test_keeper_manages_sitters_and_their_privileges(client, mongo) -> None:
    admin = admin_headers(client, mongo)
    _, keeper, shop_id = create_keeper(client, admin)
    sitter, sitter_headers = create_sitter(client, keeper, shop_id)
    assert sitter["role"] == "sitter"
    assert sitter["permissions"] == ["catalogue:read", "sales:create"]  # Sell only, by default.

    # A default sitter cannot see the team, the activity log or manage anything.
    members_url = f"{V1}/shops/{shop_id}/members"
    assert error_code(client.get(members_url, headers=sitter_headers)) == "permission_denied"
    assert client.get(f"{V1}/shops/{shop_id}/audit-logs", headers=sitter_headers).status_code == 403
    rename = client.patch(f"{V1}/shops/{shop_id}", json={"name": "X"}, headers=sitter_headers)
    assert rename.status_code == 403
    me = client.get(f"{V1}/users/me", headers=sitter_headers).json()
    assert me["memberships"][0]["permissions"] == ["catalogue:read", "sales:create"]

    url = f"{members_url}/{sitter['user_id']}"
    granted = client.patch(
        url,
        json={"permissions": ["sales:read", "reports:read"]},
        headers={**keeper, "If-Match": '"1"'},
    )
    assert granted.status_code == 200
    assert granted.json()["granted_permissions"] == ["reports:read", "sales:read"]
    me = client.get(f"{V1}/users/me", headers=sitter_headers).json()
    assert "sales:read" in me["memberships"][0]["permissions"]  # Effective immediately.

    not_grantable = client.patch(url, json={"permissions": ["members:manage"]}, headers=keeper)
    assert not_grantable.status_code == 422
    keeper_id = client.get(f"{V1}/users/me", headers=keeper).json()["id"]
    keeper_change = client.patch(
        f"{members_url}/{keeper_id}", json={"permissions": []}, headers=keeper
    )
    assert error_code(keeper_change) == "not_a_sitter"

    team = client.get(f"{members_url}?role=sitter", headers=keeper).json()["data"]
    assert [m["user"]["name"] for m in team] == ["Sitter"]


def test_a_sitter_belongs_to_one_shop_only(client, mongo) -> None:
    admin = admin_headers(client, mongo)
    _, keeper, shop_id = create_keeper(client, admin)
    sitter, _ = create_sitter(client, keeper, shop_id)
    second = client.post(f"{V1}/shops", json={"name": "Second"}, headers=keeper).json()
    duplicate = client.post(
        f"{V1}/shops/{second['id']}/members",
        json={"email": sitter["user"]["email"], "name": "Again", "password": TEMP_PASSWORD},
        headers=keeper,
    )
    assert error_code(duplicate) == "email_taken"


def test_removing_a_sitter_disables_the_account(client, mongo) -> None:
    admin = admin_headers(client, mongo)
    _, keeper, shop_id = create_keeper(client, admin)
    sitter, sitter_headers = create_sitter(client, keeper, shop_id)
    url = f"{V1}/shops/{shop_id}/members/{sitter['user_id']}"

    assert client.delete(url, headers=keeper).status_code == 204
    assert client.get(f"{V1}/users/me", headers=sitter_headers).status_code == 401
    assert client.get(url, headers=keeper).status_code == 404
    user = client.get(f"{V1}/users/{sitter['user_id']}", headers=admin).json()
    assert user["status"] == "disabled"


def test_keeper_resets_a_sitter_password(client, mongo) -> None:
    admin = admin_headers(client, mongo)
    _, keeper, shop_id = create_keeper(client, admin)
    sitter, sitter_headers = create_sitter(client, keeper, shop_id)
    response = client.post(
        f"{V1}/shops/{shop_id}/members/{sitter['user_id']}/password-resets",
        json={"new_password": "fresh-pass-123"},
        headers=keeper,
    )
    assert response.status_code == 204
    assert client.get(f"{V1}/users/me", headers=sitter_headers).status_code == 401


def test_keeper_sees_everything_done_in_the_shop(client, mongo) -> None:
    admin = admin_headers(client, mongo)
    _, keeper, shop_id = create_keeper(client, admin)
    sitter, _ = create_sitter(client, keeper, shop_id)
    client.patch(
        f"{V1}/shops/{shop_id}/members/{sitter['user_id']}",
        json={"permissions": ["sales:read"]},
        headers=keeper,
    )

    logs = client.get(f"{V1}/shops/{shop_id}/audit-logs", headers=keeper).json()["data"]
    actions = [entry["action"] for entry in logs]
    assert actions[0] == "member.updated"  # Newest first.
    assert {"shop.created", "member.created", "user.created"} <= set(actions)
    assert all(entry["shop_id"] == shop_id for entry in logs)
    assert logs[0]["changes"] == {"permissions": {"from": [], "to": ["sales:read"]}}
    assert logs[0]["request_id"]

    filtered = client.get(
        f"{V1}/shops/{shop_id}/audit-logs?action=member.created", headers=keeper
    ).json()["data"]
    assert {e["action"] for e in filtered} == {"member.created"}

    # Admin oversight: the global log (filterable by shop) and read access to the team.
    global_logs = client.get(f"{V1}/audit-logs?shop_id={shop_id}", headers=admin).json()["data"]
    assert len(global_logs) == len(logs)
    assert client.get(f"{V1}/shops/{shop_id}/members", headers=admin).status_code == 200
    create_as_admin = client.post(
        f"{V1}/shops/{shop_id}/members",
        json={"email": "x@m.co.ls", "name": "X", "password": TEMP_PASSWORD},
        headers=admin,
    )
    assert create_as_admin.status_code == 404  # Admins do not operate shops.
