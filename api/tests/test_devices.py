"""Registered phones: the offline roster and its ETag, linking, revocation, the data claim."""

import base64
import hashlib
import hmac
from uuid import UUID, uuid4

import pytest

from tests.helpers import (
    CASHIER_PIN,
    V1,
    admin_headers,
    bearer,
    create_cashier,
    create_owner,
    create_shop,
    device_headers,
    device_of,
    error_code,
    sign_in,
)

pytestmark = pytest.mark.requires_mongo


def _tag(pin_key_b64: str, pin: str) -> str:
    return hmac.new(base64.b64decode(pin_key_b64), pin.encode(), hashlib.sha256).hexdigest()


def test_the_roster_lets_a_phone_check_pins_offline(client, mongo) -> None:
    owner = create_owner(client, admin_headers(client, mongo))
    cashier, _ = create_cashier(client, owner, permissions=["sales:refund"])
    headers = device_headers(client, owner.device)

    response = client.get(f"{V1}/devices/me/roster", headers=headers)
    assert response.status_code == 200
    roster = response.json()
    assert roster["device_id"] == owner.device.device_id
    (shop,) = roster["shops"]
    assert (shop["id"], shop["name"], shop["status"]) == (owner.shop_id, "Main Shop", "active")
    by_name = {m["name"]: m for m in shop["members"]}
    assert set(by_name) == {"Owner", "Cashier"}
    # The phone can find who a PIN belongs to without the server, and nothing else.
    assert by_name["Owner"]["pin_tag"] == _tag(shop["pin_key"], owner.pin)
    assert by_name["Cashier"]["pin_tag"] == _tag(shop["pin_key"], CASHIER_PIN)
    assert by_name["Cashier"]["user_id"] == cashier["user_id"]
    assert "sales:refund" in by_name["Cashier"]["permissions"]
    assert "pin_hash" not in response.text

    # Never logged: the key and tags are secrets.
    assert shop["pin_key"] not in str(list(mongo["audit_logs"].find()))


def test_an_unchanged_roster_is_a_304(client, mongo) -> None:
    owner = create_owner(client, admin_headers(client, mongo))
    headers = device_headers(client, owner.device)
    first = client.get(f"{V1}/devices/me/roster", headers=headers)
    etag = first.headers["etag"]

    unchanged = client.get(f"{V1}/devices/me/roster", headers={**headers, "If-None-Match": etag})
    assert unchanged.status_code == 304
    assert unchanged.content == b""
    assert unchanged.headers["etag"] == etag

    cashier, _ = create_cashier(client, owner)
    after_add = client.get(f"{V1}/devices/me/roster", headers={**headers, "If-None-Match": etag})
    assert after_add.status_code == 200
    etag = after_add.headers["etag"]

    url = f"{V1}/shops/{owner.shop_id}/members/{cashier['user_id']}"
    client.patch(url, json={"permissions": ["sales:read"]}, headers=owner.headers)
    after_grant = client.get(f"{V1}/devices/me/roster", headers={**headers, "If-None-Match": etag})
    assert after_grant.status_code == 200
    etag = after_grant.headers["etag"]

    client.delete(url, headers=owner.headers)
    after_removal = client.get(
        f"{V1}/devices/me/roster", headers={**headers, "If-None-Match": etag}
    )
    assert [m["name"] for m in after_removal.json()["shops"][0]["members"]] == ["Owner"]


def test_owner_sets_up_a_till_phone_for_one_shop(client, mongo) -> None:
    owner = create_owner(client, admin_headers(client, mongo))
    create_shop(client, owner.headers, "Second", owner.pin)
    create_cashier(client, owner)

    # The owner signs in on the shop's phone, then registers it to Main Shop only.
    till_tokens = sign_in(client, owner.phone, owner.pin)
    till = device_of(till_tokens)
    till_headers = bearer(till_tokens["access_token"])
    roster = client.get(f"{V1}/devices/me/roster", headers=device_headers(client, till)).json()
    assert roster["shops"] == []  # Signing in alone gives a phone no shop.

    linked = client.put(
        f"{V1}/shops/{owner.shop_id}/devices/{till.device_id}", headers=till_headers
    )
    assert linked.status_code == 200
    assert linked.json()["shop_ids"] == [owner.shop_id]
    again = client.put(f"{V1}/shops/{owner.shop_id}/devices/{till.device_id}", headers=till_headers)
    assert again.status_code == 200  # Idempotent.

    roster = client.get(f"{V1}/devices/me/roster", headers=device_headers(client, till)).json()
    assert [s["name"] for s in roster["shops"]] == ["Main Shop"]
    assert {m["name"] for m in roster["shops"][0]["members"]} == {"Owner", "Cashier"}

    phones = client.get(f"{V1}/shops/{owner.shop_id}/devices", headers=owner.headers).json()
    assert {d["id"] for d in phones["data"]} == {owner.device.device_id, till.device_id}

    assert (
        client.delete(
            f"{V1}/shops/{owner.shop_id}/devices/{till.device_id}", headers=owner.headers
        ).status_code
        == 204
    )
    roster = client.get(f"{V1}/devices/me/roster", headers=device_headers(client, till)).json()
    assert roster["shops"] == []


