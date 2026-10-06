"""Server-level commands (not tied to a collection)."""

import logging

from pymongo.errors import PyMongoError

from app.core.db import Database

log = logging.getLogger("app.mongo")


async def ping(db: Database) -> bool:
    """True when MongoDB answers `ping` within the client's server-selection timeout."""
    try:
        await db.command("ping")
    except PyMongoError as exc:
        log.warning("mongo ping failed", extra={"error": str(exc)})
        return False
    return True
