"""MongoDB client factory. Exactly one AsyncMongoClient per process, owned by the app lifespan."""

from collections.abc import Awaitable, Callable
from typing import Any

import pymongo
from pymongo import AsyncMongoClient
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.database import AsyncDatabase
from starlette.types import ASGIApp, Receive, Scope, Send

from app.core.config import Settings

# Plain aliases (not `type` statements) so FastAPI can introspect them inside Annotated[...].
Document = dict[str, Any]
Database = AsyncDatabase[Document]
Session = AsyncClientSession


def create_client(settings: Settings) -> AsyncMongoClient[Document]:
    """Build the process-wide client. It connects lazily; the lifespan closes it.

    No client-wide `timeoutMS`: it would also cut off startup index builds and CLI commands.
    HTTP requests get their deadline from `MongoDeadlineMiddleware` instead.
    """
    return AsyncMongoClient(
        settings.mongo_uri,
        appname="mokhotsi-api",
        tz_aware=True,
        uuidRepresentation="standard",
        serverSelectionTimeoutMS=5_000,
        maxPoolSize=50,
        maxIdleTimeMS=300_000,
    )


class MongoDeadlineMiddleware:
    """Give every request one deadline for all its MongoDB work (pymongo's client-side timeout).

    Without it a stalled primary or a failover holds requests (and pooled connections) open
    until the pool runs dry and the whole API stops answering. Expiry raises a PyMongoError
    with `timeout=True`, which the error handlers turn into 503.
    """

    def __init__(self, app: ASGIApp, seconds: float) -> None:
        self.app = app
        self.seconds = seconds

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        with pymongo.timeout(self.seconds):
            await self.app(scope, receive, send)


async def in_transaction[T](db: Database, fn: Callable[[Session], Awaitable[T]]) -> T:
    """Run `fn(session)` in a multi-document transaction (needs a replica set).

    `with_transaction` retries on transient errors, so `fn` must only touch the database
    (no external side effects) and must pass `session=` to every operation.
    """
    async with db.client.start_session() as session:
        return await session.with_transaction(fn)
