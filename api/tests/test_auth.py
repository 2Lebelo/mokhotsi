"""Sign-in, refresh rotation, revocation, forced password change, lockout and login limits."""

from uuid import UUID, uuid4

import pytest

from tests.helpers import (
    ADMIN_EMAIL,
    ADMIN_PASSWORD,
    NEW_PASSWORD,
    TEMP_PASSWORD,
    V1,
    admin_headers,
    bearer,
    error_code,
    insert_admin,
    login,
)

pytestmark = pytest.mark.requires_mongo


def _refresh(client, token: str):
    return client.post(f"{V1}/tokens", json={"grant_type": "refresh_token", "refresh_token": token})


def test_login_returns_tokens_and_profile(client, mongo) -> None:
    insert_admin(mongo)
    device_id = str(uuid4())
    tokens = login(client, ADMIN_EMAIL.upper(), ADMIN_PASSWORD, device_id=device_id)
    assert tokens["token_type"] == "bearer"  # noqa: S105
    assert tokens["expires_in"] == 15 * 60
    assert tokens["user"]["role"] == "system_admin"

    me = client.get(f"{V1}/users/me", headers=bearer(tokens["access_token"]))
    assert me.status_code == 200
    assert me.json()["email"] == ADMIN_EMAIL
    assert "users:write" in me.json()["permissions"]

    session = mongo["sessions"].find_one({"_id": UUID(tokens["session_id"])})
    assert str(session["device_id"]) == device_id
    assert "refresh_hash" in session and tokens["refresh_token"] not in str(session)
    assert mongo["audit_logs"].count_documents({"action": "session.created"}) == 1


def test_wrong_password_and_unknown_email_look_the_same(client, mongo) -> None:
    insert_admin(mongo)
    for email in (ADMIN_EMAIL, "nobody@mokhotsi.co.ls"):
        response = client.post(
            f"{V1}/tokens", json={"grant_type": "password", "email": email, "password": "wrong-1"}
        )
        assert response.status_code == 401
        assert error_code(response) == "invalid_credentials"
        assert response.headers["www-authenticate"] == "Bearer"
    assert mongo["audit_logs"].count_documents({"action": "auth.login_failed"}) == 2


def test_missing_and_garbage_tokens_are_401(client) -> None:
    assert error_code(client.get(f"{V1}/users/me")) == "unauthorized"
    response = client.get(f"{V1}/users/me", headers=bearer("not-a-jwt"))
    assert response.status_code == 401
    assert error_code(response) == "invalid_token"


def test_refresh_rotates_and_reuse_revokes_the_session(client, mongo) -> None:
    insert_admin(mongo)
    first = login(client, ADMIN_EMAIL, ADMIN_PASSWORD)

    second = _refresh(client, first["refresh_token"])
    assert second.status_code == 200
    assert second.headers["cache-control"] == "no-store"
    second = second.json()
    assert second["refresh_token"] != first["refresh_token"]
    assert second["session_id"] == first["session_id"]

    replay = _refresh(client, first["refresh_token"])  # A stolen, already-used token.
    assert replay.status_code == 401
    assert error_code(replay) == "refresh_token_reused"

    # The whole session is dead now, including the legitimately rotated tokens.
    assert _refresh(client, second["refresh_token"]).status_code == 401
    response = client.get(f"{V1}/users/me", headers=bearer(second["access_token"]))
    assert error_code(response) == "session_revoked"
    assert mongo["audit_logs"].count_documents({"action": "session.reuse_detected"}) == 1


def test_logout_revokes_the_access_token_immediately(client, mongo) -> None:
    headers = admin_headers(client, mongo)
    assert client.delete(f"{V1}/sessions/current", headers=headers).status_code == 204
    response = client.get(f"{V1}/users/me", headers=headers)
    assert response.status_code == 401
    assert error_code(response) == "session_revoked"


def test_list_and_revoke_other_sessions(client, mongo) -> None:
    insert_admin(mongo)
    phone = bearer(login(client, ADMIN_EMAIL, ADMIN_PASSWORD)["access_token"])
    tablet = login(client, ADMIN_EMAIL, ADMIN_PASSWORD)

    listed = client.get(f"{V1}/sessions", headers=phone).json()["data"]
    assert len(listed) == 2
    assert sum(s["current"] for s in listed) == 1

    assert client.delete(f"{V1}/sessions/{tablet['session_id']}", headers=phone).status_code == 204
    assert client.get(f"{V1}/users/me", headers=bearer(tablet["access_token"])).status_code == 401
    assert client.delete(f"{V1}/sessions/{uuid4()}", headers=phone).status_code == 404


