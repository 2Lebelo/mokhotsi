"""Version 1 of the public API, mounted at /api/v1. Breaking changes go to /api/v2."""

from fastapi import APIRouter, Depends

from app.core.ratelimit import rate_limit
from app.routers.v1 import (
    audit_logs,
    devices,
    members,
    registrations,
    roles,
    sessions,
    shops,
    sync,
    sync_issues,
    tokens,
    users,
)

PREFIX = "/api/v1"

router = APIRouter(prefix=PREFIX, dependencies=[Depends(rate_limit)])
for module in (
    registrations,
    tokens,
    sessions,
    users,
    roles,
    shops,
    members,
    devices,
    audit_logs,
    sync,
    sync_issues,
):
    router.include_router(module.router)
