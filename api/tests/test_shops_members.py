"""Tenancy and shop-scoped RBAC: shops, members (cashiers), suspension and the shop audit log."""

from uuid import UUID

import pytest

from tests.helpers import (
    CASHIER_PIN,
    V1,
    admin_headers,
    create_cashier,
    create_owner,
    create_shop,
    error_code,
    sign_in_on_device,
)

pytestmark = pytest.mark.requires_mongo


def test_owner_creates_and_lists_own_shops(client, mongo) -> None:
    admin = admin_headers(client, mongo)
    owner = create_owner(client, admin)

    created = client.post(
        f"{V1}/shops", json={"name": "Second Shop", "pin": owner.pin}, headers=owner.headers
    )
    assert created.status_code == 201
    shop = created.json()
    assert created.headers["location"] == f"/api/v1/shops/{shop['id']}"
    assert shop["owner_id"] == owner.user["id"]
    assert shop["my_role"] == "owner"
    assert "members:manage" in shop["my_permissions"]

    listed = client.get(f"{V1}/shops?sort=name", headers=owner.headers).json()["data"]
    assert [s["name"] for s in listed] == ["Main Shop", "Second Shop"]

    # Each shop has its own PIN key, and the phone in use is registered to both shops.
    assert mongo["shop_secrets"].count_documents({}) == 2
    device = mongo["devices"].find_one({"_id": UUID(owner.device.device_id)})
    assert {str(s) for s in device["shop_ids"]} == {owner.shop_id, shop["id"]}


def test_opening_a_shop_needs_the_owners_pin(make_client, mongo) -> None:
    client = make_client(max_shops_per_owner=2)
    owner = create_owner(client, admin_headers(client, mongo))
    wrong = client.post(f"{V1}/shops", json={"name": "X", "pin": "11112"}, headers=owner.headers)
    assert wrong.status_code == 401
    assert error_code(wrong) == "invalid_credentials"
    assert mongo["users"].find_one({"phone": owner.phone})["failed_logins"] == 1

    create_shop(client, owner.headers, "Second", owner.pin)
    limit = client.post(
        f"{V1}/shops", json={"name": "Third", "pin": owner.pin}, headers=owner.headers
    )
    assert error_code(limit) == "shop_limit_reached"
    assert (
        client.post(f"{V1}/shops", json={"name": "No PIN"}, headers=owner.headers).status_code
        == 422
    )


def test_admins_see_every_shop_but_do_not_open_them(client, mongo) -> None:
    admin = admin_headers(client, mongo)
    owner = create_owner(client, admin)
    create_owner(client, admin, shop_name="Another")

    assert len(client.get(f"{V1}/shops", headers=admin).json()["data"]) == 2
    mine = client.get(f"{V1}/shops?owner_id={owner.user['id']}", headers=admin).json()["data"]
    assert [s["name"] for s in mine] == ["Main Shop"]
    created = client.post(f"{V1}/shops", json={"name": "X", "pin": "40817"}, headers=admin)
    assert error_code(created) == "permission_denied"


def test_shops_are_isolated_between_tenants(client, mongo) -> None:
    admin = admin_headers(client, mongo)
    owner_a = create_owner(client, admin)
    owner_b = create_owner(client, admin, shop_name="B Shop")
    _, cashier_a = create_cashier(client, owner_a)

    for headers, target in ((owner_b.headers, owner_a.shop_id), (cashier_a, owner_b.shop_id)):
        # 404, not 403: other tenants' shops are indistinguishable from missing ones.
        assert client.get(f"{V1}/shops/{target}", headers=headers).status_code == 404
        assert client.get(f"{V1}/shops/{target}/members", headers=headers).status_code == 404
        assert client.get(f"{V1}/shops/{target}/audit-logs", headers=headers).status_code == 404
        assert client.get(f"{V1}/shops/{target}/devices", headers=headers).status_code == 404
        patch = client.patch(f"{V1}/shops/{target}", json={"name": "Hijacked"}, headers=headers)
        assert patch.status_code == 404
    listed = client.get(f"{V1}/shops", headers=owner_b.headers).json()["data"]
    assert [s["id"] for s in listed] == [owner_b.shop_id]
    # A phone of shop B cannot sign anyone in to shop A.
    crossed = sign_in_on_device(client, owner_b.device, owner_a.shop_id, owner_a.pin)
    assert error_code(crossed) == "invalid_credentials"


