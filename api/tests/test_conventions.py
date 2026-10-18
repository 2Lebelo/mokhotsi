"""Cross-cutting API conventions: idempotency, rate limiting, request ids."""

import asyncio
import os
from uuid import uuid4

import pytest
from redis import Redis as SyncRedis
from redis.asyncio import Redis
from redis.exceptions import RedisError

from app.core.ratelimit import MemoryRateLimiter, RedisRateLimiter
from tests.helpers import TEMP_PASSWORD, V1, admin_headers, error_code


def _user(email: str):
    return {"email": email, "name": "K", "role": "shop_keeper", "password": TEMP_PASSWORD}


@pytest.mark.requires_mongo
def test_idempotency_key_replays_the_first_response(client, mongo) -> None:
    admin = admin_headers(client, mongo)
    headers = {**admin, "Idempotency-Key": "create-k-1"}

    first = client.post(f"{V1}/users", json=_user("k@m.co.ls"), headers=headers)
    second = client.post(f"{V1}/users", json=_user("k@m.co.ls"), headers=headers)
    assert first.status_code == second.status_code == 201
    assert second.json() == first.json()
    assert second.headers["location"] == first.headers["location"]
    assert second.headers["idempotent-replayed"] == "true"
    assert mongo["users"].count_documents({"email": "k@m.co.ls"}) == 1

    reused = client.post(f"{V1}/users", json=_user("other@m.co.ls"), headers=headers)
    assert reused.status_code == 422
    assert error_code(reused) == "idempotency_key_reused"


@pytest.mark.requires_mongo
def test_failed_requests_release_the_idempotency_key(client, mongo) -> None:
    admin = admin_headers(client, mongo)
    client.post(f"{V1}/users", json=_user("k@m.co.ls"), headers=admin)
    headers = {**admin, "Idempotency-Key": "retry-me"}
    assert client.post(f"{V1}/users", json=_user("k@m.co.ls"), headers=headers).status_code == 409
    # Failures are not stored: a retry runs again (409 again, not a replay)...
    assert client.post(f"{V1}/users", json=_user("k@m.co.ls"), headers=headers).status_code == 409
    # ...and the same key with a corrected body is a fresh request, not "reused".
    corrected = client.post(f"{V1}/users", json=_user("k2@m.co.ls"), headers=headers)
    assert corrected.status_code == 201
    assert "idempotent-replayed" not in corrected.headers


@pytest.mark.requires_mongo
def test_authenticated_requests_are_rate_limited_per_user(make_client, mongo) -> None:
    client = make_client(rate_limit_user_per_minute=3)
    admin = admin_headers(client, mongo)
    responses = [client.get(f"{V1}/users/me", headers=admin) for _ in range(4)]
    assert [r.status_code for r in responses] == [200, 200, 200, 429]
    assert responses[0].headers["ratelimit-limit"] == "3"
    assert responses[0].headers["ratelimit-remaining"] == "2"
    assert "retry-after" in responses[3].headers


@pytest.mark.requires_mongo
def test_request_id_is_echoed_and_audited(client, mongo) -> None:
    admin = admin_headers(client, mongo)
    response = client.post(
        f"{V1}/users", json=_user("k@m.co.ls"), headers={**admin, "x-request-id": "trace-123"}
    )
    assert response.headers["x-request-id"] == "trace-123"
    assert mongo["audit_logs"].find_one({"action": "user.created"})["request_id"] == "trace-123"


def test_redis_limiter_slides() -> None:
    url = os.environ.get("REDIS_URL_TEST", "redis://127.0.0.1:6379/15")
    try:
        SyncRedis.from_url(url, socket_connect_timeout=1).ping()
    except RedisError:
        if os.environ.get("CI"):
            pytest.fail("Redis is required in CI but is unreachable")
        pytest.skip("Redis not reachable (start it with `docker compose up -d redis`)")

    async def run() -> list[bool]:
        redis = Redis.from_url(url)
        limiter = RedisRateLimiter(redis)
        key = f"test:{uuid4()}"
        try:
            return [(await limiter.hit(key, 2)).allowed for _ in range(3)]
        finally:
            await redis.aclose()

    assert asyncio.run(run()) == [True, True, False]


def test_memory_limiter_slides() -> None:
    limiter = MemoryRateLimiter()

    async def run() -> list[bool]:
        return [(await limiter.hit("k", 2, window_ms=50)).allowed for _ in range(3)]

    assert asyncio.run(run()) == [True, True, False]
