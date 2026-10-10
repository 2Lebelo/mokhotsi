"""Helpers shared by repositories."""

from pymongo import ReturnDocument
from pymongo.asynchronous.collection import AsyncCollection

from app.core.clock import utcnow
from app.core.db import Document, Session
from app.core.errors import NotFound, PreconditionFailed


async def versioned_update(
    collection: AsyncCollection[Document],
    query: Document,
    changes: Document,
    *,
    expected_version: int | None,
    not_found: str,
    session: Session | None = None,
) -> Document:
    """Apply `$set: changes` and bump `version` (optimistic concurrency).

    With `expected_version` (from If-Match), a stale version raises 412 instead of silently
    overwriting someone else's edit. Returns the updated document.
    """
    full_query = dict(query)
    if expected_version is not None:
        full_query["version"] = expected_version
    updated = await collection.find_one_and_update(
        full_query,
        {"$set": {**changes, "updated_at": utcnow()}, "$inc": {"version": 1}},
        return_document=ReturnDocument.AFTER,
        session=session,
    )
    if updated is not None:
        return updated
    if expected_version is not None and await collection.count_documents(
        query, limit=1, session=session
    ):
        raise PreconditionFailed("The resource changed since you read it", code="version_mismatch")
    raise NotFound(not_found)
