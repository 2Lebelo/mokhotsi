"""PIN and device sign-in, refresh rotation, revocation, temporary PINs, lockouts, limits."""

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from pwdlib import PasswordHash
from pwdlib.hashers.argon2 import Argon2Hasher

from app.core.security import secrets_match
from tests.helpers import (
    ADMIN_PHONE,
    ADMIN_PIN,
    OWNER_PIN,
    V1,
    admin_headers,
    bearer,
    create_cashier,
    create_owner,
    device_headers,
    device_of,
    error_code,
    insert_admin,
    new_device,
    sign_in,
    sign_in_on_device,
)

pytestmark = pytest.mark.requires_mongo


def _refresh(client, token: str):
    return client.post(f"{V1}/tokens", json={"grant_type": "refresh_token", "refresh_token": token})


def _pin(phone: str, pin: str, device=None) -> dict:
    return {"grant_type": "pin", "phone": phone, "pin": pin, "device": device or new_device()}


def test_pin_sign_in_registers_the_phone_and_returns_tokens(client, mongo) -> None:
    insert_admin(mongo)
    tokens = sign_in(client, "+266 5000 0001", ADMIN_PIN)  # Any spelling of the number.
    assert tokens["token_type"] == "bearer"  # noqa: S105
    assert tokens["expires_in"] == 15 * 60
    assert tokens["user"]["role"] == "system_admin"
    assert tokens["user"]["phone"] == ADMIN_PHONE

    device = device_of(tokens)
    assert tokens["device_id"] == device.device_id
    stored = mongo["devices"].find_one({"_id": UUID(device.device_id)})
    assert secrets_match(device.device_secret, stored["secret_hash"])
    assert device.device_secret not in str(stored)

    me = client.get(f"{V1}/users/me", headers=bearer(tokens["access_token"]))
    assert me.status_code == 200
    assert "users:write" in me.json()["permissions"]

    session = mongo["sessions"].find_one({"_id": UUID(tokens["session_id"])})
    assert str(session["device_id"]) == device.device_id
    assert tokens["refresh_token"] not in str(session)

    # The same phone signing in again is not registered twice.
    again = sign_in(client, ADMIN_PHONE, ADMIN_PIN, device)
    assert again["device"] is None and again["device_id"] == device.device_id
    assert mongo["devices"].count_documents({}) == 1


def test_wrong_pin_and_unknown_phone_look_the_same(client, mongo) -> None:
    insert_admin(mongo)
    for phone in (ADMIN_PHONE, "+26659999999"):
        response = client.post(f"{V1}/tokens", json=_pin(phone, "11112"))
        assert response.status_code == 401
        assert error_code(response) == "invalid_credentials"
        assert response.headers["www-authenticate"] == "Bearer"
    failures = list(mongo["audit_logs"].find({"action": {"$regex": "login_failed"}}))
    assert len(failures) == 2
    assert all("pin" not in str(entry.get("changes")) for entry in failures)

    bad_phone = client.post(f"{V1}/tokens", json=_pin("12", ADMIN_PIN))
    assert bad_phone.status_code == 422
    not_digits = client.post(f"{V1}/tokens", json=_pin(ADMIN_PHONE, "12a45"))
    assert not_digits.status_code == 422


def test_missing_and_garbage_tokens_are_401(client) -> None:
    assert error_code(client.get(f"{V1}/users/me")) == "unauthorized"
    response = client.get(f"{V1}/users/me", headers=bearer("not-a-jwt"))
    assert response.status_code == 401
    assert error_code(response) == "invalid_token"


def test_sign_in_upgrades_a_pin_hashed_with_old_parameters(client, mongo) -> None:
    insert_admin(mongo)
    old = PasswordHash((Argon2Hasher(),)).hash(ADMIN_PIN)
    mongo["users"].update_one({}, {"$set": {"pin_hash": old}})
    sign_in(client, ADMIN_PHONE, ADMIN_PIN)
    stored = mongo["users"].find_one({})["pin_hash"]
    assert stored != old
    assert "m=19456,t=2,p=1" in stored
    sign_in(client, ADMIN_PHONE, ADMIN_PIN)  # The upgraded hash still verifies.


def test_refresh_rotates_and_reuse_revokes_the_session(client, mongo) -> None:
    insert_admin(mongo)
    first = sign_in(client, ADMIN_PHONE, ADMIN_PIN)

    second = _refresh(client, first["refresh_token"])
    assert second.status_code == 200
    assert second.headers["cache-control"] == "no-store"
    second = second.json()
    assert second["refresh_token"] != first["refresh_token"]
    assert second["session_id"] == first["session_id"]

    third = _refresh(client, second["refresh_token"]).json()  # The successor is used...

    replay = _refresh(client, first["refresh_token"])  # ...so the first is a stolen copy.
    assert replay.status_code == 401
    assert error_code(replay) == "refresh_token_reused"

    # The whole session is dead now, including the legitimately rotated tokens.
    assert _refresh(client, third["refresh_token"]).status_code == 401
    response = client.get(f"{V1}/users/me", headers=bearer(third["access_token"]))
    assert error_code(response) == "session_revoked"
    assert mongo["audit_logs"].count_documents({"action": "session.reuse_detected"}) == 1


