"""Admin user management: RBAC, validation, optimistic concurrency, guard rails, PIN resets."""

import pytest

from tests.helpers import (
    V1,
    admin_headers,
    create_cashier,
    create_owner,
    error_code,
    sign_in,
    unique_phone,
)

pytestmark = pytest.mark.requires_mongo


def _user(phone: str | None = None, role: str = "owner", **extra):
    return {"phone": phone or unique_phone(), "name": "Someone", "role": role, **extra}


def test_admin_adds_an_approved_owner_with_a_temporary_pin(client, mongo) -> None:
    admin = admin_headers(client, mongo)
    response = client.post(f"{V1}/users", json=_user("+26658000001"), headers=admin)
    assert response.status_code == 201
    created = response.json()
    user = created["user"]
    assert response.headers["location"] == f"/api/v1/users/{user['id']}"
    assert response.headers["etag"] == '"1"'
    assert (user["status"], user["must_change_pin"]) == ("active", True)
    assert len(created["temporary_pin"]) == 5
    assert "pin_hash" not in user

    entry = mongo["audit_logs"].find_one({"action": "user.created"})
    assert "pin_hash" not in entry["changes"]
    tokens = sign_in(client, "+26658000001", created["temporary_pin"])
    assert tokens["user"]["must_change_pin"] is True
    # Never stored for replay, even when the client sends a key.
    keyed = client.post(f"{V1}/users", json=_user(), headers={**admin, "Idempotency-Key": "k-1"})
    assert keyed.status_code == 201
    assert mongo["idempotency_keys"].count_documents({}) == 0


def test_create_user_validation(client, mongo) -> None:
    admin = admin_headers(client, mongo)
    phone = unique_phone()
    assert client.post(f"{V1}/users", json=_user(phone), headers=admin).status_code == 201
    duplicate = client.post(f"{V1}/users", json=_user(phone), headers=admin)
    assert duplicate.status_code == 409
    assert error_code(duplicate) == "phone_taken"

    for body in (
        _user(role="cashier"),  # Cashiers are created by their owner, in the shop.
        _user(phone="12"),
        {**_user(), "pin": "40817"},  # The server chooses the temporary PIN.
        {**_user(), "is_admin": True},  # Unknown fields are rejected.
    ):
        response = client.post(f"{V1}/users", json=body, headers=admin)
        assert response.status_code == 422, body


def test_only_admins_manage_users(client, mongo) -> None:
    admin = admin_headers(client, mongo)
    owner = create_owner(client, admin)
    _, cashier = create_cashier(client, owner)
    for headers in (owner.headers, cashier):
        assert error_code(client.get(f"{V1}/users", headers=headers)) == "permission_denied"
        response = client.post(f"{V1}/users", json=_user(), headers=headers)
        assert response.status_code == 403
        assert client.get(f"{V1}/audit-logs", headers=headers).status_code == 403
        reviewed = client.post(
            f"{V1}/users/{owner.user['id']}/reviews", json={"decision": "approve"}, headers=headers
        )
        assert reviewed.status_code == 403


def test_list_users_filters_and_paginates(client, mongo) -> None:
    admin = admin_headers(client, mongo)
    for i in range(5):
        body = {**_user(f"+2665800000{i}"), "name": f"User {i}"}
        assert client.post(f"{V1}/users", json=body, headers=admin).status_code == 201

    page1 = client.get(f"{V1}/users?role=owner&sort=name&limit=2", headers=admin).json()
    assert [u["name"] for u in page1["data"]] == ["User 0", "User 1"]
    assert page1["page"] == {"next_cursor": page1["page"]["next_cursor"], "limit": 2}
    seen = [u["name"] for u in page1["data"]]
    cursor = page1["page"]["next_cursor"]
    while cursor:
        page = client.get(
            f"{V1}/users?role=owner&sort=name&limit=2&cursor={cursor}", headers=admin
        ).json()
        seen += [u["name"] for u in page["data"]]
        cursor = page["page"]["next_cursor"]
    assert seen == [f"User {i}" for i in range(5)]

    newest_first = client.get(f"{V1}/users?role=owner&limit=1", headers=admin).json()
    assert newest_first["data"][0]["name"] == "User 4"
    by_name = client.get(f"{V1}/users?q=user 3", headers=admin).json()["data"]
    assert [u["name"] for u in by_name] == ["User 3"]
    by_phone = client.get(f"{V1}/users?q=5800 0002", headers=admin).json()["data"]
    assert [u["name"] for u in by_phone] == ["User 2"]


