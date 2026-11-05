from fastapi import APIRouter, Request, Response, status

from app.core.deps import DbDep, SettingsDep
from app.core.errors import error_responses
from app.schemas.auth import RegistrationCreate, TokenResponse
from app.services import auth_service

# No Idempotency-Key: the response holds the phone's secret, which must never be stored for
# replay. A client that lost the response signs in with its phone number and PIN instead.
router = APIRouter(prefix="/registrations", tags=["auth"])


@router.post(
    "",
    response_model=TokenResponse,
    status_code=status.HTTP_201_CREATED,
    responses=error_responses(409, 422, 429),
    summary="Register as a shop owner (signed in at once; waits for the admin's approval)",
    description=(
        "Creates a pending owner, registers this phone and signs the owner in. Until a system "
        "admin approves the registration the owner has no permissions, and GET /users/me shows "
        "`status: pending`. A phone number can be registered once (`phone_taken`)."
    ),
)
async def register(
    request: Request, response: Response, db: DbDep, settings: SettingsDep, body: RegistrationCreate
) -> TokenResponse:
    response.headers["Cache-Control"] = "no-store"
    return await auth_service.register(request, db, settings, body)