def test_temporary_password_must_be_changed_first(client, mongo) -> None:
    admin = admin_headers(client, mongo)
    created = client.post(
        f"{V1}/users",
        json={
            "email": "k@mokhotsi.co.ls",
            "name": "K",
            "role": "shop_keeper",
            "password": TEMP_PASSWORD,
        },
        headers=admin,
    )
    assert created.status_code == 201

    other_device = bearer(login(client, "k@mokhotsi.co.ls", TEMP_PASSWORD)["access_token"])
    tokens = login(client, "k@mokhotsi.co.ls", TEMP_PASSWORD)
    assert tokens["user"]["must_change_password"] is True
    headers = bearer(tokens["access_token"])

    blocked = client.get(f"{V1}/shops", headers=headers)
    assert blocked.status_code == 403
    assert error_code(blocked) == "password_change_required"
    assert client.get(f"{V1}/users/me", headers=headers).status_code == 200  # Still allowed.

    wrong = client.put(
        f"{V1}/users/me/password",
        json={"current_password": "nope-nope", "new_password": NEW_PASSWORD},
        headers=headers,
    )
    assert error_code(wrong) == "invalid_current_password"
    same = client.put(
        f"{V1}/users/me/password",
        json={"current_password": TEMP_PASSWORD, "new_password": TEMP_PASSWORD},
        headers=headers,
    )
    assert error_code(same) == "password_reused"

    changed = client.put(
        f"{V1}/users/me/password",
        json={"current_password": TEMP_PASSWORD, "new_password": NEW_PASSWORD},
        headers=headers,
    )
    assert changed.status_code == 204
    assert client.get(f"{V1}/shops", headers=headers).status_code == 200
    assert client.get(f"{V1}/users/me", headers=other_device).status_code == 401  # Signed out.
    login(client, "k@mokhotsi.co.ls", NEW_PASSWORD)


def test_disabling_a_user_kills_their_sessions(client, mongo) -> None:
    admin = admin_headers(client, mongo)
    user = client.post(
        f"{V1}/users",
        json={
            "email": "k@mokhotsi.co.ls",
            "name": "K",
            "role": "shop_keeper",
            "password": TEMP_PASSWORD,
        },
        headers=admin,
    ).json()
    headers = bearer(login(client, "k@mokhotsi.co.ls", TEMP_PASSWORD)["access_token"])

    assert client.delete(f"{V1}/users/{user['id']}", headers=admin).status_code == 204
    response = client.get(f"{V1}/users/me", headers=headers)
    assert response.status_code == 401
    disabled = client.post(
        f"{V1}/tokens",
        json={"grant_type": "password", "email": "k@mokhotsi.co.ls", "password": TEMP_PASSWORD},
    )
    assert error_code(disabled) == "account_disabled"


def test_login_attempts_are_rate_limited(client, mongo) -> None:
    insert_admin(mongo)
    body = {"grant_type": "password", "email": ADMIN_EMAIL, "password": "wrong-1"}
    codes = [client.post(f"{V1}/tokens", json=body).status_code for _ in range(6)]
    assert codes == [401] * 5 + [429]
    limited = client.post(f"{V1}/tokens", json=body)
    assert error_code(limited) == "rate_limited"
    assert int(limited.headers["retry-after"]) >= 1


def test_account_locks_after_repeated_failures(make_client, mongo) -> None:
    client = make_client(login_max_failures=3, rate_limit_login_per_minute=100)
    insert_admin(mongo)
    body = {"grant_type": "password", "email": ADMIN_EMAIL, "password": "wrong-1"}
    for _ in range(3):
        assert client.post(f"{V1}/tokens", json=body).status_code == 401
    locked = client.post(f"{V1}/tokens", json={**body, "password": ADMIN_PASSWORD})
    assert locked.status_code == 423
    assert error_code(locked) == "account_locked"
    assert int(locked.headers["retry-after"]) > 0
    assert mongo["audit_logs"].count_documents({"action": "user.locked"}) == 1
