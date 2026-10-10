"""Small HTTP helpers shared by the API tests."""

from typing import Any
from uuid import uuid4

from fastapi.testclient import TestClient

from app.core.permissions import Role
from app.core.security import hash_password
from app.repositories import users

ADMIN_EMAIL = "admin@mokhotsi.co.ls"
ADMIN_PASSWORD = "admin-password-1"  # noqa: S105 — test fixture
TEMP_PASSWORD = "temporary-pass-1"  # noqa: S105
NEW_PASSWORD = "my-own-password-1"  # noqa: S105

V1 = "/api/v1"


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def insert_admin(mongo: Any, email: str = ADMIN_EMAIL, password: str = ADMIN_PASSWORD) -> None:
    """What `python -m app.cli create-admin` does, without the CLI."""
    mongo["users"].insert_one(
        users.new_user_doc(
            email=email,
            name="Admin",
            role=Role.SYSTEM_ADMIN,
            password_hash=hash_password(password),
            must_change_password=False,
            created_by=None,
        )
    )


def login(client: TestClient, email: str, password: str, **extra: Any) -> dict[str, Any]:
    response = client.post(
        f"{V1}/tokens",
        json={"grant_type": "password", "email": email, "password": password, **extra},
    )
    assert response.status_code == 200, response.text
    return response.json()


def admin_headers(client: TestClient, mongo: Any) -> dict[str, str]:
    insert_admin(mongo)
    return bearer(login(client, ADMIN_EMAIL, ADMIN_PASSWORD)["access_token"])


def activate(client: TestClient, email: str, temp: str = TEMP_PASSWORD) -> dict[str, str]:
    """Sign in with a temporary password and replace it; returns auth headers."""
    headers = bearer(login(client, email, temp)["access_token"])
    response = client.put(
        f"{V1}/users/me/password",
        json={"current_password": temp, "new_password": NEW_PASSWORD},
        headers=headers,
    )
    assert response.status_code == 204, response.text
    return headers


def create_keeper(
    client: TestClient, admin: dict[str, str], shop_name: str | None = "Main Shop"
) -> tuple[dict[str, Any], dict[str, str], str | None]:
    """Admin creates a keeper (optionally with a first shop); returns (user, headers, shop_id)."""
    email = f"keeper-{uuid4().hex[:8]}@mokhotsi.co.ls"
    body: dict[str, Any] = {
        "email": email,
        "name": "Keeper",
        "role": "shop_keeper",
        "password": TEMP_PASSWORD,
    }
    if shop_name:
        body["shop_name"] = shop_name
    response = client.post(f"{V1}/users", json=body, headers=admin)
    assert response.status_code == 201, response.text
    headers = activate(client, email)
    me = client.get(f"{V1}/users/me", headers=headers).json()
    shop_id = me["memberships"][0]["shop_id"] if me["memberships"] else None
    return response.json(), headers, shop_id


def create_sitter(
    client: TestClient, keeper: dict[str, str], shop_id: str, permissions: list[str] | None = None
) -> tuple[dict[str, Any], dict[str, str]]:
    email = f"sitter-{uuid4().hex[:8]}@mokhotsi.co.ls"
    response = client.post(
        f"{V1}/shops/{shop_id}/members",
        json={
            "email": email,
            "name": "Sitter",
            "password": TEMP_PASSWORD,
            "permissions": permissions or [],
        },
        headers=keeper,
    )
    assert response.status_code == 201, response.text
    return response.json(), activate(client, email)


def error_code(response: Any) -> str:
    return response.json()["error"]["code"]
