"""One error shape for every failure: {"error": {"code", "message", "details"}}."""

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

    def __init__(self, message: str, details: Any | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details


class NotImplementedFeature(AppError):
    """Raised by every scaffolding stub. Search for `TODO(feature)` to find them."""

    status_code = status.HTTP_501_NOT_IMPLEMENTED
    code = "not_implemented"

    def __init__(self, what: str) -> None:
        super().__init__(f"TODO(feature): {what} is not implemented yet")


class Unauthorized(AppError):
    status_code = status.HTTP_401_UNAUTHORIZED
    code = "unauthorized"


def _response(
    status_code: int, code: str, message: str, details: Any | None = None
) -> JSONResponse:
    body = ErrorResponse(error=ErrorBody(code=code, message=message, details=details))
    return JSONResponse(status_code=status_code, content=jsonable_encoder(body))


async def _app_error(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, AppError)  # noqa: S101 — registered for AppError only
    return _response(exc.status_code, exc.code, exc.message, exc.details)


async def _validation_error(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, RequestValidationError)  # noqa: S101
    return _response(422, "validation_error", "Request validation failed", exc.errors())


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


# Reusable OpenAPI entries for routers: responses={**NOT_IMPLEMENTED}.
NOT_IMPLEMENTED: dict[int | str, dict[str, Any]] = {
    501: {"model": ErrorResponse, "description": "Stub: TODO(feature)"}
}
UNAUTHORIZED: dict[int | str, dict[str, Any]] = {
    401: {"model": ErrorResponse, "description": "Missing or invalid access token"}
}
