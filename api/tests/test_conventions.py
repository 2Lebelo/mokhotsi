"""Cross-cutting API conventions: idempotency, rate limiting, request ids."""

import asyncio
import os
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from redis import Redis as SyncRedis
from redis.asyncio import Redis
from redis.exceptions import RedisError

from app.core.ratelimit import MemoryRateLimiter, RedisRateLimiter
from tests.helpers import (
    CASHIER_PIN,
    V1,
    admin_headers,
    create_owner,
    device_headers,
    error_code,
)


@pytest.mark.requires_mongo
def test_idempotency_key_replays_the_first_response(client, mongo) -> None:
    owner = create_owner(client, admin_headers(client, mongo))
    headers = {**owner.headers, "Idempotency-Key": "open-shop-1"}
    body = {"name": "Second", "pin": owner.pin}

    first = client.post(f"{V1}/shops", json=body, headers=headers)
    second = client.post(f"{V1}/shops", json=body, headers=headers)
    assert first.status_code == second.status_code == 201
    assert second.json() == first.json()
    assert second.headers["location"] == first.headers["location"]
    assert second.headers["idempotent-replayed"] == "true"
    assert mongo["shops"].count_documents({"name": "Second"}) == 1

    reused = client.post(f"{V1}/shops", json={**body, "name": "Third"}, headers=headers)
    assert reused.status_code == 422
    assert error_code(reused) == "idempotency_key_reused"


@pytest.mark.requires_mongo
def test_failed_requests_release_the_idempotency_key(client, mongo) -> None:
    owner = create_owner(client, admin_headers(client, mongo))
    url = f"{V1}/shops/{owner.shop_id}/members"
    client.post(url, json={"name": "A", "pin": CASHIER_PIN}, headers=owner.headers)
    headers = {**owner.headers, "Idempotency-Key": "retry-me"}
    taken = {"name": "B", "pin": CASHIER_PIN}
    assert client.post(url, json=taken, headers=headers).status_code == 409
    # Failures are not stored: a retry runs again (409 again, not a replay)...
    assert client.post(url, json=taken, headers=headers).status_code == 409
    # ...and the same key with a corrected body is a fresh request, not "reused".
    corrected = client.post(url, json={"name": "B", "pin": "61937"}, headers=headers)
    assert corrected.status_code == 201
    assert "idempotent-replayed" not in corrected.headers


@pytest.mark.requires_mongo
def test_an_abandoned_idempotency_claim_is_taken_over(client, mongo) -> None:
    owner = create_owner(client, admin_headers(client, mongo))
    headers = {**owner.headers, "Idempotency-Key": "crashed-mid-request"}
    body = {"name": "Second", "pin": owner.pin}
    # A first attempt claimed the key, then the process died before finishing or releasing.
    first = client.post(f"{V1}/shops", json=body, headers=headers)
    mongo["idempotency_keys"].update_one(
        {}, {"$set": {"state": "in_progress"}, "$unset": {"status": "", "body": ""}}
    )
    mongo["shops"].delete_one({"name": "Second"})
    assert first.status_code == 201

    blocked = client.post(f"{V1}/shops", json=body, headers=headers)
    assert error_code(blocked) == "idempotency_in_progress"  # The lease is still running.

    mongo["idempotency_keys"].update_one(
        {}, {"$set": {"lease_until": datetime.now(UTC) - timedelta(seconds=1)}}
    )
    retried = client.post(f"{V1}/shops", json=body, headers=headers)
    assert retried.status_code == 201
    assert mongo["shops"].count_documents({"name": "Second"}) == 1


@pytest.mark.requires_mongo
def test_a_forged_forwarded_for_header_does_not_dodge_the_ip_limit(make_client) -> None:
    client = make_client(rate_limit_anon_per_minute=2)
    codes = [
        client.get(f"{V1}/users/me", headers={"X-Forwarded-For": f"203.0.113.{i}"}).status_code
        for i in range(3)
    ]
    assert codes == [401, 401, 429]


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
def test_phones_are_rate_limited_on_their_own_not_by_shared_ip(make_client, mongo) -> None:
    client = make_client(rate_limit_user_per_minute=100, rate_limit_anon_per_minute=1000)
    owner = create_owner(client, admin_headers(client, mongo))
    phone = device_headers(client, owner.device)
    client.app.state.settings.rate_limit_user_per_minute = 2
    codes = [client.get(f"{V1}/devices/me/roster", headers=phone).status_code for _ in range(3)]
    assert codes == [200, 200, 429]
    # The owner shares the phone's IP but has their own allowance.
    assert client.get(f"{V1}/users/me", headers=owner.headers).status_code == 200


@pytest.mark.requires_mongo
def test_request_id_is_echoed_and_audited(client, mongo) -> None:
    owner = create_owner(client, admin_headers(client, mongo))
    response = client.post(
        f"{V1}/shops",
        json={"name": "Traced", "pin": owner.pin},
        headers={**owner.headers, "x-request-id": "trace-123"},
    )
    assert response.headers["x-request-id"] == "trace-123"
    entry = mongo["audit_logs"].find_one({"action": "shop.created", "request_id": "trace-123"})
    assert entry is not None


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
