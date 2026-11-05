"""Operator commands. Owners register from the app; system admins are created here.

    uv run python -m app.cli export-openapi            # contracts/openapi.json (mobile types)
    uv run python -m app.cli seed-roles                # roles collection (also done at startup)
    uv run python -m app.cli seed-admin                # first admin, from SEED_ADMIN_* in .env
    uv run python -m app.cli seed-admin --reset-pin    # recover: new PIN, account re-enabled
    uv run python -m app.cli seed-admin --additional   # another admin, when one already exists

`seed-admin` signs the admin in with a phone number and 5-digit PIN (ADR 0005). It is safe to
run on every deploy: an existing admin is left unchanged unless `--reset-pin` is given. The PIN
is never printed or audited. Clear SEED_ADMIN_PIN from the environment once the admin exists.

Because one PIN guards every shop, the admin locks after fewer wrong PINs than other users
(ADMIN_PIN_MAX_FAILURES) and their sessions expire sooner (ADMIN_REFRESH_TOKEN_TTL_HOURS).
"""

import argparse
import asyncio
import json
import sys
from enum import StrEnum
from pathlib import Path
from typing import Any

from pydantic import SecretStr, TypeAdapter, ValidationError
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.core import audit
from app.core.audit import Actor
from app.core.config import ENV_FILE, Settings, get_settings
from app.core.credentials import check_pin, normalize_phone
from app.core.db import Database, Session, create_client, in_transaction
from app.core.errors import Conflict
from app.core.permissions import Role
from app.core.security import hash_pin
from app.repositories import roles, users
from app.repositories.setup import prepare_database
from app.schemas.common import Name

CLI_ACTOR = Actor.system("cli")
OPENAPI_CONTRACT = Path(__file__).resolve().parents[2] / "contracts" / "openapi.json"
_CREATED_FIELDS = ("phone", "name", "role", "status")


class AdminSeed(BaseSettings):
    """The first admin's credentials: SEED_ADMIN_* from the environment or `.env`."""

    model_config = SettingsConfigDict(
        env_prefix="SEED_ADMIN_", env_file=ENV_FILE, env_file_encoding="utf-8", extra="ignore"
    )

    phone: str = ""
    pin: SecretStr = SecretStr("")
    name: str = ""


class SeedOutcome(StrEnum):
    CREATED = "created"
    UNCHANGED = "unchanged"
    PIN_RESET = "pin_reset"


class SeedRefused(Exception):
    """The seed would be unsafe (e.g. promote a cashier); nothing was changed."""


def parse_seed(seed: AdminSeed, settings: Settings) -> tuple[str, str, str]:
    """Validated (E.164 phone, PIN, name). Raises ValueError naming the variable to fix."""
    if not seed.phone.strip():
        raise ValueError("SEED_ADMIN_PHONE is empty. Set it in api/.env.")
    if not seed.pin.get_secret_value():
        raise ValueError("SEED_ADMIN_PIN is empty. Set it in api/.env.")
    try:
        phone = normalize_phone(seed.phone, settings.default_country_code)
    except ValueError as exc:
        raise ValueError(f"SEED_ADMIN_PHONE: {exc}") from None
    pin = seed.pin.get_secret_value()
    try:
        check_pin(pin)
    except ValueError as exc:
        raise ValueError(f"SEED_ADMIN_PIN: {exc}") from None
    try:
        name = TypeAdapter(Name).validate_python(seed.name)
    except ValidationError:
        raise ValueError("SEED_ADMIN_NAME must be 1 to 120 characters.") from None
    return phone, pin, name


