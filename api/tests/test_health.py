import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.repositories.indexes import ALL_INDEXES


@pytest.mark.requires_mongo
def test_health_reports_mongo_ok(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "mongo": "ok", "redis": "disabled"}


@pytest.mark.requires_mongo
def test_lifespan_created_indexes(client: TestClient, mongo) -> None:
    for collection, indexes in ALL_INDEXES.items():
        existing = set(mongo[collection].index_information())
        for index in indexes:
            assert index.document["name"] in existing, (collection, index.document["name"])
    ttl = mongo["applied_ops"].index_information()["applied_at_ttl_180d"]
    assert ttl["expireAfterSeconds"] == 180 * 24 * 60 * 60
    assert "shop_seq" not in mongo["products"].index_information()  # Sync v1, dropped.
    assert mongo["sessions"].index_information()["expires_at_ttl"]["expireAfterSeconds"] == 0


@pytest.mark.requires_mongo
def test_legacy_shop_phone_index_is_dropped(make_client, mongo, settings: Settings) -> None:
    mongo["shops"].create_index("owner_phone", name="owner_phone_unique", unique=True)
    with TestClient(create_app(settings)):
        assert "owner_phone_unique" not in mongo["shops"].index_information()


@pytest.mark.requires_mongo
def test_validation_errors_use_the_error_shape(client: TestClient) -> None:
    response = client.post("/api/v1/tokens", json={"grant_type": "pin", "phone": "x"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_openapi_documents_every_endpoint(settings: Settings) -> None:
    paths = create_app(settings).openapi()["paths"]
    assert set(paths) == {
        "/health",
        "/api/v1/registrations",
        "/api/v1/tokens",
        "/api/v1/sessions",
        "/api/v1/sessions/current",
        "/api/v1/sessions/{session_id}",
        "/api/v1/users",
        "/api/v1/users/me",
        "/api/v1/users/me/pin",
        "/api/v1/users/{user_id}",
        "/api/v1/users/{user_id}/reviews",
        "/api/v1/users/{user_id}/pin-resets",
        "/api/v1/roles",
        "/api/v1/permissions",
        "/api/v1/shops",
        "/api/v1/shops/{shop_id}",
        "/api/v1/shops/{shop_id}/members",
        "/api/v1/shops/{shop_id}/members/{user_id}",
        "/api/v1/shops/{shop_id}/members/{user_id}/pin",
        "/api/v1/devices",
        "/api/v1/devices/me/roster",
        "/api/v1/devices/{device_id}",
        "/api/v1/shops/{shop_id}/devices",
        "/api/v1/shops/{shop_id}/devices/{device_id}",
        "/api/v1/shops/{shop_id}/data-claim",
        "/api/v1/audit-logs",
        "/api/v1/shops/{shop_id}/audit-logs",
        "/api/v1/shops/{shop_id}/sync/push",
        "/api/v1/shops/{shop_id}/sync/pull",
        "/api/v1/shops/{shop_id}/sync/snapshot",
        "/api/v1/shops/{shop_id}/sync/photos/uploads",
        "/api/v1/shops/{shop_id}/sync/photos/confirm",
        "/api/v1/shops/{shop_id}/sync/photos/urls",
        "/api/v1/shops/{shop_id}/sync/issues",
        "/api/v1/sync-issues",
        "/api/v1/sync-issues/count",
        "/api/v1/sync-issues/{issue_id}/resolve",
    }
    create_shop = paths["/api/v1/shops"]["post"]
    assert create_shop["x-idempotency-key"] == "optional"
    assert any(p["name"] == "Idempotency-Key" for p in create_shop["parameters"])
    assert "409" in create_shop["responses"]
    # Responses holding a secret are never stored for replay.
    for path in ("/api/v1/users", "/api/v1/users/{user_id}/pin-resets"):
        assert paths[path]["post"]["x-idempotency-key"] == "unsupported"


def test_cors_is_off_by_default(settings: Settings) -> None:
    client = TestClient(create_app(settings))
    response = client.options(
        "/health",
        headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"},
    )
    assert "access-control-allow-origin" not in response.headers
