"""Sliding-window rate limiting: Redis in prod (shared across workers), memory in dev/test.

Applied to every /api/v1 request (per user when a valid token is present, else per IP) and,
more strictly, to password logins (per IP + email). Fails OPEN if Redis is unreachable: an
outage of the limiter must not take the API down with it.
"""

import logging
import time
import uuid
from collections import deque
from dataclasses import dataclass
from typing import Protocol

from fastapi import Request, Response
from redis.asyncio import Redis
from redis.exceptions import RedisError

from app.core.config import Settings
from app.core.errors import TooManyRequests
from app.core.request_meta import client_ip, peek_claims

log = logging.getLogger("app.ratelimit")

WINDOW_MS = 60_000


@dataclass(frozen=True, slots=True)
class RateLimitResult:
    allowed: bool
    limit: int
    remaining: int
    reset_ms: int  # until a slot frees up


class RateLimiter(Protocol):
    async def hit(self, key: str, limit: int, window_ms: int = WINDOW_MS) -> RateLimitResult: ...


# Sliding-window log in a sorted set: drop entries older than the window, count, maybe add.
_LUA = """
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)
if count < limit then
  redis.call('ZADD', key, now, ARGV[4])
  redis.call('PEXPIRE', key, window)
  return {1, limit - count - 1, window}
end
local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
return {0, 0, tonumber(oldest[2]) + window - now}
"""


class RedisRateLimiter:
    def __init__(self, redis: Redis) -> None:
        self._script = redis.register_script(_LUA)

    async def hit(self, key: str, limit: int, window_ms: int = WINDOW_MS) -> RateLimitResult:
        now = int(time.time() * 1000)
        try:
            allowed, remaining, reset = await self._script(
                keys=[key], args=[now, window_ms, limit, f"{now}-{uuid.uuid4().hex}"]
            )
        except RedisError:
            log.warning("rate limiter unavailable; failing open", exc_info=True)
            return RateLimitResult(True, limit, limit, window_ms)
        return RateLimitResult(bool(allowed), limit, int(remaining), int(reset))


class MemoryRateLimiter:
    """Same algorithm in process memory. Only correct for a single process."""

    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = {}

    async def hit(self, key: str, limit: int, window_ms: int = WINDOW_MS) -> RateLimitResult:
        now = time.monotonic() * 1000
        hits = self._hits.setdefault(key, deque())
        while hits and hits[0] <= now - window_ms:
            hits.popleft()
        if len(hits) < limit:
            hits.append(now)
            return RateLimitResult(True, limit, limit - len(hits), window_ms)
        return RateLimitResult(False, limit, 0, int(hits[0] + window_ms - now))


def _apply(response: Response, result: RateLimitResult) -> None:
    response.headers["RateLimit-Limit"] = str(result.limit)
    response.headers["RateLimit-Remaining"] = str(result.remaining)
    response.headers["RateLimit-Reset"] = str(max(1, -(-result.reset_ms // 1000)))


def _raise(result: RateLimitResult, message: str) -> None:
    retry_after = str(max(1, -(-result.reset_ms // 1000)))
    raise TooManyRequests(
        message,
        headers={
            "Retry-After": retry_after,
            "RateLimit-Limit": str(result.limit),
            "RateLimit-Remaining": "0",
            "RateLimit-Reset": retry_after,
        },
    )


async def rate_limit(request: Request, response: Response) -> None:
    """Router-level dependency for every /api/v1 route."""
    settings: Settings = request.app.state.settings
    if not settings.rate_limit_enabled:
        return
    limiter: RateLimiter = request.app.state.limiter
    claims = peek_claims(request, settings)
    if claims is not None:
        key, limit = f"rl:user:{claims.sub}", settings.rate_limit_user_per_minute
    else:
        key, limit = f"rl:ip:{client_ip(request, settings)}", settings.rate_limit_anon_per_minute
    result = await limiter.hit(key, limit)
    if not result.allowed:
        _raise(result, "Too many requests")
    _apply(response, result)


async def limit_login(request: Request, email: str) -> None:
    """Stricter limit for password attempts, keyed by IP + email (slows credential stuffing)."""
    settings: Settings = request.app.state.settings
    if not settings.rate_limit_enabled:
        return
    limiter: RateLimiter = request.app.state.limiter
    key = f"rl:login:{client_ip(request, settings)}:{email.lower()}"
    result = await limiter.hit(key, settings.rate_limit_login_per_minute)
    if not result.allowed:
        _raise(result, "Too many login attempts")
