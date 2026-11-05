"""Device sync (contracts/sync.v2.schema.json) and photo storage. Every route is authenticated by
the phone's device token; the shop comes from the path and the phone's registration, never from
a request body. Nothing here is cached by clients or proxies."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, Response

from app.core.deps import DbDep, DeviceShopAccess, SettingsDep, require_device_shop
from app.core.errors import PayloadTooLarge, error_responses
from app.schemas.sync import (
    PULL_MAX_LIMIT,
    SNAPSHOT_MAX_LIMIT,
    PhotoConfirmRequest,
    PhotoConfirmResponse,
    PhotoUploadsRequest,
    PhotoUploadsResponse,
    PhotoUrlsRequest,
    PhotoUrlsResponse,
    PullResponse,
    PushRequest,
    PushResponse,
    SnapshotEntity,
    SnapshotResponse,
)
from app.schemas.sync_issues import SyncIssuesReport, SyncIssuesReported
from app.services import photo_service, sync_issue_service, sync_pull, sync_push

router = APIRouter(prefix="/shops/{shop_id}/sync", tags=["sync"])

WriteAccess = Annotated[DeviceShopAccess, Depends(require_device_shop(write=True))]
ReadAccess = Annotated[DeviceShopAccess, Depends(require_device_shop(write=False))]

# 200 ops with embedding vectors (~3.4 KB each) stay well below this.
MAX_PUSH_BYTES = 2_000_000


async def _push_size(request: Request) -> None:
    length = request.headers.get("content-length")
    size = int(length) if length and length.isdigit() else len(await request.body())
    if size > MAX_PUSH_BYTES:
        raise PayloadTooLarge(f"Send at most {MAX_PUSH_BYTES} bytes per push; split the batch")


def _no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"


@router.post(
    "/push",
    response_model=PushResponse,
    responses=error_responses(401, 403, 404, 413, 422, 426),
    dependencies=[Depends(_push_size)],
    summary="Apply up to 200 outbox ops from this phone (idempotent by op_id)",
    description=(
        "Each op is acked or rejected with a code; one bad op never fails the batch. Acked ops "
        "that need the owner's attention (e.g. a sale by a removed cashier) are also listed in "
        "`flagged`. An op_id that was already applied is acked again without being re-applied."
    ),
)
async def push(
    body: PushRequest, db: DbDep, access: WriteAccess, response: Response
) -> PushResponse:
    _no_store(response)
    return await sync_push.push(db, access, body)


@router.get(
    "/pull",
    response_model=PullResponse,
    responses=error_responses(400, 401, 404, 410),
    summary="The shop's changes after `cursor`, oldest first (current state per record)",
    description="410 `cursor_expired`: the history was pruned; download a snapshot again.",
)
async def pull(
    db: DbDep,
    access: ReadAccess,
    response: Response,
    cursor: Annotated[
        str | None,
        Query(max_length=18, description="next_cursor from the previous page; empty = 0"),
    ] = None,
    limit: Annotated[int, Query(ge=1, le=PULL_MAX_LIMIT)] = PULL_MAX_LIMIT,
) -> PullResponse:
    _no_store(response)
    return await sync_pull.pull(db, access, cursor, limit)


@router.get(
    "/snapshot",
    response_model=SnapshotResponse,
    responses=error_responses(400, 401, 404, 422),
    summary="One page of the shop's current state, for a phone joining the shop",
    description=(
        "Every product, stock level and embedding (of `model_version`), and sales and reversals "
        "from the last 90 days. Keep the first page's `snapshot_seq` and pull from it after."
    ),
)
async def snapshot(
    db: DbDep,
    access: ReadAccess,
    response: Response,
    entity: SnapshotEntity,
    after: Annotated[str | None, Query(max_length=80)] = None,
    limit: Annotated[int, Query(ge=1, le=SNAPSHOT_MAX_LIMIT)] = SNAPSHOT_MAX_LIMIT,
    model_version: Annotated[str | None, Query(max_length=120)] = None,
) -> SnapshotResponse:
    _no_store(response)
    return await sync_pull.snapshot(db, access, entity, after, limit, model_version)


@router.post(
    "/photos/uploads",
    response_model=PhotoUploadsResponse,
    responses=error_responses(401, 403, 404, 422, 503),
    summary="Signed upload tickets for up to 50 images (photos or correction crops)",
    description=(
        "For each image the shop does not have yet: Cloudinary's upload URL and the form fields "
        "to send unchanged, plus `file`. Then confirm the uploads."
    ),
)
async def photo_uploads(
    body: PhotoUploadsRequest,
    db: DbDep,
    settings: SettingsDep,
    access: WriteAccess,
    response: Response,
) -> PhotoUploadsResponse:
    _no_store(response)
    return await photo_service.tickets(db, settings, access, body)


@router.post(
    "/photos/confirm",
    response_model=PhotoConfirmResponse,
    responses=error_responses(401, 403, 404, 422, 503),
    summary="Record uploads Cloudinary accepted (its signed response proves each one)",
)
async def photo_confirm(
    body: PhotoConfirmRequest,
    db: DbDep,
    settings: SettingsDep,
    access: WriteAccess,
    response: Response,
) -> PhotoConfirmResponse:
    _no_store(response)
    return await photo_service.confirm(db, settings, access, body)


@router.post(
    "/photos/urls",
    response_model=PhotoUrlsResponse,
    responses=error_responses(401, 404, 422, 503),
    summary="Signed download URLs for up to 100 of the shop's images, by content hash",
)
async def photo_urls(
    body: PhotoUrlsRequest,
    db: DbDep,
    settings: SettingsDep,
    access: ReadAccess,
    response: Response,
) -> PhotoUrlsResponse:
    _no_store(response)
    return await photo_service.urls(db, settings, access, body)


@router.post(
    "/issues",
    response_model=SyncIssuesReported,
    responses=error_responses(401, 404, 422),
    summary="Report up to 100 things this phone could not sync as asked (for the system admin)",
    description=(
        "Refused or flagged changes, and records from other phones that did not fit. Idempotent "
        "by issue id; works while the shop is suspended. The phone may forget what is accepted."
    ),
)
async def report_issues(
    body: SyncIssuesReport, db: DbDep, access: ReadAccess, response: Response
) -> SyncIssuesReported:
    _no_store(response)
    return await sync_issue_service.report(db, access, body)
