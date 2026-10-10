"""Device sync (contracts/sync.schema.json). The shop comes from the path and the caller's
membership, never from the request body."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response

from app.core.deps import DbDep, ShopAccess, require_shop_permission
from app.core.errors import error_responses
from app.core.permissions import Perm
from app.schemas.sync import PULL_MAX_LIMIT, PullResponse, PushRequest, PushResponse
from app.services import sync_service

router = APIRouter(prefix="/shops/{shop_id}/sync", tags=["sync"])

# Every member can sell; what each op may change is checked per op (see sync_service).
PushAccess = Annotated[ShopAccess, Depends(require_shop_permission(Perm.SALES_CREATE))]
PullAccess = Annotated[ShopAccess, Depends(require_shop_permission(Perm.CATALOGUE_READ))]


@router.post(
    "/push",
    response_model=PushResponse,
    responses=error_responses(401, 403, 404, 422),
    summary="Apply up to 200 outbox ops from one device (idempotent by op_id)",
    description=(
        "Each op is acked or rejected with a reason; one bad op never fails the batch. "
        "An op_id that was already applied is acked again without being re-applied."
    ),
)
async def push(
    body: PushRequest, db: DbDep, access: PushAccess, response: Response
) -> PushResponse:
    response.headers["Cache-Control"] = "no-store"
    return await sync_service.push(db, access, body)


@router.get(
    "/pull",
    response_model=PullResponse,
    responses=error_responses(400, 401, 403, 404),
    summary="The shop's changes with seq after `cursor`, oldest first",
)
async def pull(
    db: DbDep,
    access: PullAccess,
    response: Response,
    cursor: Annotated[
        str | None,
        Query(max_length=18, description="next_cursor from the previous page (a seq); empty = 0"),
    ] = None,
    limit: Annotated[int, Query(ge=1, le=PULL_MAX_LIMIT)] = PULL_MAX_LIMIT,
) -> PullResponse:
    response.headers["Cache-Control"] = "no-store"
    return await sync_service.pull(db, access, cursor, limit)
