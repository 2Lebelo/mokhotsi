"""`Idempotency-Key` support for POST endpoints, as a route class.

Routers opt in with `APIRouter(route_class=IdempotentRoute)`. For every POST on such a router:
- No key: the request runs normally, unless the route requires one (`IDEMPOTENCY_REQUIRED`
  in `openapi_extra`), which is a 400 `idempotency_key_required`.
- New key: the request runs; a 2xx response is stored for `idempotency_ttl_hours`.
- Same key + same body: the stored response is replayed with `Idempotent-Replayed: true`.
- Same key + different body: 422 `idempotency_key_reused`.
- Same key while the first request is still running: 409 `idempotency_in_progress`.
Failed requests (non-2xx or exceptions) release the key so the client can retry.
Keys are scoped per caller (token subject, or client IP when anonymous) and per method + path.
"""

import hashlib
from collections.abc import Callable, Coroutine
from datetime import timedelta
from typing import Any

from fastapi import Request, Response
from fastapi.routing import APIRoute

from app.core.config import Settings
from app.core.errors import AppError, Conflict, Unprocessable
from app.core.request_meta import client_ip, peek_claims
from app.repositories import idempotency_keys

HEADER = "Idempotency-Key"
_EXTENSION = "x-idempotency-key"
_REPLAYED_HEADERS = ("location", "etag", "content-type")

_HEADER_PARAM = {
    "name": HEADER,
    "in": "header",
    "schema": {"type": "string", "minLength": 1, "maxLength": 255},
}

IDEMPOTENCY_REQUIRED: dict[str, Any] = {
    _EXTENSION: "required",
    "parameters": [
        {
            **_HEADER_PARAM,
            "required": True,
            "description": "Unique per logical operation (e.g. a UUID). Retries reuse it.",
        }
    ],
}
IDEMPOTENCY_OPTIONAL: dict[str, Any] = {
    _EXTENSION: "optional",
    "parameters": [
        {
            **_HEADER_PARAM,
            "required": False,
            "description": "Send one to make retries safe (e.g. a UUID).",
        }
    ],
}


class IdempotentRoute(APIRoute):
    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        handler = super().get_route_handler()
        if "POST" not in self.methods:
            return handler
        required = (self.openapi_extra or {}).get(_EXTENSION) == "required"

        async def route_handler(request: Request) -> Response:
            key = request.headers.get(HEADER)
            if key is None:
                if required:
                    raise AppError(
                        f"The {HEADER} header is required for this request",
                        code="idempotency_key_required",
                    )
                return await handler(request)
            if not 1 <= len(key) <= 255:
                raise AppError(f"{HEADER} must be 1-255 characters", code="invalid_idempotency_key")

            settings: Settings = request.app.state.settings
            db = request.app.state.db
            claims = peek_claims(request, settings)
            caller = f"user:{claims.sub}" if claims else f"ip:{client_ip(request, settings)}"
            scope = f"{caller}:{request.method}:{request.url.path}"
            request_hash = hashlib.sha256(await request.body()).hexdigest()
            ttl = timedelta(hours=settings.idempotency_ttl_hours)

            stored = await idempotency_keys.claim(db, scope, key, request_hash, ttl)
            if stored is not None:
                if stored.request_hash != request_hash:
                    raise Unprocessable(
                        f"This {HEADER} was already used with a different request body",
                        code="idempotency_key_reused",
                    )
                if stored.state == "in_progress" or stored.status is None:
                    raise Conflict(
                        "A request with this key is still being processed",
                        code="idempotency_in_progress",
                        headers={"Retry-After": "1"},
                    )
                headers = dict(stored.headers or {})
                headers["Idempotent-Replayed"] = "true"
                return Response(content=stored.body, status_code=stored.status, headers=headers)

            try:
                response = await handler(request)
            except BaseException:
                await idempotency_keys.release(db, scope, key)
                raise
            if 200 <= response.status_code < 300:
                kept = {h: response.headers[h] for h in _REPLAYED_HEADERS if h in response.headers}
                await idempotency_keys.complete(
                    db, scope, key, response.status_code, bytes(response.body), kept
                )
            else:
                await idempotency_keys.release(db, scope, key)
            return response

        return route_handler
