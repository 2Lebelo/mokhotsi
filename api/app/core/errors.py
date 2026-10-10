"""One error shape for every failure: {"error": {"code", "message", "details"}}.

`code` is a stable, machine-readable string clients may branch on (see docs/api-conventions.md).
Subclasses set the HTTP status and a default code; raise sites may pass a more specific code.
"""

import logging
from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("app.errors")


class ErrorBody(BaseModel):
    code: str
    message: str
    details: Any | None = None


class ErrorResponse(BaseModel):
    error: ErrorBody


class AppError(Exception):
    status_code: int = status.HTTP_400_BAD_REQUEST
    code: str = "bad_request"

    def __init__(
        self,
        message: str,
        details: Any | None = None,
        *,
        code: str | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.details = details
        if code is not None:
            self.code = code
        self.headers = headers


class NotImplementedFeature(AppError):
    """Raised by every scaffolding stub. Search for `TODO(feature)` to find them."""

    status_code = status.HTTP_501_NOT_IMPLEMENTED
    code = "not_implemented"

    def __init__(self, what: str) -> None:
        super().__init__(f"TODO(feature): {what} is not implemented yet")


class Unauthorized(AppError):
    status_code = status.HTTP_401_UNAUTHORIZED
    code = "unauthorized"

    def __init__(self, message: str = "Authentication required", **kwargs: Any) -> None:
        kwargs.setdefault("headers", {"WWW-Authenticate": "Bearer"})
        super().__init__(message, **kwargs)


class Forbidden(AppError):
    status_code = status.HTTP_403_FORBIDDEN
    code = "forbidden"


class NotFound(AppError):
    status_code = status.HTTP_404_NOT_FOUND
    code = "not_found"


class Conflict(AppError):
    status_code = status.HTTP_409_CONFLICT
    code = "conflict"


class PreconditionFailed(AppError):
    status_code = status.HTTP_412_PRECONDITION_FAILED
    code = "precondition_failed"


class Locked(AppError):
    status_code = status.HTTP_423_LOCKED
    code = "account_locked"


class Unprocessable(AppError):
    """Semantically invalid request that passed schema validation (e.g. idempotency key reuse)."""

    status_code = status.HTTP_422_UNPROCESSABLE_CONTENT
    code = "unprocessable"


class TooManyRequests(AppError):
    status_code = status.HTTP_429_TOO_MANY_REQUESTS
    code = "rate_limited"


def _response(
    status_code: int,
    code: str,
    message: str,
    details: Any | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    body = ErrorResponse(error=ErrorBody(code=code, message=message, details=details))
    return JSONResponse(status_code=status_code, content=jsonable_encoder(body), headers=headers)


async def _app_error(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, AppError)  # noqa: S101 — registered for AppError only
    return _response(exc.status_code, exc.code, exc.message, exc.details, exc.headers)


def _safe_errors(exc: RequestValidationError) -> list[dict[str, Any]]:
    """Pydantic errors minus `input` (it may hold a password) with `ctx` made JSON-safe."""
    errors = []
    for error in exc.errors():
        item = {k: error[k] for k in ("type", "loc", "msg") if k in error}
        if error.get("ctx"):
            item["ctx"] = {k: str(v) for k, v in error["ctx"].items()}
        errors.append(item)
    return errors


async def _validation_error(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, RequestValidationError)  # noqa: S101
    return _response(422, "validation_error", "Request validation failed", _safe_errors(exc))


async def _http_error(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, StarletteHTTPException)  # noqa: S101
    return _response(exc.status_code, f"http_{exc.status_code}", str(exc.detail))


async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
    log.exception("unhandled error", extra={"path": request.url.path})
    return _response(500, "internal_error", "Internal server error")


def install_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(AppError, _app_error)
    app.add_exception_handler(RequestValidationError, _validation_error)
    app.add_exception_handler(StarletteHTTPException, _http_error)
    app.add_exception_handler(Exception, _unhandled)


_DESCRIPTIONS: dict[int, str] = {
    400: "Malformed request (e.g. bad cursor or sort field)",
    401: "Missing or invalid access token",
    403: "Authenticated but not allowed",
    404: "Not found (also returned for other tenants' resources)",
    409: "Conflicts with current state (e.g. duplicate email)",
    412: "If-Match does not match the current version",
    422: "Validation failed",
    423: "Account temporarily locked after repeated failed logins",
    429: "Rate limited; retry after `Retry-After` seconds",
    501: "Stub: TODO(feature)",
}


def error_responses(*codes: int) -> dict[int | str, dict[str, Any]]:
    """OpenAPI `responses=` entries in the shared error shape: responses=error_responses(401, 404)."""
    return {c: {"model": ErrorResponse, "description": _DESCRIPTIONS[c]} for c in codes}


# Kept for the Phase-2 sync stubs.
NOT_IMPLEMENTED = error_responses(501)
UNAUTHORIZED = error_responses(401)
