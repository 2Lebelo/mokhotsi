from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Response, status

from app.core.deps import DbDep, IfMatchDep, ShopAccess, etag, require_shop_permission
from app.core.errors import error_responses
from app.core.idempotency import IDEMPOTENCY_OPTIONAL, IdempotentRoute
from app.core.pagination import Page, PageParams, make_page, page_params
from app.core.permissions import MemberRole, Perm
from app.schemas.shops import MemberCreate, MemberOut, MemberUpdate
from app.schemas.users import PasswordResetCreate
from app.services import member_service

router = APIRouter(prefix="/shops/{shop_id}/members", tags=["members"], route_class=IdempotentRoute)

ReadMembers = Annotated[ShopAccess, Depends(require_shop_permission(Perm.MEMBERS_READ))]
ManageMembers = Annotated[ShopAccess, Depends(require_shop_permission(Perm.MEMBERS_MANAGE))]


@router.get(
    "",
    response_model=Page[MemberOut],
    responses=error_responses(400, 401, 403, 404),
    summary="The shop's keeper and sitters",
)
async def list_members(
    db: DbDep,
    access: ReadMembers,
    params: Annotated[PageParams, Depends(page_params)],
    role: MemberRole | None = None,
) -> Page[MemberOut]:
    items, next_cursor = await member_service.list_members(db, access, params, role)
    return make_page(items, next_cursor, params.limit)


@router.post(
    "",
    response_model=MemberOut,
    status_code=status.HTTP_201_CREATED,
    responses=error_responses(401, 403, 404, 409, 422),
    openapi_extra=IDEMPOTENCY_OPTIONAL,
    summary="Create a shop-sitter account in this shop",
)
async def create_member(
    db: DbDep, access: ManageMembers, body: MemberCreate, response: Response
) -> MemberOut:
    member = await member_service.create_sitter(db, access, body)
    response.headers["Location"] = f"/api/v1/shops/{access.shop_id}/members/{member.user_id}"
    response.headers["ETag"] = etag(member.version)
    return member


@router.get(
    "/{user_id}",
    response_model=MemberOut,
    responses=error_responses(401, 403, 404),
    summary="Get a member",
)
async def get_member(
    user_id: UUID, db: DbDep, access: ReadMembers, response: Response
) -> MemberOut:
    member = await member_service.get_member(db, access, user_id)
    response.headers["ETag"] = etag(member.version)
    return member


@router.patch(
    "/{user_id}",
    response_model=MemberOut,
    responses=error_responses(401, 403, 404, 409, 412, 422),
    summary="Replace a sitter's granted privileges",
)
async def update_member(
    user_id: UUID,
    db: DbDep,
    access: ManageMembers,
    body: MemberUpdate,
    expected_version: IfMatchDep,
    response: Response,
) -> MemberOut:
    member = await member_service.update_member(db, access, user_id, body, expected_version)
    response.headers["ETag"] = etag(member.version)
    return member


@router.delete(
    "/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=error_responses(401, 403, 404, 409),
    summary="Remove a sitter from the shop (their account is disabled)",
)
async def remove_member(user_id: UUID, db: DbDep, access: ManageMembers) -> None:
    await member_service.remove_sitter(db, access, user_id)


@router.post(
    "/{user_id}/password-resets",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=error_responses(401, 403, 404, 409, 422),
    openapi_extra=IDEMPOTENCY_OPTIONAL,
    summary="Set a temporary password for a sitter",
)
async def reset_member_password(
    user_id: UUID, db: DbDep, access: ManageMembers, body: PasswordResetCreate
) -> None:
    await member_service.reset_sitter_password(db, access, user_id, body.new_password)
