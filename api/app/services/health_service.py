from redis.asyncio import Redis
from redis.exceptions import RedisError

from app.core.db import Database
from app.repositories import server
from app.schemas.health import HealthResponse


async def _redis_status(redis: Redis | None) -> str:
    if redis is None:
        return "disabled"
    try:
        await redis.ping()
    except RedisError:
        return "unreachable"
    return "ok"


async def check(db: Database, redis: Redis | None) -> HealthResponse:
    mongo_ok = await server.ping(db)
    return HealthResponse(
        status="ok" if mongo_ok else "degraded",
        mongo="ok" if mongo_ok else "unreachable",
        redis=await _redis_status(redis),
    )
