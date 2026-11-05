from fastapi import APIRouter, Request, Response

from app.core.deps import DbDep, SettingsDep
from app.core.errors import error_responses
from app.schemas.auth import (
    DeviceGrant,
    DevicePinGrant,
    DeviceTokenResponse,
    PinGrant,
    TokenRequest,
    TokenResponse,
)
from app.services import auth_service

router = APIRouter(prefix="/tokens", tags=["auth"])


@router.post(
    "",
    response_model=TokenResponse | DeviceTokenResponse,
    responses=error_responses(401, 422, 423, 429),
    summary="Sign in with a PIN, get a device token, or rotate a refresh token",
    description=(
        "OAuth2-style token endpoint (RFC 6749 §5.1: success is 200, responses are not cached).\n"
        "- `pin`: phone + PIN (owners, admins). Without a device credential the phone is "
        "registered and its secret returned once in `device`.\n"
        "- `device_pin`: a registered phone + shop + PIN (anyone in the shop).\n"
        "- `device`: a registered phone's credential, for a device token (sync, roster).\n"
        "- `refresh_token`: rotates the refresh token. Reusing a spent one revokes the session."
    ),
)
async def create_token(
    request: Request,
    response: Response,
    db: DbDep,
    settings: SettingsDep,
    body: TokenRequest,
) -> TokenResponse | DeviceTokenResponse:
    response.headers["Cache-Control"] = "no-store"
    if isinstance(body, PinGrant):
        return await auth_service.sign_in_with_pin(request, db, settings, body)
    if isinstance(body, DevicePinGrant):
        return await auth_service.sign_in_on_device(request, db, settings, body)
    if isinstance(body, DeviceGrant):
        return await auth_service.device_token(db, settings, body)
    return await auth_service.refresh(request, db, settings, body)