def test_list_rejects_bad_sort_and_cursor(client, mongo) -> None:
    admin = admin_headers(client, mongo)
    bad_sort = client.get(f"{V1}/users?sort=pin_hash", headers=admin)
    assert bad_sort.status_code == 400
    assert error_code(bad_sort) == "invalid_sort"
    assert error_code(client.get(f"{V1}/users?cursor=garbage", headers=admin)) == "invalid_cursor"

    client.post(f"{V1}/users", json=_user(), headers=admin)
    cursor = client.get(f"{V1}/users?limit=1", headers=admin).json()["page"]["next_cursor"]
    other_sort = client.get(f"{V1}/users?limit=1&sort=name&cursor={cursor}", headers=admin)
    assert error_code(other_sort) == "invalid_cursor"  # A cursor only fits the sort it came from.
    assert client.get(f"{V1}/users?limit=101", headers=admin).status_code == 422


def test_patch_uses_if_match_for_optimistic_concurrency(client, mongo) -> None:
    admin = admin_headers(client, mongo)
    user = client.post(f"{V1}/users", json=_user(), headers=admin).json()["user"]
    url = f"{V1}/users/{user['id']}"
    etag = client.get(url, headers=admin).headers["etag"]

    first = client.patch(url, json={"name": "Renamed"}, headers={**admin, "If-Match": etag})
    assert first.status_code == 200
    assert first.headers["etag"] == '"2"'
    stale = client.patch(url, json={"name": "Lost update"}, headers={**admin, "If-Match": etag})
    assert stale.status_code == 412
    assert error_code(stale) == "version_mismatch"
    assert client.patch(url, json={}, headers=admin).status_code == 422
    assert client.patch(url, json={"name": None}, headers=admin).status_code == 422
    assert client.patch(url, json={"role": "cashier"}, headers=admin).status_code == 422

    entry = mongo["audit_logs"].find_one({"action": "user.updated"})
    assert entry["changes"] == {"name": {"from": "Someone", "to": "Renamed"}}


def test_guard_rails(client, mongo) -> None:
    admin = admin_headers(client, mongo)
    me = client.get(f"{V1}/users/me", headers=admin).json()
    own = client.patch(f"{V1}/users/{me['id']}", json={"status": "disabled"}, headers=admin)
    assert error_code(own) == "cannot_modify_self"


def test_disabling_an_owner_removes_them_from_the_roster(client, mongo) -> None:
    admin = admin_headers(client, mongo)
    owner = create_owner(client, admin)
    before = mongo["shops"].find_one()["roster_version"]
    url = f"{V1}/users/{owner.user['id']}"
    assert client.patch(url, json={"status": "disabled"}, headers=admin).status_code == 200
    assert mongo["shops"].find_one()["roster_version"] == before + 1
    assert client.patch(url, json={"status": "active"}, headers=admin).status_code == 200
    sign_in(client, owner.phone, owner.pin)


def test_admin_resets_an_owners_pin(client, mongo) -> None:
    admin = admin_headers(client, mongo)
    owner = create_owner(client, admin)
    mongo["users"].update_one({"phone": owner.phone}, {"$set": {"failed_logins": 4, "lockouts": 3}})
    response = client.post(f"{V1}/users/{owner.user['id']}/pin-resets", headers=admin)
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    temporary = response.json()["temporary_pin"]
    assert temporary != owner.pin

    assert client.get(f"{V1}/users/me", headers=owner.headers).status_code == 401
    tokens = sign_in(client, owner.phone, temporary)
    assert tokens["user"]["must_change_pin"] is True
    stored = mongo["users"].find_one({"phone": owner.phone})
    assert (stored["failed_logins"], stored["lockouts"]) == (0, 0)
    entry = mongo["audit_logs"].find_one({"action": "user.pin_reset"})
    assert temporary not in str(entry)


def test_roles_and_permissions_catalogue(client, mongo) -> None:
    admin = admin_headers(client, mongo)
    roles = {r["name"]: r for r in client.get(f"{V1}/roles", headers=admin).json()["data"]}
    assert set(roles) == {"system_admin", "owner", "cashier"}
    assert roles["cashier"]["default_shop_permissions"] == ["catalogue:read", "sales:create"]
    assert "sales:read" in roles["cashier"]["grantable_shop_permissions"]
    perms = client.get(f"{V1}/permissions", headers=admin).json()["data"]
    assert {p["scope"] for p in perms} == {"system", "shop"}
