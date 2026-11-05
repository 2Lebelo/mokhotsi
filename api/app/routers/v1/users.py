from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, Response, status

from app.core.deps import (
    Caller,
    DbDep,
    IfMatchDep,
    PendingCallerDep,
    SettingsDep,
    etag,
    require_permission,
)
from app.core.errors import error_responses
from app.core.idempotency import IDEMPOTENCY_OPTIONAL, IDEMPOTENCY_UNSUPPORTED, IdempotentRoute
from app.core.pagination import Page, PageParams, make_page, page_params
from app.core.permissions import Perm, Role
from app.schemas.auth import UserStatus
from app.schemas.users import (
    MeOut,
    PinChange,
    PinResetOut,
    ReviewCreate,
    UserCreate,
    UserCreated,
    UserOut,
    UserUpdate,
)
from app.services import user_service
from app.services.user_service import to_out

router = APIRouter(prefix="/users", tags=["users"], route_class=IdempotentRoute)

ReadUsers = Annotated[Caller, Depends(require_permission(Perm.USERS_READ))]
WriteUsers = Annotated[Caller, Depends(require_permission(Perm.USERS_WRITE))]


# --- The caller's own account (allowed while pending approval or with a temporary PIN). ---


@router.get("/me", response_model=MeOut, responses=error_responses(401), summary="Your profile")
async def get_me(db: DbDep, caller: PendingCallerDep) -> MeOut:
    return await user_service.get_me(db, caller)


@router.put(
    "/me/pin",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=error_responses(401, 409, 422, 429),
    summary="Change your PIN in every shop (signs out your other phones)",
    description="`pin_taken` (409): someone in one of your shops has that PIN; choose another.",
)
async def change_my_pin(
    request: Request, db: DbDep, settings: SettingsDep, caller: PendingCallerDep, body: PinChange
) -> None:
    await user_service.change_own_pin(request, db, settings, caller, body.current_pin, body.new_pin)


# --- User management and owner approval (system admin). ---


@router.get(
    "",
    response_model=Page[UserOut],
    responses=error_responses(400, 401, 403),
    summary="List users (the approval queue: role=owner&status=pending)",
)
async def list_users(
    db: DbDep,
    _: ReadUsers,
    params: Annotated[PageParams, Depends(page_params)],
    role: Role | None = None,
    status: UserStatus | None = None,
    q: Annotated[str | None, Query(max_length=100, description="Name or phone digits")] = None,
) -> Page[UserOut]:
    docs, next_cursor = await user_service.list_users(db, params, role, status, q)
    return make_page([to_out(d) for d in docs], next_cursor, params.limit)


@router.post(
    "",
    response_model=UserCreated,
    status_code=status.HTTP_201_CREATED,
    responses=error_responses(401, 403, 409, 422),
    openapi_extra=IDEMPOTENCY_UNSUPPORTED,
    summary="Add an approved owner or an admin (returns a temporary PIN once)",
)
async def create_user(
    db: DbDep, settings: SettingsDep, caller: WriteUsers, body: UserCreate, response: Response
) -> UserCreated:
    doc, pin = await user_service.create_user(db, settings, caller, body)
    response.headers["Location"] = f"/api/v1/users/{doc['_id']}"
    response.headers["ETag"] = etag(doc["version"])
    response.headers["Cache-Control"] = "no-store"
    return UserCreated(user=to_out(doc), temporary_pin=pin)


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
    summary="Rename a user, or disable / re-enable them",
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
    "/{user_id}/reviews",
    response_model=UserOut,
    responses=error_responses(401, 403, 404, 409, 422),
    openapi_extra=IDEMPOTENCY_OPTIONAL,
    summary="Approve or reject a pending owner",
    description="A decision is final: reviewing an owner who is no longer pending is a 409.",
)
async def review_owner(
    user_id: UUID, db: DbDep, caller: WriteUsers, body: ReviewCreate, response: Response
) -> UserOut:
    doc = await user_service.review_owner(db, caller, user_id, body)
    response.headers["ETag"] = etag(doc["version"])
    return to_out(doc)


@router.post(
    "/{user_id}/pin-resets",
    response_model=PinResetOut,
    responses=error_responses(401, 403, 404, 409),
    openapi_extra=IDEMPOTENCY_UNSUPPORTED,
    summary="Give a user a temporary PIN (shown once; they must change it at sign-in)",
)
async def reset_pin(
    user_id: UUID, db: DbDep, caller: WriteUsers, response: Response
) -> PinResetOut:
    await user_service.get_user(db, user_id)
    response.headers["Cache-Control"] = "no-store"
    return PinResetOut(temporary_pin=await user_service.reset_pin(db, caller.actor, user_id))
