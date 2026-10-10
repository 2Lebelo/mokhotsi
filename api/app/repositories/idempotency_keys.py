"""Stored outcomes of POSTs sent with an `Idempotency-Key`. Documents expire via a TTL index."""

import hashlib
from dataclasses import dataclass
from datetime import timedelta
from typing import Literal

from pymongo import ASCENDING, IndexModel
from pymongo.errors import DuplicateKeyError

from app.core.clock import utcnow
from app.core.db import Database

COLLECTION = "idempotency_keys"
INDEXES = [IndexModel([("expires_at", ASCENDING)], name="expires_at_ttl", expireAfterSeconds=0)]


@dataclass(frozen=True, slots=True)
class Stored:
    state: Literal["in_progress", "done"]
    request_hash: str
    status: int | None = None
    body: bytes | None = None
    headers: dict[str, str] | None = None


def _id(scope: str, key: str) -> str:
    return hashlib.sha256(f"{scope}\n{key}".encode()).hexdigest()


async def claim(
    db: Database, scope: str, key: str, request_hash: str, ttl: timedelta
) -> Stored | None:
    """Reserve the key. Returns None if we own it now, else what is already stored."""
    now = utcnow()
    try:
        await db[COLLECTION].insert_one(
            {
                "_id": _id(scope, key),
                "scope": scope,
                "request_hash": request_hash,
                "state": "in_progress",
                "created_at": now,
                "expires_at": now + ttl,
            }
        )
        return None
    except DuplicateKeyError:
        doc = await db[COLLECTION].find_one({"_id": _id(scope, key)})
        if doc is None:  # Expired between the insert and the read: treat as a fresh claim.
            return await claim(db, scope, key, request_hash, ttl)
        return Stored(
            state=doc["state"],
            request_hash=doc["request_hash"],
            status=doc.get("status"),
            body=doc.get("body"),
            headers=doc.get("headers"),
        )


async def complete(
    db: Database, scope: str, key: str, status: int, body: bytes, headers: dict[str, str]
) -> None:
    await db[COLLECTION].update_one(
        {"_id": _id(scope, key)},
        {"$set": {"state": "done", "status": status, "body": body, "headers": headers}},
    )


async def release(db: Database, scope: str, key: str) -> None:
    """Forget a claim whose request failed, so the client can retry with the same key."""
    await db[COLLECTION].delete_one({"_id": _id(scope, key), "state": "in_progress"})
