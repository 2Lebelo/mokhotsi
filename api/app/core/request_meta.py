"""Per-request facts shared by logging, rate limiting, idempotency and the audit log."""

from fastapi import Request

from app.core.config import Settings
from app.core.errors import Unauthorized
from app.core.security import AccessClaims, decode_access_token, decode_device_token


def request_id(request: Request) -> str | None:
    return getattr(request.state, "request_id", None)


def client_ip(request: Request) -> str:
    """The peer address as resolved by uvicorn.

    Behind a proxy, uvicorn's `--proxy-headers` with `FORWARDED_ALLOW_IPS` replaces it with the
    client address, taking the rightmost X-Forwarded-For hop the trusted proxy added. Reading the
    header here would trust its leftmost entry, which the client writes.
    """
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


def peek_subject(request: Request, settings: Settings) -> str | None:
    """`user:<id>` or `device:<id>` from a signature-verified bearer token, else None.

    Keys rate limits and idempotency records. Many phones share one carrier IP, so a phone
    with a device token is limited on its own rather than with its neighbours.
    """
    claims = peek_claims(request, settings)
    if claims is not None:
        return f"user:{claims.sub}"
    _, _, token = request.headers.get("authorization", "").partition(" ")
    if token:
        try:
            return f"device:{decode_device_token(settings, token).sub}"
        except Unauthorized:
            return None
    return None
