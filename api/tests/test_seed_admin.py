"""`python -m app.cli seed-admin`: the first system admin, signed in by phone number and PIN."""

import asyncio
from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app import cli
from app.cli import AdminSeed, SeedOutcome, SeedRefused, parse_seed, seed_admin
from app.core.config import Settings, get_settings
from app.core.db import create_client
from app.core.errors import Conflict
from app.core.permissions import Role
from app.core.security import hash_pin, verify_pin
from app.repositories import users
from app.repositories.setup import prepare_database
from tests.helpers import V1, admin_headers

PHONE = "+26658123456"
PIN = "48613"


def run(settings: Settings, fn: Callable[[Any], Any]) -> Any:
    """Run `fn(db)` on the test database with its own async client."""

    async def go() -> Any:
        client = create_client(settings)
        try:
            return await fn(client[settings.mongo_db])
        finally:
            await client.close()

    return asyncio.run(go())


def seed(settings: Settings, **kwargs: Any) -> SeedOutcome:
    values = {"phone": PHONE, "pin": PIN, "name": "Ops Admin", **kwargs}
    return run(settings, lambda db: seed_admin(db, **values))


def verify_password(pin: str, pin_hash: str) -> bool:
    return asyncio.run(verify_pin(pin, pin_hash))


def hash_password(pin: str) -> str:
    return asyncio.run(hash_pin(pin))


def admin_doc(mongo: Any, phone: str = PHONE) -> dict[str, Any]:
    doc = mongo["users"].find_one({"phone": phone})
    assert doc is not None
    return doc


def test_parse_seed_names_the_variable_to_fix_and_never_echoes_the_pin(
    settings: Settings,
) -> None:
    def parse(**values: Any) -> tuple[str, str, str]:
        base = {"phone": "5812 3456", "pin": SecretStr(PIN), "name": " Ops Admin "}
        return parse_seed(AdminSeed(_env_file=None, **{**base, **values}), settings)

    assert parse() == (PHONE, PIN, "Ops Admin")
    for values, message in [
        ({"phone": ""}, "SEED_ADMIN_PHONE is empty"),
        ({"pin": SecretStr("")}, "SEED_ADMIN_PIN is empty"),
        ({"phone": "12"}, "SEED_ADMIN_PHONE: "),
        ({"pin": SecretStr("12345")}, "SEED_ADMIN_PIN: "),
        ({"name": "  "}, "SEED_ADMIN_NAME"),
    ]:
        with pytest.raises(ValueError, match=message) as excinfo:
            parse(**values)
        assert "12345" not in str(excinfo.value)