async def seed_admin(
    db: Database,
    *,
    phone: str,
    pin: str,
    name: str,
    reset_pin: bool = False,
    additional: bool = False,
) -> SeedOutcome:
    """Create the admin for `phone` (E.164) if missing. Idempotent; see the module docstring."""
    pin_hash = await hash_pin(pin)  # Outside the transaction: it may be retried.
    existing = await users.find_by_phone(db, phone)
    if existing is None:
        if not additional and await users.count_active_admins(db) > 0:
            raise SeedRefused(
                "An admin already exists with another phone number. Check SEED_ADMIN_PHONE, "
                "or pass --additional to add another admin."
            )
        doc = users.new_user_doc(
            phone=phone,
            pin_hash=pin_hash,
            name=name,
            role=Role.SYSTEM_ADMIN,
            created_by=None,
        )

        async def create(s: Session) -> None:
            await users.insert(db, doc, s)
            await audit.record(
                db,
                CLI_ACTOR,
                "user.created",
                entity="user",
                entity_id=doc["_id"],
                changes=audit.snapshot(doc, _CREATED_FIELDS),
                session=s,
            )

        try:
            await in_transaction(db, create)
        except Conflict:
            # Another run created it first; judge the result like any existing user.
            existing = await users.find_by_phone(db, phone)
            if existing is None:
                raise
        else:
            return SeedOutcome.CREATED

    if existing["role"] != Role.SYSTEM_ADMIN.value:
        raise SeedRefused(
            f"{phone} belongs to a {existing['role']} account. An existing user is never "
            "promoted to admin; use a different SEED_ADMIN_PHONE."
        )
    if not reset_pin:
        return SeedOutcome.UNCHANGED

    async def reset(s: Session) -> None:
        before = await users.get(db, existing["_id"], s)
        if before is None:
            raise SeedRefused(f"The admin for {phone} was removed while resetting the PIN.")
        after = await users.set_pin(db, before["_id"], pin_hash, s)
        if after["status"] != "active":
            after = await users.update(db, after["_id"], {"status": "active"}, session=s)
        await audit.record(
            db,
            CLI_ACTOR,
            "user.pin_reset",
            entity="user",
            entity_id=before["_id"],
            changes=audit.diff(before, after, ("status",)),
            session=s,
        )

    await in_transaction(db, reset)
    return SeedOutcome.PIN_RESET


async def _run_seed(settings: Settings, reset_pin: bool, additional: bool) -> SeedOutcome:
    phone, pin, name = parse_seed(AdminSeed(), settings)
    client = create_client(settings)
    try:
        db = client[settings.mongo_db]
        await prepare_database(db)  # Migrations, indexes and roles first.
        outcome = await seed_admin(
            db, phone=phone, pin=pin, name=name, reset_pin=reset_pin, additional=additional
        )
    finally:
        await client.close()
    message = {
        SeedOutcome.CREATED: f"Created system admin {phone}.",
        SeedOutcome.UNCHANGED: f"System admin {phone} already exists; nothing changed.",
        SeedOutcome.PIN_RESET: f"Reset the PIN of system admin {phone}.",
    }[outcome]
    print(message)
    if outcome is not SeedOutcome.UNCHANGED:
        print("Remove SEED_ADMIN_PIN from the environment now that it is stored (hashed).")
    return outcome


async def _run_seed_roles(settings: Settings) -> None:
    client = create_client(settings)
    try:
        db = client[settings.mongo_db]
        await prepare_database(db)
        names = [doc["_id"] for doc in await roles.list_active(db)]
    finally:
        await client.close()
    print(f"Roles in place: {', '.join(names)}.")


def openapi_document() -> dict[str, Any]:
    """The API description the mobile client's types are generated from (stable, no secrets)."""
    from app.main import create_app  # Not at import time: the app pulls in every router.

    settings = Settings(_env_file=None, jwt_secret="openapi-export-only-" + "x" * 32)  # type: ignore[call-arg]
    return create_app(settings).openapi()


def render_openapi() -> str:
    return json.dumps(openapi_document(), indent=2, ensure_ascii=False) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    commands = parser.add_subparsers(dest="command", required=True)
    seed = commands.add_parser(
        "seed-admin", help="Create the system admin from SEED_ADMIN_PHONE/PIN/NAME (idempotent)"
    )
    seed.add_argument(
        "--reset-pin",
        action="store_true",
        help="Set the PIN of the existing admin and re-enable the account",
    )
    seed.add_argument(
        "--additional", action="store_true", help="Allow another admin when one already exists"
    )
    commands.add_parser(
        "export-openapi", help="Write contracts/openapi.json, used to generate the app's types"
    )
    commands.add_parser(
        "seed-roles", help="Create or update the roles collection from the code (idempotent)"
    )
    args = parser.parse_args(argv)

    if args.command == "export-openapi":
        OPENAPI_CONTRACT.write_text(render_openapi(), encoding="utf-8", newline="\n")
        print(f"Wrote {OPENAPI_CONTRACT}")
        return 0

    if args.command == "seed-roles":
        asyncio.run(_run_seed_roles(get_settings()))
        return 0

    try:  # seed-admin
        asyncio.run(_run_seed(get_settings(), args.reset_pin, args.additional))
    except ValueError as exc:
        print(f"Invalid input: {exc}", file=sys.stderr)
        return 2
    except SeedRefused as exc:
        print(f"Refused: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
