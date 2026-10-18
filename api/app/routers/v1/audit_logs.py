from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from app.core.deps import Caller, DbDep, ShopAccess, require_permission, require_shop_permission
from app.core.errors import error_responses
from app.core.pagination import Page, PageParams, make_page, page_params
from app.core.permissions import Perm
from app.schemas.audit import AuditLogOut
from app.services import audit_service

router = APIRouter(tags=["audit logs"])

Action = Annotated[str | None, Query(max_length=64, description="e.g. `member.updated`")]
Entity = Annotated[str | None, Query(max_length=32, description="e.g. `user`, `shop`, `member`")]
From = Annotated[datetime | None, Query(alias="from", description="Inclusive, ISO 8601")]
To = Annotated[datetime | None, Query(alias="to", description="Exclusive, ISO 8601")]


@router.get(
    "/audit-logs",
    response_model=Page[AuditLogOut],
    responses=error_responses(400, 401, 403),
    summary="System-wide audit log (newest first)",
)
async def list_audit_logs(
    db: DbDep,
    _: Annotated[Caller, Depends(require_permission(Perm.AUDIT_LOGS_READ_ALL))],
    params: Annotated[PageParams, Depends(page_params)],
    shop_id: UUID | None = None,
    actor_id: UUID | None = None,
    action: Action = None,
    entity: Entity = None,
    entity_id: UUID | None = None,
    created_from: From = None,
    created_to: To = None,
) -> Page[AuditLogOut]:
    items, next_cursor = await audit_service.list_logs(
        db,
        params,
        shop_id=shop_id,
        actor_id=actor_id,
        action=action,
        entity=entity,
        entity_id=entity_id,
        created_from=created_from,
        created_to=created_to,
    )
    return make_page(items, next_cursor, params.limit)


@router.get(
    "/shops/{shop_id}/audit-logs",
    response_model=Page[AuditLogOut],
    responses=error_responses(400, 401, 403, 404),
    summary="Everything done in one shop, by whom (newest first)",
)
async def list_shop_audit_logs(
    db: DbDep,
    access: Annotated[ShopAccess, Depends(require_shop_permission(Perm.AUDIT_LOGS_READ))],
    params: Annotated[PageParams, Depends(page_params)],
    actor_id: UUID | None = None,
    action: Action = None,
    entity: Entity = None,
    entity_id: UUID | None = None,
    created_from: From = None,
    created_to: To = None,
) -> Page[AuditLogOut]:
    items, next_cursor = await audit_service.list_logs(
        db,
        params,
        shop_id=access.shop_id,
        actor_id=actor_id,
        action=action,
        entity=entity,
        entity_id=entity_id,
        created_from=created_from,
        created_to=created_to,
    )
    return make_page(items, next_cursor, params.limit)
