"""MongoDB client factory. Exactly one AsyncMongoClient per process, owned by the app lifespan."""

from collections.abc import Awaitable, Callable
from typing import Any

from pymongo import AsyncMongoClient
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.database import AsyncDatabase

from app.core.config import Settings

# Plain aliases (not `type` statements) so FastAPI can introspect them inside Annotated[...].
Document = dict[str, Any]
Database = AsyncDatabase[Document]
Session = AsyncClientSession


def create_client(settings: Settings) -> AsyncMongoClient[Document]:
    """Build the process-wide client. It connects lazily; the lifespan closes it."""
    return AsyncMongoClient(
        settings.mongo_uri,
        appname="mokhotsi-api",
        tz_aware=True,
        uuidRepresentation="standard",
        serverSelectionTimeoutMS=5_000,
    )


async def in_transaction[T](db: Database, fn: Callable[[Session], Awaitable[T]]) -> T:
    """Run `fn(session)` in a multi-document transaction (needs a replica set).

    `with_transaction` retries on transient errors, so `fn` must only touch the database
    (no external side effects) and must pass `session=` to every operation.
    """
    async with db.client.start_session() as session:
        return await session.with_transaction(fn)
