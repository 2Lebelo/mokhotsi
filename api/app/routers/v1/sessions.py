from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status

from app.core.deps import CallerDep, DbDep, PendingCallerDep
from app.core.errors import error_responses
from app.core.pagination import Page, PageParams, make_page, page_params
from app.schemas.auth import SessionOut
from app.services import auth_service

router = APIRouter(prefix="/sessions", tags=["auth"])


@router.get(
    "",
    response_model=Page[SessionOut],
    responses=error_responses(400, 401, 403),
    summary="Your sign-ins across devices",
)
async def list_sessions(
    db: DbDep,
    caller: CallerDep,
    params: Annotated[PageParams, Depends(page_params)],
    active: Annotated[
        bool | None, Query(description="Only active (true) or revoked (false)")
    ] = True,
) -> Page[SessionOut]:
    items, next_cursor = await auth_service.list_sessions(db, caller, params, active)
    return make_page(items, next_cursor, params.limit)


@router.delete(
    "/current",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=error_responses(401),
    summary="Sign out of this device",
)
async def delete_current_session(db: DbDep, caller: PendingCallerDep) -> None:
    await auth_service.logout(db, caller)


@router.delete(
    "/{session_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=error_responses(401, 403, 404),
    summary="Sign another of your devices out",
)
async def delete_session(session_id: UUID, db: DbDep, caller: CallerDep) -> None:
    await auth_service.revoke_session(db, caller, session_id)
