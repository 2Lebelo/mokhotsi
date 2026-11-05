"""The system admin's view of what phones could not sync as asked (see sync_issue_service)."""

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends

from app.core.deps import Caller, DbDep, require_permission
from app.core.errors import error_responses
from app.core.pagination import Page, PageParams, make_page, page_params
from app.core.permissions import Perm
from app.schemas.sync_issues import SyncIssueCount, SyncIssueOut
from app.services import sync_issue_service

router = APIRouter(prefix="/sync-issues", tags=["sync issues"])

ReadAll = Annotated[Caller, Depends(require_permission(Perm.SHOPS_READ_ALL))]
WriteAll = Annotated[Caller, Depends(require_permission(Perm.SHOPS_WRITE_ALL))]


@router.get(
    "",
    response_model=Page[SyncIssueOut],
    responses=error_responses(400, 401, 403),
    summary="Sync issues of every shop, newest first, with the shop, its owner and the phone",
)
async def list_sync_issues(
    db: DbDep,
    _: ReadAll,
    params: Annotated[PageParams, Depends(page_params)],
    status: Literal["open", "resolved"] = "open",
) -> Page[SyncIssueOut]:
    items, next_cursor = await sync_issue_service.list_issues(
        db, params, resolved=status == "resolved"
    )
    return make_page(items, next_cursor, params.limit)


@router.get(
    "/count",
    response_model=SyncIssueCount,
    responses=error_responses(401, 403),
    summary="How many sync issues are open",
)
async def count_sync_issues(db: DbDep, _: ReadAll) -> SyncIssueCount:
    return await sync_issue_service.count_open(db)


@router.post(
    "/{issue_id}/resolve",
    response_model=SyncIssueOut,
    responses=error_responses(401, 403, 404),
    summary="Mark a sync issue resolved (idempotent)",
)
async def resolve_sync_issue(issue_id: UUID, db: DbDep, caller: WriteAll) -> SyncIssueOut:
    return await sync_issue_service.resolve(db, caller, issue_id)