def test_owner_manages_cashiers_and_their_privileges(client, mongo) -> None:
    admin = admin_headers(client, mongo)
    owner = create_owner(client, admin)
    shop_id = owner.shop_id
    cashier, cashier_headers = create_cashier(client, owner)
    assert cashier["role"] == "cashier"
    assert cashier["user"]["phone"] is None
    assert cashier["permissions"] == ["catalogue:read", "sales:create"]  # Sell only, by default.

    # A default cashier cannot see the team, the activity log or manage anything.
    members_url = f"{V1}/shops/{shop_id}/members"
    assert error_code(client.get(members_url, headers=cashier_headers)) == "permission_denied"
    assert (
        client.get(f"{V1}/shops/{shop_id}/audit-logs", headers=cashier_headers).status_code == 403
    )
    rename = client.patch(f"{V1}/shops/{shop_id}", json={"name": "X"}, headers=cashier_headers)
    assert rename.status_code == 403
    me = client.get(f"{V1}/users/me", headers=cashier_headers).json()
    assert me["memberships"][0]["permissions"] == ["catalogue:read", "sales:create"]

    url = f"{members_url}/{cashier['user_id']}"
    granted = client.patch(
        url,
        json={"permissions": ["sales:read", "reports:read"]},
        headers={**owner.headers, "If-Match": '"1"'},
    )
    assert granted.status_code == 200
    assert granted.json()["granted_permissions"] == ["reports:read", "sales:read"]
    me = client.get(f"{V1}/users/me", headers=cashier_headers).json()
    assert "sales:read" in me["memberships"][0]["permissions"]  # Effective immediately.

    not_grantable = client.patch(
        url, json={"permissions": ["members:manage"]}, headers=owner.headers
    )
    assert not_grantable.status_code == 422
    owner_change = client.patch(
        f"{members_url}/{owner.user['id']}", json={"permissions": []}, headers=owner.headers
    )
    assert error_code(owner_change) == "not_a_cashier"

    team = client.get(f"{members_url}?role=cashier", headers=owner.headers).json()["data"]
    assert [m["user"]["name"] for m in team] == ["Cashier"]


def test_pins_are_unique_within_a_shop_only(client, mongo) -> None:
    admin = admin_headers(client, mongo)
    owner = create_owner(client, admin)
    create_cashier(client, owner)

    def add(shop_id: str, pin: str):
        return client.post(
            f"{V1}/shops/{shop_id}/members",
            json={"name": "Another", "pin": pin},
            headers=owner.headers,
        )

    for taken in (CASHIER_PIN, owner.pin):
        response = add(owner.shop_id, taken)
        assert response.status_code == 409
        assert error_code(response) == "pin_taken"
        assert "Another" not in response.text  # It never says whose PIN it is.
    assert mongo["users"].count_documents({"name": "Another"}) == 0  # Rolled back.

    second = create_shop(client, owner.headers, "Second", owner.pin)
    assert add(second["id"], CASHIER_PIN).status_code == 201  # Another shop: fine.
    assert add(second["id"], "12345").status_code == 422  # Too easy to guess.


def test_removing_a_cashier_disables_the_account(client, mongo) -> None:
    admin = admin_headers(client, mongo)
    owner = create_owner(client, admin)
    cashier, cashier_headers = create_cashier(client, owner)
    url = f"{V1}/shops/{owner.shop_id}/members/{cashier['user_id']}"

    assert client.delete(url, headers=owner.headers).status_code == 204
    assert client.get(f"{V1}/users/me", headers=cashier_headers).status_code == 401
    assert client.get(url, headers=owner.headers).status_code == 404
    user = client.get(f"{V1}/users/{cashier['user_id']}", headers=admin).json()
    assert user["status"] == "disabled"
    gone = sign_in_on_device(client, owner.device, owner.shop_id, CASHIER_PIN)
    assert error_code(gone) == "invalid_credentials"
    # Their PIN is free again.
    create_cashier(client, owner, name="New cashier")


