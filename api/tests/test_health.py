import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.repositories.indexes import ALL_INDEXES


@pytest.mark.requires_mongo
def test_health_reports_mongo_ok(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "mongo": "ok"}


@pytest.mark.requires_mongo
def test_lifespan_created_indexes(client: TestClient, settings: Settings) -> None:
    from pymongo import MongoClient

    with MongoClient(settings.mongo_uri) as mongo:
        db = mongo[settings.mongo_db]
        for collection, indexes in ALL_INDEXES.items():
            existing = set(db[collection].index_information())
            for index in indexes:
                assert index.document["name"] in existing, (collection, index.document["name"])
        ttl = db["applied_ops"].index_information()["applied_at_ttl"]
        assert ttl["expireAfterSeconds"] == 30 * 24 * 60 * 60


@pytest.mark.requires_mongo
@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("post", "/auth/refresh", {"refresh_token": "x"}),
        ("get", "/sync/pull", None),
    ],
)
def test_stubs_return_501_in_the_error_shape(
    client: TestClient, method: str, path: str, body: dict[str, str] | None
) -> None:
    response = client.request(method, path, json=body)
    assert response.status_code == 501
    error = response.json()["error"]
    assert error["code"] == "not_implemented"
    assert error["message"].startswith("TODO(feature):")


@pytest.mark.requires_mongo
def test_validation_errors_use_the_error_shape(client: TestClient) -> None:
    response = client.post("/auth/login", json={"owner_phone": "x"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_openapi_documents_every_endpoint(settings: Settings) -> None:
    paths = create_app(settings).openapi()["paths"]
    assert set(paths) == {
        "/health",
        "/auth/register",
        "/auth/login",
        "/auth/refresh",
        "/sync/push",
        "/sync/pull",
    }
    assert "501" in paths["/sync/push"]["post"]["responses"]


def test_cors_is_off_by_default(settings: Settings) -> None:
    client = TestClient(create_app(settings))
    response = client.options(
        "/health",
        headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"},
    )
    assert "access-control-allow-origin" not in response.headers