def test_refresh_retry_after_a_lost_response_still_works(client, mongo) -> None:
    insert_admin(mongo)
    first = sign_in(client, ADMIN_PHONE, ADMIN_PIN)
    lost = _refresh(client, first["refresh_token"]).json()  # The phone never saw this.

    retried = _refresh(client, first["refresh_token"])
    assert retried.status_code == 200
    retried = retried.json()
    assert retried["refresh_token"] not in (first["refresh_token"], lost["refresh_token"])
    # A second retry (that response lost too) works the same way.
    again = _refresh(client, first["refresh_token"]).json()

    # The undelivered tokens are dead; using one is treated as theft.
    assert error_code(_refresh(client, lost["refresh_token"])) == "refresh_token_reused"
    assert _refresh(client, again["refresh_token"]).status_code == 401


def test_refresh_retry_window_closes_once_the_successor_is_used(client, mongo) -> None:
    insert_admin(mongo)
    first = sign_in(client, ADMIN_PHONE, ADMIN_PIN)
    second = _refresh(client, first["refresh_token"]).json()
    assert _refresh(client, second["refresh_token"]).status_code == 200
    assert error_code(_refresh(client, first["refresh_token"])) == "refresh_token_reused"


def test_refresh_retry_window_expires(client, mongo) -> None:
    insert_admin(mongo)
    first = sign_in(client, ADMIN_PHONE, ADMIN_PIN)
    _refresh(client, first["refresh_token"])
    past = datetime.now(UTC) - timedelta(seconds=1)
    mongo["sessions"].update_one({}, {"$set": {"prev_valid_until": past}})
    assert error_code(_refresh(client, first["refresh_token"])) == "refresh_token_reused"


def test_admin_sessions_expire_sooner_than_owners(client, mongo) -> None:
    admin = admin_headers(client, mongo)
    owner = create_owner(client, admin)
    sessions = {s["user_id"]: s for s in mongo["sessions"].find()}
    admin_id = mongo["users"].find_one({"role": "system_admin"})["_id"]
    admin_left = sessions[admin_id]["expires_at"] - datetime.now(UTC)
    owner_left = sessions[UUID(owner.user["id"])]["expires_at"] - datetime.now(UTC)
    assert timedelta(hours=11) < admin_left <= timedelta(hours=12)
    assert owner_left > timedelta(days=29)


def test_logout_revokes_the_access_token_immediately(client, mongo) -> None:
    headers = admin_headers(client, mongo)
    assert client.delete(f"{V1}/sessions/current", headers=headers).status_code == 204
    response = client.get(f"{V1}/users/me", headers=headers)
    assert response.status_code == 401
    assert error_code(response) == "session_revoked"


def test_list_and_revoke_other_sessions(client, mongo) -> None:
    insert_admin(mongo)
    phone = bearer(sign_in(client, ADMIN_PHONE, ADMIN_PIN)["access_token"])
    tablet = sign_in(client, ADMIN_PHONE, ADMIN_PIN)

    listed = client.get(f"{V1}/sessions", headers=phone).json()["data"]
    assert len(listed) == 2
    assert sum(s["current"] for s in listed) == 1

    assert client.delete(f"{V1}/sessions/{tablet['session_id']}", headers=phone).status_code == 204
    assert client.get(f"{V1}/users/me", headers=bearer(tablet["access_token"])).status_code == 401
    assert client.delete(f"{V1}/sessions/{uuid4()}", headers=phone).status_code == 404


def test_temporary_pin_must_be_changed_first(client, mongo) -> None:
    admin = admin_headers(client, mongo)
    created = client.post(
        f"{V1}/users", json={"name": "K", "phone": "58123456", "role": "owner"}, headers=admin
    )
    assert created.status_code == 201
    assert created.headers["cache-control"] == "no-store"
    temporary = created.json()["temporary_pin"]
    assert created.json()["user"]["status"] == "active"
    assert created.json()["user"]["must_change_pin"] is True
    assert temporary not in str(mongo["audit_logs"].find_one({"action": "user.created"}))

    other_phone = bearer(sign_in(client, "+26658123456", temporary)["access_token"])
    tokens = sign_in(client, "+26658123456", temporary)
    assert tokens["user"]["must_change_pin"] is True
    headers = bearer(tokens["access_token"])

    blocked = client.get(f"{V1}/shops", headers=headers)
    assert blocked.status_code == 403
    assert error_code(blocked) == "pin_change_required"
    assert client.get(f"{V1}/users/me", headers=headers).status_code == 200  # Still allowed.

    def change(current: str, new: str):
        return client.put(
            f"{V1}/users/me/pin", json={"current_pin": current, "new_pin": new}, headers=headers
        )

    assert error_code(change("11112", "52914")) == "invalid_current_pin"
    assert change(temporary, "12345").status_code == 422  # Too easy to guess.
    assert error_code(change(temporary, temporary)) == "pin_reused"

    assert change(temporary, OWNER_PIN).status_code == 204
    assert client.get(f"{V1}/shops", headers=headers).status_code == 200
    assert client.get(f"{V1}/users/me", headers=other_phone).status_code == 401  # Signed out.
    sign_in(client, "+26658123456", OWNER_PIN)


