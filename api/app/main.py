"""App factory. Run with: uvicorn app.main:create_app --factory"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import Settings, get_settings
from app.core.db import create_client
from app.core.errors import install_error_handlers
from app.core.logging import AccessLogMiddleware, configure_logging
from app.repositories.indexes import ensure_indexes
from app.routers import auth, health, sync


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Open the process's single MongoDB client, ensure indexes, close the client on shutdown."""
    settings: Settings = app.state.settings
    client = create_client(settings)
    app.state.mongo = client
    app.state.db = client[settings.mongo_db]
    try:
        await ensure_indexes(app.state.db)
        yield
    finally:
        await client.close()


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)

    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        summary="Sync and backup target for the Mokhotsi app. Never in the checkout path.",
        lifespan=lifespan,
    )
    app.state.settings = settings

    if settings.cors_origins:  # Off by default.
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_methods=["GET", "POST"],
            allow_headers=["Authorization", "Content-Type"],
        )
    app.add_middleware(AccessLogMiddleware)
    install_error_handlers(app)

    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(sync.router)
    return app
