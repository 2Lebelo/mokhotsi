"""Operator commands. There is no public sign-up: the first system admin is created here.

    uv run python -m app.cli create-admin --email admin@example.com --name "Ops Admin"

The password is read from ADMIN_PASSWORD if set (for automation), otherwise prompted for.
"""

import argparse
import asyncio
import getpass
import os
import sys

from pydantic import TypeAdapter, ValidationError

from app.core import audit
from app.core.audit import Actor
from app.core.config import get_settings
from app.core.db import Session, create_client, in_transaction
from app.core.errors import Conflict
from app.core.permissions import Role
from app.core.security import hash_password
from app.repositories import users
from app.repositories.indexes import ensure_indexes
from app.schemas.common import Email, Password


async def create_admin(email: str, name: str, password: str) -> None:
    settings = get_settings()
    client = create_client(settings)
    db = client[settings.mongo_db]
    try:
        await ensure_indexes(db)
        doc = users.new_user_doc(
            email=email,
            name=name,
            role=Role.SYSTEM_ADMIN,
            password_hash=hash_password(password),
            must_change_password=False,  # They chose it themselves.
            created_by=None,
        )

        async def write(s: Session) -> None:
            await users.insert(db, doc, s)
            await audit.record(
                db,
                Actor.system("cli"),
                "user.created",
                entity="user",
                entity_id=doc["_id"],
                changes=audit.snapshot(doc, ("email", "name", "role", "status")),
                session=s,
            )

        await in_transaction(db, write)
        print(f"Created system admin {doc['email']} ({doc['_id']})")
    finally:
        await client.close()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    commands = parser.add_subparsers(dest="command", required=True)
    admin = commands.add_parser("create-admin", help="Create a system admin account")
    admin.add_argument("--email", required=True)
    admin.add_argument("--name", required=True)
    args = parser.parse_args(argv)

    password = os.environ.get("ADMIN_PASSWORD") or getpass.getpass("Password (min 8 chars): ")
    try:
        email = str(TypeAdapter(Email).validate_python(args.email))
        TypeAdapter(Password).validate_python(password)
    except ValidationError as exc:
        print(f"Invalid input: {exc.errors()[0]['msg']}", file=sys.stderr)
        return 2
    try:
        asyncio.run(create_admin(email, args.name, password))
    except Conflict as exc:
        print(exc.message, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