def test_cli_rejects_bad_input_with_exit_code_2_before_touching_the_database(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # api/.env is not read (conftest): only the variables set here are seen.
    monkeypatch.setenv("SEED_ADMIN_PHONE", PHONE)
    monkeypatch.setenv("SEED_ADMIN_PIN", "11111")
    monkeypatch.setenv("MONGO_URI", "mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=1")
    get_settings.cache_clear()
    try:
        assert cli.main(["seed-admin"]) == 2
    finally:
        get_settings.cache_clear()
    captured = capsys.readouterr()
    assert "SEED_ADMIN_PIN" in captured.err
    assert "11111" not in captured.out + captured.err


@pytest.mark.requires_mongo
def test_seed_creates_a_phone_and_pin_admin_and_audits_it_without_the_pin(
    client: TestClient, mongo: Any, settings: Settings
) -> None:
    assert seed(settings) is SeedOutcome.CREATED
    doc = admin_doc(mongo)
    assert doc["role"] == Role.SYSTEM_ADMIN.value
    assert doc["status"] == "active"
    assert "email" not in doc and "password_hash" not in doc
    assert verify_password(PIN, doc["pin_hash"])
    assert PIN not in str(doc)
    entry = mongo["audit_logs"].find_one({"action": "user.created", "entity_id": doc["_id"]})
    assert entry is not None
    assert entry["changes"]["phone"] == PHONE
    assert PIN not in str(entry) and "pin_hash" not in entry["changes"]


@pytest.mark.requires_mongo
def test_seeding_again_changes_nothing_even_with_a_different_pin(
    client: TestClient, mongo: Any, settings: Settings
) -> None:
    seed(settings)
    before = admin_doc(mongo)
    assert seed(settings, pin="90210") is SeedOutcome.UNCHANGED
    after = admin_doc(mongo)
    assert after == before
    assert mongo["users"].count_documents({"role": Role.SYSTEM_ADMIN.value}) == 1


@pytest.mark.requires_mongo
def test_reset_pin_replaces_the_pin_lifts_a_lockout_and_re_enables_the_admin(
    client: TestClient, mongo: Any, settings: Settings
) -> None:
    seed(settings)
    mongo["users"].update_one(
        {"phone": PHONE}, {"$set": {"status": "disabled", "failed_logins": 7}}
    )
    assert seed(settings, pin="90210", reset_pin=True) is SeedOutcome.PIN_RESET
    doc = admin_doc(mongo)
    assert verify_password("90210", doc["pin_hash"])
    assert not verify_password(PIN, doc["pin_hash"])
    assert (doc["status"], doc["failed_logins"], doc["locked_until"]) == ("active", 0, None)
    entry = mongo["audit_logs"].find_one({"action": "user.pin_reset", "entity_id": doc["_id"]})
    assert entry is not None
    assert entry["changes"] == {"status": {"from": "disabled", "to": "active"}}


@pytest.mark.requires_mongo
def test_an_existing_non_admin_is_never_promoted(
    client: TestClient, mongo: Any, settings: Settings
) -> None:
    mongo["users"].insert_one(
        users.new_user_doc(
            phone=PHONE,
            pin_hash=hash_password("73019"),
            name="Owner",
            role=Role.OWNER,
            created_by=None,
        )
    )
    for reset_pin in (False, True):
        with pytest.raises(SeedRefused, match="never promoted"):
            seed(settings, reset_pin=reset_pin)
    doc = admin_doc(mongo)
    assert doc["role"] == Role.OWNER.value
    assert verify_password("73019", doc["pin_hash"])


@pytest.mark.requires_mongo
def test_a_second_admin_needs_additional_so_a_mistyped_phone_cannot_add_one(
    client: TestClient, mongo: Any, settings: Settings
) -> None:
    seed(settings)
    with pytest.raises(SeedRefused, match="--additional"):
        seed(settings, phone="+26657000001")
    assert mongo["users"].count_documents({"role": Role.SYSTEM_ADMIN.value}) == 1
    assert seed(settings, phone="+26657000001", additional=True) is SeedOutcome.CREATED
    assert mongo["users"].count_documents({"role": Role.SYSTEM_ADMIN.value}) == 2


@pytest.mark.requires_mongo
def test_phone_numbers_are_unique(client: TestClient, settings: Settings) -> None:
    seed(settings)
    doc = users.new_user_doc(
        phone=PHONE,
        pin_hash=hash_password("73019"),
        name="Someone",
        role=Role.OWNER,
        created_by=None,
    )
    with pytest.raises(Conflict) as excinfo:
        run(settings, lambda db: users.insert(db, doc))
    assert excinfo.value.code == "phone_taken"


@pytest.mark.requires_mongo
def test_a_phone_only_admin_is_listed_by_the_api(
    client: TestClient, mongo: Any, settings: Settings
) -> None:
    headers = admin_headers(client, mongo)  # Another admin, from the test helpers.
    seed(settings, additional=True)
    response = client.get(f"{V1}/users", headers=headers, params={"role": "system_admin"})
    assert response.status_code == 200, response.text
    listed = {row["phone"]: row for row in response.json()["data"]}
    assert listed[PHONE]["name"] == "Ops Admin"


@pytest.mark.requires_mongo
def test_startup_drops_the_email_indexes_now_that_everyone_signs_in_with_a_pin(
    client: TestClient, mongo: Any, settings: Settings
) -> None:
    mongo["users"].create_index("email", unique=True, name="email_unique")
    mongo["users"].create_index(
        "email",
        unique=True,
        name="email_unique_when_set",
        partialFilterExpression={"email": {"$type": "string"}},
    )
    run(settings, prepare_database)
    names = set(mongo["users"].index_information())
    assert not {"email_unique", "email_unique_when_set"} & names
    assert {"phone_unique_when_set", "role_status_created_at"} <= names
