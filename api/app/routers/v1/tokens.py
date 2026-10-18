from fastapi import APIRouter, Request, Response

from app.core.deps import DbDep, SettingsDep
from app.core.errors import error_responses
from app.schemas.auth import PasswordGrant, TokenRequest, TokenResponse
from app.services import auth_service

router = APIRouter(prefix="/tokens", tags=["auth"])


@router.post(
    "",
    response_model=TokenResponse,
    responses=error_responses(401, 422, 423, 429),
    summary="Sign in (grant_type=password) or rotate a refresh token (grant_type=refresh_token)",
    description=(
        "OAuth2-style token endpoint (RFC 6749 §5.1: success is 200, responses are not cached). "
        "A password grant creates a session; a refresh grant rotates its refresh token. "
        "Reusing a spent refresh token revokes the session."
    ),
)
async def create_token(
    request: Request,
    response: Response,
    db: DbDep,
    settings: SettingsDep,
    body: TokenRequest,
) -> TokenResponse:
    response.headers["Cache-Control"] = "no-store"
    if isinstance(body, PasswordGrant):
        return await auth_service.login(request, db, settings, body)
    return await auth_service.refresh(request, db, settings, body)
