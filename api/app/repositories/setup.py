"""Brings a database up to what this version of the code expects. Run at every API startup and
by the operator commands, before anything else touches the data. Every step is idempotent.

The order matters: an old index is dropped before the data it filtered on is migrated, and new
(possibly unique) indexes are built only on migrated data.
"""

import logging

from app.core.db import Database
from app.repositories import roles
from app.repositories.indexes import create_indexes, drop_legacy_indexes
from app.repositories.migrations import run_migrations

log = logging.getLogger("app.setup")


async def prepare_database(db: Database) -> None:
    await drop_legacy_indexes(db)
    await run_migrations(db)
    await create_indexes(db)
    changed = await roles.sync_builtin_roles(db)
    if changed:
        log.info("roles synced", extra={"roles": changed})
