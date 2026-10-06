from app.core.db import Database
from app.repositories import server
from app.schemas.health import HealthResponse


async def check(db: Database) -> HealthResponse:
    mongo_ok = await server.ping(db)
    return HealthResponse(
        status="ok" if mongo_ok else "degraded", mongo="ok" if mongo_ok else "unreachable"
    )
