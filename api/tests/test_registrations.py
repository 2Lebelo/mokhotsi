"""An owner registers on their phone, waits, and is approved or rejected by the system admin."""

import pytest

from tests.helpers import (
    OWNER_PIN,
    V1,
    admin_headers,
    approve,
    bearer,
    create_shop,
    error_code,
    new_device,
    register,
    sign_in,
    unique_phone,
)

pytestmark = pytest.mark.requires_mongo


def test_a_registered_owner_is_signed_in_but_can_do_nothing_until_approved(client, mongo) -> None:
    tokens = register(client, phone="5811 2233")
    assert tokens["user"]["status"] == "pending"
    assert tokens["user"]["phone"] == "+26658112233"
    assert tokens["device"]["device_secret"]
    headers = bearer(tokens["access_token"])

    me = client.get(f"{V1}/users/me", headers=headers).json()
    assert (me["status"], me["permissions"], me["memberships"]) == ("pending", [], [])
    blocked = client.post(f"{V1}/shops", json={"name": "Early", "pin": OWNER_PIN}, headers=headers)
    assert error_code(blocked) == "registration_pending"
    assert mongo["shops"].count_documents({}) == 0

    owner = mongo["users"].find_one({"phone": "+26658112233"})
    assert owner["pin_hash"] != OWNER_PIN and OWNER_PIN not in str(owner)
    registered = mongo["audit_logs"].find_one({"action": "user.registered"})
    assert "pin_hash" not in registered["changes"]

    # The queue the admin works through.
    admin = admin_headers(client, mongo)
    queue = client.get(f"{V1}/users?role=owner&status=pending", headers=admin).json()["data"]
    assert [u["phone"] for u in queue] == ["+26658112233"]

    approve(client, admin, tokens["user"]["id"])
    me = client.get(f"{V1}/users/me", headers=headers).json()  # Same session, now approved.
    assert me["status"] == "active" and "shops:create_own" in me["permissions"]
    shop = create_shop(client, headers, "Thaba Shop")
    assert shop["status"] == "active" and shop["my_role"] == "owner"
    assert client.get(f"{V1}/users?status=pending", headers=admin).json()["data"] == []
    assert mongo["audit_logs"].count_documents({"action": "user.approved"}) == 1


def test_a_rejected_owner_is_signed_out_and_told_why(client, mongo) -> None:
    tokens = register(client)
    admin = admin_headers(client, mongo)
    rejected = client.post(
        f"{V1}/users/{tokens['user']['id']}/reviews",
        json={"decision": "reject", "note": "Could not reach you on this number"},
        headers=admin,
    )
    assert rejected.status_code == 200
    assert rejected.json()["status"] == "rejected"
    assert rejected.json()["review_note"] == "Could not reach you on this number"

    assert client.get(f"{V1}/users/me", headers=bearer(tokens["access_token"])).status_code == 401
    phone = tokens["user"]["phone"]
    again = client.post(
        f"{V1}/tokens",
        json={"grant_type": "pin", "phone": phone, "pin": OWNER_PIN, "device": new_device()},
    )
    assert error_code(again) == "registration_rejected"

    # A decision is final, and status changes go through reviews, not PATCH.
    second = client.post(
        f"{V1}/users/{tokens['user']['id']}/reviews", json={"decision": "approve"}, headers=admin
    )
    assert error_code(second) == "not_pending"
    patched = client.patch(
        f"{V1}/users/{tokens['user']['id']}", json={"status": "active"}, headers=admin
    )
    assert error_code(patched) == "review_required"


def test_a_pending_owner_can_sign_in_on_another_phone(client, mongo) -> None:
    tokens = register(client)
    other = sign_in(client, tokens["user"]["phone"], OWNER_PIN)
    assert other["user"]["status"] == "pending"
    assert other["device_id"] != tokens["device_id"]


def test_registration_validation(client, mongo) -> None:
    phone = unique_phone()
    register(client, phone=phone)
    taken = client.post(
        f"{V1}/registrations",
        json={"name": "Again", "phone": phone, "pin": OWNER_PIN, "device": new_device()},
    )
    assert error_code(taken) == "phone_taken"

    for body in (
        {"name": "A", "phone": unique_phone(), "pin": "12345", "device": new_device()},
        {"name": "A", "phone": unique_phone(), "pin": "4081", "device": new_device()},
        {"name": "A", "phone": "+2665812", "pin": OWNER_PIN, "device": new_device()},
        {"name": "", "phone": unique_phone(), "pin": OWNER_PIN, "device": new_device()},
        {
            "name": "A",
            "phone": unique_phone(),
            "pin": OWNER_PIN,
            "device": new_device(),
            "role": "x",
        },
        {"name": "A", "phone": unique_phone(), "pin": OWNER_PIN},
    ):
        response = client.post(f"{V1}/registrations", json=body)
        assert response.status_code == 422, body


def test_registrations_are_rate_limited(make_client) -> None:
    client = make_client(rate_limit_register_per_hour=2)
    register(client)
    register(client)
    limited = client.post(
        f"{V1}/registrations",
        json={"name": "C", "phone": unique_phone(), "pin": OWNER_PIN, "device": new_device()},
    )
    assert error_code(limited) == "rate_limited"
