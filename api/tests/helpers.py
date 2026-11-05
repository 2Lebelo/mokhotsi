"""Small HTTP helpers shared by the API tests: PIN sign-in, registered phones, approval."""

import asyncio
import itertools
from dataclasses import dataclass
from typing import Any

from fastapi.testclient import TestClient

from app.core.permissions import Role
from app.core.security import hash_pin
from app.repositories import users

ADMIN_PHONE = "+26650000001"
ADMIN_PIN = "40817"
OWNER_PIN = "52914"
CASHIER_PIN = "73051"

V1 = "/api/v1"

_phones = itertools.count(1)


def unique_phone() -> str:
    """A fresh Lesotho number (+266 and 8 digits) for each owner in a test run."""
    return f"+2666{next(_phones):07d}"  # The admin is +2665…


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def error_code(response: Any) -> str:
    return response.json()["error"]["code"]


def new_device(name: str = "Test phone") -> dict[str, str]:
    return {"name": name, "platform": "android"}


@dataclass(frozen=True)
class Device:
    device_id: str
    device_secret: str

    def credential(self) -> dict[str, str]:
        return {"device_id": self.device_id, "device_secret": self.device_secret}


def device_of(tokens: dict[str, Any]) -> Device:
    """The phone a sign-in or registration just registered."""
    issued = tokens["device"]
    assert issued is not None, "this sign-in reused a registered phone"
    return Device(issued["device_id"], issued["device_secret"])


def insert_admin(mongo: Any, phone: str = ADMIN_PHONE, pin: str = ADMIN_PIN) -> None:
    """What `python -m app.cli seed-admin` does, without the CLI."""
    mongo["users"].insert_one(
        users.new_user_doc(
            phone=phone,
            name="Admin",
            role=Role.SYSTEM_ADMIN,
            pin_hash=asyncio.run(hash_pin(pin)),
            created_by=None,
        )
    )


def sign_in(
    client: TestClient, phone: str, pin: str, device: Device | None = None
) -> dict[str, Any]:
    """PIN grant; registers a new phone unless `device` is given."""
    response = client.post(
        f"{V1}/tokens",
        json={
            "grant_type": "pin",
            "phone": phone,
            "pin": pin,
            "device": device.credential() if device else new_device(),
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def sign_in_on_device(client: TestClient, device: Device, shop_id: str, pin: str) -> Any:
    return client.post(
        f"{V1}/tokens",
        json={"grant_type": "device_pin", **device.credential(), "shop_id": shop_id, "pin": pin},
    )


def device_headers(client: TestClient, device: Device) -> dict[str, str]:
    response = client.post(f"{V1}/tokens", json={"grant_type": "device", **device.credential()})
    assert response.status_code == 200, response.text
    return bearer(response.json()["access_token"])


def admin_headers(client: TestClient, mongo: Any) -> dict[str, str]:
    insert_admin(mongo)
    return bearer(sign_in(client, ADMIN_PHONE, ADMIN_PIN)["access_token"])


def register(
    client: TestClient, phone: str | None = None, pin: str = OWNER_PIN, name: str = "Owner"
) -> dict[str, Any]:
    response = client.post(
        f"{V1}/registrations",
        json={"name": name, "phone": phone or unique_phone(), "pin": pin, "device": new_device()},
    )
    assert response.status_code == 201, response.text
    return response.json()


def approve(client: TestClient, admin: dict[str, str], user_id: str) -> None:
    response = client.post(
        f"{V1}/users/{user_id}/reviews", json={"decision": "approve"}, headers=admin
    )
    assert response.status_code == 200, response.text


def create_shop(
    client: TestClient, headers: dict[str, str], name: str, pin: str = OWNER_PIN
) -> dict[str, Any]:
    response = client.post(f"{V1}/shops", json={"name": name, "pin": pin}, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


@dataclass(frozen=True)
class Owner:
    user: dict[str, Any]
    headers: dict[str, str]
    shop_id: str | None
    device: Device  # The owner's phone, registered to shop_id
    phone: str
    pin: str


def create_owner(
    client: TestClient,
    admin: dict[str, str],
    shop_name: str | None = "Main Shop",
    pin: str = OWNER_PIN,
) -> Owner:
    """An owner registers on their phone, the admin approves, the owner opens a shop."""
    phone = unique_phone()
    tokens = register(client, phone, pin)
    approve(client, admin, tokens["user"]["id"])
    headers = bearer(tokens["access_token"])
    shop_id = create_shop(client, headers, shop_name, pin)["id"] if shop_name else None
    return Owner(tokens["user"], headers, shop_id, device_of(tokens), phone, pin)


def create_cashier(
    client: TestClient,
    owner: Owner,
    pin: str = CASHIER_PIN,
    permissions: list[str] | None = None,
    name: str = "Cashier",
    shop_id: str | None = None,
) -> tuple[dict[str, Any], dict[str, str]]:
    """The owner adds a cashier; the cashier signs in with their PIN on the owner's phone."""
    shop_id = shop_id or owner.shop_id
    assert shop_id is not None
    response = client.post(
        f"{V1}/shops/{shop_id}/members",
        json={"name": name, "pin": pin, "permissions": permissions or []},
        headers=owner.headers,
    )
    assert response.status_code == 201, response.text
    signed_in = sign_in_on_device(client, owner.device, shop_id, pin)
    assert signed_in.status_code == 200, signed_in.text
    return response.json(), bearer(signed_in.json()["access_token"])