def test_owner_sets_a_cashiers_new_pin(client, mongo) -> None:
    admin = admin_headers(client, mongo)
    owner = create_owner(client, admin)
    cashier, cashier_headers = create_cashier(client, owner)
    url = f"{V1}/shops/{owner.shop_id}/members/{cashier['user_id']}/pin"

    taken = client.put(url, json={"pin": owner.pin}, headers=owner.headers)
    assert error_code(taken) == "pin_taken"
    assert client.put(url, json={"pin": "61937"}, headers=owner.headers).status_code == 204
    assert client.get(f"{V1}/users/me", headers=cashier_headers).status_code == 401
    old = sign_in_on_device(client, owner.device, owner.shop_id, CASHIER_PIN)
    assert error_code(old) == "invalid_credentials"
    new = sign_in_on_device(client, owner.device, owner.shop_id, "61937")
    assert new.json()["user"]["id"] == cashier["user_id"]


def test_a_suspended_shop_can_be_looked_at_but_not_changed(client, mongo) -> None:
    admin = admin_headers(client, mongo)
    owner = create_owner(client, admin)
    url = f"{V1}/shops/{owner.shop_id}"

    by_owner = client.patch(url, json={"status": "suspended"}, headers=owner.headers)
    assert error_code(by_owner) == "permission_denied"
    suspended = client.patch(url, json={"status": "suspended"}, headers=admin)
    assert suspended.json()["status"] == "suspended"
    assert mongo["audit_logs"].count_documents({"action": "shop.suspended"}) == 1

    assert (
        client.get(f"{V1}/shops/{owner.shop_id}/members", headers=owner.headers).status_code == 200
    )
    blocked = client.post(
        f"{V1}/shops/{owner.shop_id}/members",
        json={"name": "C", "pin": CASHIER_PIN},
        headers=owner.headers,
    )
    assert error_code(blocked) == "shop_suspended"
    rename = client.patch(url, json={"name": "Renamed"}, headers=owner.headers)
    assert error_code(rename) == "shop_suspended"

    assert client.patch(url, json={"status": "active"}, headers=admin).status_code == 200
    create_cashier(client, owner)


def test_owner_sees_everything_done_in_the_shop(client, mongo) -> None:
    admin = admin_headers(client, mongo)
    owner = create_owner(client, admin)
    shop_id = owner.shop_id
    cashier, _ = create_cashier(client, owner)
    client.patch(
        f"{V1}/shops/{shop_id}/members/{cashier['user_id']}",
        json={"permissions": ["sales:read"]},
        headers=owner.headers,
    )

    logs = client.get(f"{V1}/shops/{shop_id}/audit-logs", headers=owner.headers).json()["data"]
    actions = [entry["action"] for entry in logs]
    assert actions[0] == "member.updated"  # Newest first.
    assert {"shop.created", "member.created", "user.created", "device.linked"} <= set(actions)
    assert all(entry["shop_id"] == shop_id for entry in logs)
    assert logs[0]["changes"] == {"permissions": {"from": [], "to": ["sales:read"]}}
    assert logs[0]["request_id"]
    assert logs[0]["actor_phone"] == owner.phone

    filtered = client.get(
        f"{V1}/shops/{shop_id}/audit-logs?action=member.created", headers=owner.headers
    ).json()["data"]
    assert {e["action"] for e in filtered} == {"member.created"}

    # Admin oversight: the global log (filterable by shop) and read access to the team.
    global_logs = client.get(f"{V1}/audit-logs?shop_id={shop_id}", headers=admin).json()["data"]
    assert len(global_logs) == len(logs)
    assert client.get(f"{V1}/shops/{shop_id}/members", headers=admin).status_code == 200
    create_as_admin = client.post(
        f"{V1}/shops/{shop_id}/members", json={"name": "X", "pin": "61937"}, headers=admin
    )
    assert create_as_admin.status_code == 404  # Admins do not operate shops.