def test_nobody_can_register_someone_elses_phone_to_their_shop(client, mongo) -> None:
    admin = admin_headers(client, mongo)
    owner_a = create_owner(client, admin)
    owner_b = create_owner(client, admin, shop_name="B Shop")
    hijack = client.put(
        f"{V1}/shops/{owner_b.shop_id}/devices/{owner_a.device.device_id}", headers=owner_b.headers
    )
    assert hijack.status_code == 404
    unknown = client.put(f"{V1}/shops/{owner_b.shop_id}/devices/{uuid4()}", headers=owner_b.headers)
    assert unknown.status_code == 404


def test_revoking_a_phone_stops_it_and_signs_everyone_out(client, mongo) -> None:
    admin = admin_headers(client, mongo)
    owner = create_owner(client, admin)
    other = create_owner(client, admin, shop_name="Other")
    _, cashier_headers = create_cashier(client, owner)
    headers = device_headers(client, owner.device)

    stranger = client.delete(f"{V1}/devices/{owner.device.device_id}", headers=other.headers)
    assert stranger.status_code == 404

    second_phone = bearer(sign_in(client, owner.phone, owner.pin)["access_token"])
    revoked = client.delete(f"{V1}/devices/{owner.device.device_id}", headers=second_phone)
    assert revoked.status_code == 204
    assert (
        client.delete(f"{V1}/devices/{owner.device.device_id}", headers=second_phone).status_code
        == 204
    )

    assert error_code(client.get(f"{V1}/devices/me/roster", headers=headers)) == "device_revoked"
    assert client.get(f"{V1}/users/me", headers=cashier_headers).status_code == 401
    assert client.get(f"{V1}/users/me", headers=owner.headers).status_code == 401
    assert client.get(f"{V1}/users/me", headers=second_phone).status_code == 200
    token = client.post(f"{V1}/tokens", json={"grant_type": "device", **owner.device.credential()})
    assert error_code(token) == "device_revoked"

    listed = client.get(f"{V1}/devices?registered_by={owner.user['id']}", headers=admin).json()
    assert {d["id"]: d["revoked_at"] is not None for d in listed["data"]}[owner.device.device_id]


def test_only_one_phone_moves_its_offline_data_into_a_shop(client, mongo) -> None:
    owner = create_owner(client, admin_headers(client, mongo))
    url = f"{V1}/shops/{owner.shop_id}/data-claim"
    first = client.put(url, headers=owner.headers)
    assert first.status_code == 200
    assert first.json()["device_id"] == owner.device.device_id
    assert client.put(url, headers=owner.headers).status_code == 200  # A retry is fine.

    till_tokens = sign_in(client, owner.phone, owner.pin)
    till_headers = bearer(till_tokens["access_token"])
    unlinked = client.put(url, headers=till_headers)
    assert error_code(unlinked) == "device_not_linked"
    client.put(
        f"{V1}/shops/{owner.shop_id}/devices/{device_of(till_tokens).device_id}",
        headers=till_headers,
    )
    assert error_code(client.put(url, headers=till_headers)) == "data_already_claimed"
    shop = mongo["shops"].find_one({"_id": UUID(owner.shop_id)})
    assert str(shop["data_claimed_by_device"]) == owner.device.device_id


def test_changing_your_pin_updates_every_shop_atomically(client, mongo) -> None:
    owner = create_owner(client, admin_headers(client, mongo))
    second = create_shop(client, owner.headers, "Second", owner.pin)
    create_cashier(client, owner, pin="61937", shop_id=second["id"])

    def change(new: str):
        return client.put(
            f"{V1}/users/me/pin",
            json={"current_pin": owner.pin, "new_pin": new},
            headers=owner.headers,
        )

    # Taken in the second shop only: refused everywhere, nothing changes.
    assert error_code(change("61937")) == "pin_taken"
    sign_in(client, owner.phone, owner.pin)

    assert change("38264").status_code == 204
    roster = client.get(f"{V1}/devices/me/roster", headers=device_headers(client, owner.device))
    for shop in roster.json()["shops"]:
        mine = next(m for m in shop["members"] if m["user_id"] == owner.user["id"])
        assert mine["pin_tag"] == _tag(shop["pin_key"], "38264")
    assert len(roster.json()["shops"]) == 2


def test_pin_changes_are_rate_limited(make_client, mongo) -> None:
    client = make_client(rate_limit_pin_change_per_hour=2)
    owner = create_owner(client, admin_headers(client, mongo))
    body = {"current_pin": "11112", "new_pin": "38264"}
    codes = [
        client.put(f"{V1}/users/me/pin", json=body, headers=owner.headers).status_code
        for _ in range(3)
    ]
    assert codes == [422, 422, 429]
