"""Per-request facts shared by logging, rate limiting, idempotency and the audit log."""

from fastapi import Request

from app.core.config import Settings
from app.core.errors import Unauthorized
from app.core.security import AccessClaims, decode_access_token


def request_id(request: Request) -> str | None:
    return getattr(request.state, "request_id", None)


def client_ip(request: Request, settings: Settings) -> str:
    if settings.trust_proxy_headers:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def user_agent(request: Request) -> str | None:
    ua = request.headers.get("user-agent")
    return ua[:256] if ua else None


def peek_claims(request: Request, settings: Settings) -> AccessClaims | None:
    """Signature-verified claims from the bearer token, or None. Cached on the request.

    Cheap (no database): used to key rate limits and idempotency records. Endpoints still
    authenticate fully through `get_current_user`.
    """
    if hasattr(request.state, "peeked_claims"):
        return request.state.peeked_claims
    claims: AccessClaims | None = None
    header = request.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() == "bearer" and token:
        try:
            claims = decode_access_token(settings, token)
        except Unauthorized:
            claims = None
    request.state.peeked_claims = claims
    return claims
