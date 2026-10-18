"""Version 1 of the public API, mounted at /api/v1. Breaking changes go to /api/v2."""

from fastapi import APIRouter, Depends

from app.core.ratelimit import rate_limit
from app.routers.v1 import audit_logs, members, roles, sessions, shops, sync, tokens, users

PREFIX = "/api/v1"

router = APIRouter(prefix=PREFIX, dependencies=[Depends(rate_limit)])
for module in (tokens, sessions, users, roles, shops, members, audit_logs, sync):
    router.include_router(module.router)
