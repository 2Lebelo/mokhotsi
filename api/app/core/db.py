"""MongoDB client factory. Exactly one AsyncMongoClient per process, owned by the app lifespan."""

from typing import Any

from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.core.config import Settings

# Plain aliases (not `type` statements) so FastAPI can introspect them inside Annotated[...].
Document = dict[str, Any]
Database = AsyncDatabase[Document]


def create_client(settings: Settings) -> AsyncMongoClient[Document]:
    """Build the process-wide client. It connects lazily; the lifespan closes it."""
    return AsyncMongoClient(
        settings.mongo_uri,
        appname="mokhotsi-api",
        tz_aware=True,
        uuidRepresentation="standard",
        serverSelectionTimeoutMS=5_000,
    )
