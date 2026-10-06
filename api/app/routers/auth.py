from fastapi import APIRouter, status

from app.core.deps import DbDep, SettingsDep
from app.core.errors import NOT_IMPLEMENTED, UNAUTHORIZED
from app.schemas.auth import LoginRequest, RefreshRequest, RegisterRequest, TokenResponse
from app.services import auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post(
    "/register",
    response_model=TokenResponse,
    status_code=status.HTTP_201_CREATED,
    responses={**NOT_IMPLEMENTED},
    summary="Create a shop and its owner account; returns tokens for this device",
)
async def register(body: RegisterRequest, db: DbDep, settings: SettingsDep) -> TokenResponse:
    return await auth_service.register(db, settings, body)


@router.post(
    "/login",
    response_model=TokenResponse,
    responses={**UNAUTHORIZED, **NOT_IMPLEMENTED},
    summary="Exchange owner phone + password for access and refresh tokens",
)
async def login(body: LoginRequest, db: DbDep, settings: SettingsDep) -> TokenResponse:
    return await auth_service.login(db, settings, body)


@router.post(
    "/refresh",
    response_model=TokenResponse,
    responses={**UNAUTHORIZED, **NOT_IMPLEMENTED},
    summary="Rotate a refresh token into a new token pair",
)
async def refresh(body: RefreshRequest, db: DbDep, settings: SettingsDep) -> TokenResponse:
    return await auth_service.refresh(db, settings, body)
