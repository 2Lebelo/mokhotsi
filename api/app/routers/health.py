from fastapi import APIRouter, Request, Response, status

from app.core.deps import DbDep
from app.schemas.health import HealthResponse
from app.services import health_service

router = APIRouter(tags=["health"])


@router.get(
    "/health",
    response_model=HealthResponse,
    responses={503: {"model": HealthResponse, "description": "MongoDB unreachable"}},
    summary="Liveness + MongoDB and Redis pings (unversioned, unauthenticated)",
)
async def health(db: DbDep, request: Request, response: Response) -> HealthResponse:
    result = await health_service.check(db, request.app.state.redis)
    if result.status != "ok":
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return result