def test_disabling_a_user_kills_their_sessions(client, mongo) -> None:
    admin = admin_headers(client, mongo)
    owner = create_owner(client, admin)

    assert client.delete(f"{V1}/users/{owner.user['id']}", headers=admin).status_code == 204
    assert client.get(f"{V1}/users/me", headers=owner.headers).status_code == 401
    disabled = client.post(f"{V1}/tokens", json=_pin(owner.phone, owner.pin))
    assert error_code(disabled) == "account_disabled"


def test_pin_attempts_are_rate_limited(client, mongo) -> None:
    insert_admin(mongo)
    body = _pin("+26659999999", "11112")  # Unknown number: never locks, only the limiter.
    codes = [client.post(f"{V1}/tokens", json=body).status_code for _ in range(6)]
    assert codes == [401] * 5 + [429]
    limited = client.post(f"{V1}/tokens", json=body)
    assert error_code(limited) == "rate_limited"
    assert int(limited.headers["retry-after"]) >= 1


def test_the_admin_locks_after_three_wrong_pins_and_each_lockout_doubles(
    make_client, mongo
) -> None:
    client = make_client(rate_limit_login_per_minute=100)
    insert_admin(mongo)
    wrong = _pin(ADMIN_PHONE, "11112")

    def lock_for() -> timedelta:
        for _ in range(3):
            assert client.post(f"{V1}/tokens", json=wrong).status_code == 401
        locked = client.post(f"{V1}/tokens", json=_pin(ADMIN_PHONE, ADMIN_PIN))
        assert locked.status_code == 423
        assert error_code(locked) == "account_locked"
        admin = mongo["users"].find_one({"phone": ADMIN_PHONE})
        return admin["locked_until"] - datetime.now(UTC)

    first = lock_for()
    assert timedelta(seconds=50) < first <= timedelta(seconds=60)
    mongo["users"].update_one({"phone": ADMIN_PHONE}, {"$set": {"locked_until": None}})
    second = lock_for()
    assert timedelta(seconds=110) < second <= timedelta(seconds=120)
    assert mongo["audit_logs"].count_documents({"action": "user.locked"}) == 2
    assert mongo["audit_logs"].count_documents({"action": "auth.admin_login_failed"}) == 6

    # The right PIN after the lockout resets the count.
    mongo["users"].update_one({"phone": ADMIN_PHONE}, {"$set": {"locked_until": None}})
    sign_in(client, ADMIN_PHONE, ADMIN_PIN)
    assert mongo["users"].find_one({"phone": ADMIN_PHONE})["lockouts"] == 0


def test_an_owner_locks_after_five_wrong_pins(make_client, mongo) -> None:
    client = make_client(rate_limit_login_per_minute=100)
    owner = create_owner(client, admin_headers(client, mongo))
    for _ in range(5):
        response = client.post(f"{V1}/tokens", json=_pin(owner.phone, "11112"))
        assert response.status_code == 401
    assert client.post(f"{V1}/tokens", json=_pin(owner.phone, owner.pin)).status_code == 423


def test_a_device_token_is_for_the_phone_not_a_person(client, mongo) -> None:
    owner = create_owner(client, admin_headers(client, mongo))
    headers = device_headers(client, owner.device)
    assert client.get(f"{V1}/devices/me/roster", headers=headers).status_code == 200
    as_person = client.get(f"{V1}/users/me", headers=headers)
    assert error_code(as_person) == "invalid_token"
    assert error_code(client.get(f"{V1}/devices/me/roster", headers=owner.headers)) == (
        "invalid_token"
    )

    wrong_secret = client.post(
        f"{V1}/tokens",
        json={
            "grant_type": "device",
            "device_id": owner.device.device_id,
            "device_secret": "x" * 43,
        },
    )
    assert error_code(wrong_secret) == "invalid_device"


def test_a_cashier_signs_in_with_only_a_pin_on_a_shop_phone(client, mongo) -> None:
    owner = create_owner(client, admin_headers(client, mongo))
    cashier, headers = create_cashier(client, owner)
    me = client.get(f"{V1}/users/me", headers=headers).json()
    assert me["id"] == cashier["user_id"] and me["phone"] is None

    # The owner's PIN on the same phone signs the owner in: the PIN says who it is.
    as_owner = sign_in_on_device(client, owner.device, owner.shop_id, owner.pin).json()
    assert as_owner["user"]["id"] == owner.user["id"]

    wrong = sign_in_on_device(client, owner.device, owner.shop_id, "11112")
    assert error_code(wrong) == "invalid_credentials"
    other_shop = sign_in_on_device(client, owner.device, str(uuid4()), owner.pin)
    assert error_code(other_shop) == "invalid_credentials"
