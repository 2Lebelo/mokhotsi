"""App factory. Run with: uvicorn app.main:create_app --factory"""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from redis.asyncio import Redis

from app.core.config import Settings, get_settings
from app.core.db import create_client
from app.core.errors import install_error_handlers
from app.core.logging import AccessLogMiddleware, configure_logging
from app.core.ratelimit import MemoryRateLimiter, RedisRateLimiter
from app.repositories.indexes import ensure_indexes
from app.routers import health, v1

log = logging.getLogger("app.main")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Own the process's MongoDB (and Redis) clients; ensure indexes on startup."""
    settings: Settings = app.state.settings
    client = create_client(settings)
    app.state.mongo = client
    app.state.db = client[settings.mongo_db]
    redis: Redis | None = None
    if settings.redis_url:
        redis = Redis.from_url(settings.redis_url, socket_timeout=1, socket_connect_timeout=1)
        app.state.limiter = RedisRateLimiter(redis)
    else:
        log.warning("REDIS_URL not set: rate limits are per-process (dev/test only)")
        app.state.limiter = MemoryRateLimiter()
    app.state.redis = redis
    try:
        await ensure_indexes(app.state.db)
        yield
    finally:
        await client.close()
        if redis is not None:
            await redis.aclose()


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)

    app = FastAPI(
        title=settings.app_name,
        version="1.0.0",
        summary="Mokhotsi shop API: users, shops, catalogue, sales and device sync.",
        lifespan=lifespan,
    )
    app.state.settings = settings

    if settings.cors_origins:  # Off by default.
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
            allow_headers=["Authorization", "Content-Type", "Idempotency-Key", "If-Match"],
            expose_headers=[
                "ETag",
                "Location",
                "Retry-After",
                "RateLimit-Limit",
                "RateLimit-Remaining",
                "RateLimit-Reset",
                "Idempotent-Replayed",
                "x-request-id",
            ],
        )
    app.add_middleware(AccessLogMiddleware)
    install_error_handlers(app)

    app.include_router(health.router)
    app.include_router(v1.router)
    return app
