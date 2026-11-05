"""The roles collection, the data migration to owner/cashier, and the permissions contract."""

import asyncio
import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.core.db import create_client
from app.core.permissions import (
    CASHIER_DEFAULTS,
    CASHIER_GRANTABLE,
    OWNER_SHOP_PERMISSIONS,
    PERMISSION_DESCRIPTIONS,
    ROLE_DESCRIPTIONS,
    ROLE_NAMES,
    SHOP_SCOPE,
    Perm,
    Role,
)
from app.repositories.roles import builtin_definition, sync_builtin_roles
from app.repositories.setup import prepare_database
from tests.helpers import V1, admin_headers

CONTRACT = Path(__file__).resolve().parents[2] / "contracts" / "permissions.json"


def run(settings: Settings, fn: Callable[[Any], Any]) -> Any:
    async def go() -> Any:
        client = create_client(settings)
        try:
            return await fn(client[settings.mongo_db])
        finally:
            await client.close()

    return asyncio.run(go())


def test_the_permissions_contract_matches_the_code() -> None:
    contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
    assert set(contract["roles"]) == {r.value for r in Role}
    assert set(contract["shop_permissions"]) == {p.value for p in SHOP_SCOPE}
    assert contract["owner"] == "all" and OWNER_SHOP_PERMISSIONS == SHOP_SCOPE
    assert set(contract["cashier_defaults"]) == {p.value for p in CASHIER_DEFAULTS}
    assert set(contract["cashier_grantable"]) == {p.value for p in CASHIER_GRANTABLE}
    for perm, description in contract["shop_permissions"].items():
        assert PERMISSION_DESCRIPTIONS[Perm(perm)] == description
    for role, description in contract["roles"].items():
        assert ROLE_DESCRIPTIONS[Role(role)] == description


def test_every_role_and_permission_is_described() -> None:
    assert set(PERMISSION_DESCRIPTIONS) == set(Perm)
    assert set(ROLE_DESCRIPTIONS) == set(ROLE_NAMES) == set(Role)
    assert not CASHIER_DEFAULTS & CASHIER_GRANTABLE


@pytest.mark.requires_mongo
def test_startup_seeds_every_role_from_the_code(client: TestClient, mongo: Any) -> None:
    docs = {doc["_id"]: doc for doc in mongo["roles"].find()}
    assert set(docs) == {"system_admin", "owner", "cashier"}
    for role in Role:
        doc = docs[role.value]
        assert {k: doc[k] for k in builtin_definition(role)} == builtin_definition(role)
        assert doc["version"] == 1
    assert docs["owner"]["scope"] == "shop"
    assert docs["system_admin"]["shop_permissions"] == []
    assert "costs:read" in docs["cashier"]["grantable_shop_permissions"]
    assert mongo["audit_logs"].count_documents({"action": "role.created"}) == 3


@pytest.mark.requires_mongo
def test_syncing_again_changes_nothing(client: TestClient, mongo: Any, settings: Settings) -> None:
    before = list(mongo["roles"].find().sort("_id"))
    assert run(settings, sync_builtin_roles) == []
    run(settings, prepare_database)
    assert list(mongo["roles"].find().sort("_id")) == before
    assert mongo["audit_logs"].count_documents({"entity": "role"}) == 3


@pytest.mark.requires_mongo
def test_a_hand_edit_in_the_database_is_undone_and_audited(
    client: TestClient, mongo: Any, settings: Settings
) -> None:
    mongo["roles"].update_one({"_id": "cashier"}, {"$push": {"shop_permissions": "members:manage"}})
    assert run(settings, sync_builtin_roles) == ["cashier"]
    doc = mongo["roles"].find_one({"_id": "cashier"})
    assert doc["shop_permissions"] == sorted(CASHIER_DEFAULTS)
    assert doc["version"] == 2
    entry = mongo["audit_logs"].find_one({"action": "role.updated", "entity_id": "cashier"})
    assert entry is not None
    assert entry["changes"]["shop_permissions"]["to"] == sorted(CASHIER_DEFAULTS)


@pytest.mark.requires_mongo
def test_a_role_the_code_no_longer_has_is_retired_not_deleted(
    client: TestClient, mongo: Any, settings: Settings
) -> None:
    headers = admin_headers(client, mongo)
    mongo["roles"].insert_one(
        {**builtin_definition(Role.CASHIER), "_id": "shop_sitter", "version": 1}
    )
    assert run(settings, sync_builtin_roles) == ["shop_sitter"]
    assert mongo["roles"].find_one({"_id": "shop_sitter"})["retired"] is True
    assert mongo["audit_logs"].count_documents({"action": "role.retired"}) == 1
    listed = client.get(f"{V1}/roles", headers=headers).json()["data"]
    assert [r["name"] for r in listed] == ["cashier", "owner", "system_admin"]
    assert {r["name"]: r["title"] for r in listed}["owner"] == "Owner"
    # Role entries (string ids) appear in the admin's audit log without breaking it.
    logs = client.get(f"{V1}/audit-logs", headers=headers, params={"entity": "role"})
    assert logs.status_code == 200, logs.text
    assert {row["entity_id"] for row in logs.json()["data"]} >= {"cashier", "shop_sitter"}


@pytest.mark.requires_mongo
def test_old_role_names_in_the_database_are_migrated_once(
    client: TestClient, mongo: Any, settings: Settings
) -> None:
    # A database written by the previous version: old role names and the old partial index.
    mongo["schema_migrations"].delete_many({})
    mongo["memberships"].drop_index("cashier_one_shop")
    mongo["memberships"].create_index(
        "user_id", unique=True, name="sitter_one_shop", partialFilterExpression={"role": "sitter"}
    )
    mongo["users"].insert_many(
        [{"_id": "u-keeper", "role": "shop_keeper"}, {"_id": "u-sitter", "role": "shop_sitter"}]
    )
    mongo["memberships"].insert_many(
        [
            {"_id": "m1", "user_id": "u-keeper", "shop_id": "s1", "role": "keeper"},
            {"_id": "m2", "user_id": "u-sitter", "shop_id": "s1", "role": "sitter"},
        ]
    )
    run(settings, prepare_database)
    assert {d["_id"]: d["role"] for d in mongo["users"].find({"_id": {"$type": "string"}})} == {
        "u-keeper": "owner",
        "u-sitter": "cashier",
    }
    assert {d["_id"]: d["role"] for d in mongo["memberships"].find()} == {
        "m1": "owner",
        "m2": "cashier",
    }
    indexes = mongo["memberships"].index_information()
    assert "sitter_one_shop" not in indexes
    assert indexes["cashier_one_shop"]["partialFilterExpression"] == {"role": "cashier"}
    assert mongo["schema_migrations"].find_one({"_id": "0001-owner-cashier-roles"})
    # Recorded: a later start does not run it again.
    mongo["users"].insert_one({"_id": "u-late", "role": "shop_keeper"})
    run(settings, prepare_database)
    assert mongo["users"].find_one({"_id": "u-late"})["role"] == "shop_keeper"
