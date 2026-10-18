"""Admin user management: RBAC, validation, optimistic concurrency, guard rails, audit."""

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


def _user(email: str, role: str = "shop_keeper", **extra):
    return {"email": email, "name": "Someone", "role": role, "password": TEMP_PASSWORD, **extra}


def test_admin_creates_keeper_with_first_shop(client, mongo) -> None:
    admin = admin_headers(client, mongo)
    response = client.post(
        f"{V1}/users", json=_user("k@m.co.ls", shop_name="Thaba Shop"), headers=admin
    )
    assert response.status_code == 201
    user = response.json()
    assert response.headers["location"] == f"/api/v1/users/{user['id']}"
    assert response.headers["etag"] == '"1"'
    assert user["must_change_password"] is True
    assert "password" not in user and "password_hash" not in user

    shop = mongo["shops"].find_one({"name": "Thaba Shop"})
    assert shop is not None and str(shop["owner_id"]) == user["id"]
    actions = {d["action"] for d in mongo["audit_logs"].find()}
    assert {"user.created", "shop.created", "member.created"} <= actions
    created = mongo["audit_logs"].find_one({"action": "user.created"})
    assert "password_hash" not in created["changes"]


def test_create_user_validation(client, mongo) -> None:
    admin = admin_headers(client, mongo)
    assert client.post(f"{V1}/users", json=_user("k@m.co.ls"), headers=admin).status_code == 201
    duplicate = client.post(f"{V1}/users", json=_user("K@M.co.ls"), headers=admin)
    assert duplicate.status_code == 409
    assert error_code(duplicate) == "email_taken"

    for body in (
        _user("s@m.co.ls", role="shop_sitter"),  # A sitter needs a shop.
        _user("x@m.co.ls", shop_name="Nope", role="system_admin"),
        {**_user("y@m.co.ls"), "password": "short"},
        {**_user("z@m.co.ls"), "is_admin": True},  # Unknown fields are rejected.
    ):
        response = client.post(f"{V1}/users", json=body, headers=admin)
        assert response.status_code == 422, body


def test_only_admins_manage_users(client, mongo) -> None:
    admin = admin_headers(client, mongo)
    _, keeper, shop_id = create_keeper(client, admin)
    _, sitter = create_sitter(client, keeper, shop_id)
    for headers in (keeper, sitter):
        assert error_code(client.get(f"{V1}/users", headers=headers)) == "permission_denied"
        response = client.post(f"{V1}/users", json=_user("n@m.co.ls"), headers=headers)
        assert response.status_code == 403
        assert client.get(f"{V1}/audit-logs", headers=headers).status_code == 403


def test_list_users_filters_and_paginates(client, mongo) -> None:
    admin = admin_headers(client, mongo)
    for i in range(5):
        client.post(f"{V1}/users", json=_user(f"user{i}@m.co.ls"), headers=admin)

    page1 = client.get(f"{V1}/users?role=shop_keeper&sort=email&limit=2", headers=admin).json()
    assert [u["email"] for u in page1["data"]] == ["user0@m.co.ls", "user1@m.co.ls"]
    assert page1["page"] == {"next_cursor": page1["page"]["next_cursor"], "limit": 2}
    seen = [u["email"] for u in page1["data"]]
    cursor = page1["page"]["next_cursor"]
    while cursor:
        page = client.get(
            f"{V1}/users?role=shop_keeper&sort=email&limit=2&cursor={cursor}", headers=admin
        ).json()
        seen += [u["email"] for u in page["data"]]
        cursor = page["page"]["next_cursor"]
    assert seen == [f"user{i}@m.co.ls" for i in range(5)]

    newest_first = client.get(f"{V1}/users?role=shop_keeper&limit=1", headers=admin).json()
    assert newest_first["data"][0]["email"] == "user4@m.co.ls"
    search = client.get(f"{V1}/users?q=user3", headers=admin).json()["data"]
    assert [u["email"] for u in search] == ["user3@m.co.ls"]


def test_list_rejects_bad_sort_and_cursor(client, mongo) -> None:
    admin = admin_headers(client, mongo)
    bad_sort = client.get(f"{V1}/users?sort=password_hash", headers=admin)
    assert bad_sort.status_code == 400
    assert error_code(bad_sort) == "invalid_sort"
    assert error_code(client.get(f"{V1}/users?cursor=garbage", headers=admin)) == "invalid_cursor"

    client.post(f"{V1}/users", json=_user("a@m.co.ls"), headers=admin)
    cursor = client.get(f"{V1}/users?limit=1", headers=admin).json()["page"]["next_cursor"]
    other_sort = client.get(f"{V1}/users?limit=1&sort=email&cursor={cursor}", headers=admin)
    assert error_code(other_sort) == "invalid_cursor"  # A cursor only fits the sort it came from.
    assert client.get(f"{V1}/users?limit=101", headers=admin).status_code == 422


def test_patch_uses_if_match_for_optimistic_concurrency(client, mongo) -> None:
    admin = admin_headers(client, mongo)
    user = client.post(f"{V1}/users", json=_user("k@m.co.ls"), headers=admin).json()
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

    entry = mongo["audit_logs"].find_one({"action": "user.updated"})
    assert entry["changes"] == {"name": {"from": "Someone", "to": "Renamed"}}


def test_guard_rails(client, mongo) -> None:
    admin = admin_headers(client, mongo)
    me = client.get(f"{V1}/users/me", headers=admin).json()
    own = client.patch(f"{V1}/users/{me['id']}", json={"status": "disabled"}, headers=admin)
    assert error_code(own) == "cannot_modify_self"

    keeper, _, _ = create_keeper(client, admin)
    role_change = client.patch(
        f"{V1}/users/{keeper['id']}", json={"role": "shop_sitter"}, headers=admin
    )
    assert error_code(role_change) == "role_change_blocked"  # Still owns a shop.


def test_admin_resets_a_password(client, mongo) -> None:
    admin = admin_headers(client, mongo)
    keeper, keeper_headers, _ = create_keeper(client, admin)
    response = client.post(
        f"{V1}/users/{keeper['id']}/password-resets",
        json={"new_password": "reset-pass-123"},
        headers=admin,
    )
    assert response.status_code == 204
    assert client.get(f"{V1}/users/me", headers=keeper_headers).status_code == 401
    tokens = client.post(
        f"{V1}/tokens",
        json={"grant_type": "password", "email": keeper["email"], "password": "reset-pass-123"},
    ).json()
    assert tokens["user"]["must_change_password"] is True


def test_roles_and_permissions_catalogue(client, mongo) -> None:
    admin = admin_headers(client, mongo)
    roles = {r["name"]: r for r in client.get(f"{V1}/roles", headers=admin).json()["data"]}
    assert set(roles) == {"system_admin", "shop_keeper", "shop_sitter"}
    assert roles["shop_sitter"]["default_shop_permissions"] == ["catalogue:read", "sales:create"]
    assert "sales:read" in roles["shop_sitter"]["grantable_shop_permissions"]
    perms = client.get(f"{V1}/permissions", headers=admin).json()["data"]
    assert {p["scope"] for p in perms} == {"system", "shop"}
