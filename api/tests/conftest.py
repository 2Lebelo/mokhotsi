"""Test fixtures. Tests use a throwaway database (`mokhotsi_test` by default), reset per client.

Tests marked `requires_mongo` are skipped when MongoDB is unreachable locally, but FAIL in CI
(`CI=true`), where the workflow provides MongoDB as a replica set (transactions need one).
Locally: `docker compose up -d mongo redis`, and set MONGO_URI if you changed MONGO_HOST_PORT.

`api/.env` is deliberately NOT read: tests only see real environment variables.
"""

import os
from collections.abc import Callable, Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pymongo import MongoClient
from pymongo.errors import PyMongoError

os.environ.setdefault("JWT_SECRET", "test-only-secret-not-used-in-production-000000")

from app.core.config import Settings  # imported after JWT_SECRET is set
from app.main import create_app

TEST_DB = os.environ.get("MONGO_DB_TEST", "mokhotsi_test")


def _settings(**overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "mongo_db": TEST_DB,
        "environment": "test",
        "redis_url": None,  # In-memory limiter: deterministic and isolated per app instance.
        **overrides,
    }
    return Settings(_env_file=None, **values)  # type: ignore[call-arg]


@pytest.fixture(scope="session")
def settings() -> Settings:
    return _settings()


def _mongo_reachable(uri: str) -> bool:
    try:
        with MongoClient(uri, serverSelectionTimeoutMS=1_500) as client:
            client.admin.command("ping")
    except PyMongoError:
        return False
    return True


@pytest.fixture(scope="session")
def mongo_available(settings: Settings) -> bool:
    return _mongo_reachable(settings.mongo_uri)


@pytest.fixture(autouse=True)
def _skip_without_mongo(request: pytest.FixtureRequest, mongo_available: bool) -> None:
    if request.node.get_closest_marker("requires_mongo") and not mongo_available:
        if os.environ.get("CI"):
            pytest.fail("MongoDB is required in CI but is unreachable")
        pytest.skip("MongoDB not reachable (start it with `docker compose up -d mongo`)")


@pytest.fixture
def mongo(settings: Settings) -> Iterator[Any]:
    """A sync handle on the test database, for arranging and asserting state directly."""
    with MongoClient(settings.mongo_uri, uuidRepresentation="standard", tz_aware=True) as client:
        yield client[settings.mongo_db]


@pytest.fixture
def make_client(settings: Settings) -> Iterator[Callable[..., TestClient]]:
    """Build a client on a fresh database; keyword arguments override settings."""
    opened: list[TestClient] = []

    def factory(**overrides: Any) -> TestClient:
        app_settings = _settings(**overrides) if overrides else settings
        with MongoClient(app_settings.mongo_uri) as mongo_client:
            mongo_client.drop_database(app_settings.mongo_db)
        test_client = TestClient(create_app(app_settings))
        test_client.__enter__()  # Runs the lifespan: Mongo client + index creation.
        opened.append(test_client)
        return test_client

    yield factory
    for test_client in opened:
        test_client.__exit__(None, None, None)


@pytest.fixture
def client(make_client: Callable[..., TestClient]) -> TestClient:
    return make_client()


@pytest.fixture(scope="session", autouse=True)
def _drop_test_database(settings: Settings, mongo_available: bool) -> Iterator[None]:
    yield
    if mongo_available:
        with MongoClient(settings.mongo_uri, serverSelectionTimeoutMS=1_500) as client:
            client.drop_database(settings.mongo_db)


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line("markers", "requires_mongo: needs a reachable MongoDB replica set")
