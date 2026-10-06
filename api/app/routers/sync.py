from typing import Annotated

from fastapi import APIRouter, Query

from app.core.deps import CurrentShopDep, DbDep
from app.core.errors import NOT_IMPLEMENTED, UNAUTHORIZED
from app.schemas.sync import PULL_MAX_LIMIT, PullResponse, PushRequest, PushResponse
from app.services import sync_service

router = APIRouter(prefix="/sync", tags=["sync"])


@router.post(
    "/push",
    response_model=PushResponse,
    responses={**UNAUTHORIZED, **NOT_IMPLEMENTED},
    summary="Apply up to 200 outbox ops from one device (idempotent by op_id)",
)
async def push(body: PushRequest, db: DbDep, shop: CurrentShopDep) -> PushResponse:
    return await sync_service.push(db, shop, body)


@router.get(
    "/pull",
    response_model=PullResponse,
    responses={**UNAUTHORIZED, **NOT_IMPLEMENTED},
    summary="Changes for the caller's shop with seq after `cursor`, oldest first",
)
async def pull(
    db: DbDep,
    shop: CurrentShopDep,
    cursor: Annotated[str | None, Query(description="next_cursor from the previous page")] = None,
    limit: Annotated[int, Query(ge=1, le=PULL_MAX_LIMIT)] = PULL_MAX_LIMIT,
) -> PullResponse:
    return await sync_service.pull(db, shop, cursor, limit)
