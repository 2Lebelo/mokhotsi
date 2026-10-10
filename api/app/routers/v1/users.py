from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status

from app.core.deps import (
    Caller,
    DbDep,
    IfMatchDep,
    PendingCallerDep,
    etag,
    require_permission,
)
from app.core.errors import error_responses
from app.core.idempotency import IDEMPOTENCY_OPTIONAL, IdempotentRoute
from app.core.pagination import Page, PageParams, make_page, page_params
from app.core.permissions import Perm, Role
from app.schemas.users import (
    MeOut,
    PasswordChange,
    PasswordResetCreate,
    UserCreate,
    UserOut,
    UserStatus,
    UserUpdate,
)
from app.services import user_service
from app.services.user_service import to_out

router = APIRouter(prefix="/users", tags=["users"], route_class=IdempotentRoute)

ReadUsers = Annotated[Caller, Depends(require_permission(Perm.USERS_READ))]
WriteUsers = Annotated[Caller, Depends(require_permission(Perm.USERS_WRITE))]


# --- The caller's own account (allowed while a temporary password is pending). ---


@router.get("/me", response_model=MeOut, responses=error_responses(401), summary="Your profile")
async def get_me(db: DbDep, caller: PendingCallerDep) -> MeOut:
    return await user_service.get_me(db, caller)


@router.put(
    "/me/password",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=error_responses(401, 422),
    summary="Change your password (signs out your other devices)",
)
async def change_my_password(db: DbDep, caller: PendingCallerDep, body: PasswordChange) -> None:
    await user_service.change_own_password(db, caller, body.current_password, body.new_password)


# --- User management (system admin). ---


@router.get(
    "",
    response_model=Page[UserOut],
    responses=error_responses(400, 401, 403),
    summary="List users",
)
async def list_users(
    db: DbDep,
    _: ReadUsers,
    params: Annotated[PageParams, Depends(page_params)],
    role: Role | None = None,
    status: UserStatus | None = None,
    q: Annotated[str | None, Query(max_length=100, description="Email prefix or name")] = None,
) -> Page[UserOut]:
    docs, next_cursor = await user_service.list_users(db, params, role, status, q)
    return make_page([to_out(d) for d in docs], next_cursor, params.limit)


@router.post(
    "",
    response_model=UserOut,
    status_code=status.HTTP_201_CREATED,
    responses=error_responses(401, 403, 409, 422),
    openapi_extra=IDEMPOTENCY_OPTIONAL,
    summary="Create a user (they must change the initial password on first sign-in)",
)
async def create_user(
    db: DbDep, caller: WriteUsers, body: UserCreate, response: Response
) -> UserOut:
    doc = await user_service.create_user(db, caller, body)
    response.headers["Location"] = f"/api/v1/users/{doc['_id']}"
    response.headers["ETag"] = etag(doc["version"])
    return to_out(doc)


@router.get(
    "/{user_id}",
    response_model=UserOut,
    responses=error_responses(401, 403, 404),
    summary="Get a user",
)
async def get_user(user_id: UUID, db: DbDep, _: ReadUsers, response: Response) -> UserOut:
    doc = await user_service.get_user(db, user_id)
    response.headers["ETag"] = etag(doc["version"])
    return to_out(doc)


@router.patch(
    "/{user_id}",
    response_model=UserOut,
    responses=error_responses(401, 403, 404, 409, 412, 422),
    summary="Update a user's name, role or status",
)
async def update_user(
    user_id: UUID,
    db: DbDep,
    caller: WriteUsers,
    body: UserUpdate,
    expected_version: IfMatchDep,
    response: Response,
) -> UserOut:
    doc = await user_service.update_user(db, caller, user_id, body, expected_version)
    response.headers["ETag"] = etag(doc["version"])
    return to_out(doc)


@router.delete(
    "/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=error_responses(401, 403, 404, 409),
    summary="Deactivate a user and sign them out everywhere",
)
async def deactivate_user(user_id: UUID, db: DbDep, caller: WriteUsers) -> None:
    await user_service.deactivate_user(db, caller, user_id)


@router.post(
    "/{user_id}/password-resets",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=error_responses(401, 403, 404, 422),
    openapi_extra=IDEMPOTENCY_OPTIONAL,
    summary="Set a temporary password (must be changed at next sign-in)",
)
async def reset_password(
    user_id: UUID, db: DbDep, caller: WriteUsers, body: PasswordResetCreate
) -> None:
    await user_service.get_user(db, user_id)
    await user_service.reset_password(db, caller.actor, user_id, body.new_password)
