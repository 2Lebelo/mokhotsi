"""Test fixtures. Tests use a throwaway database (`mokhotsi_test` by default), dropped at the end.

Tests marked `requires_mongo` are skipped when MongoDB is unreachable locally, but FAIL in CI
(`CI=true`), where the workflow provides a Mongo service container.
"""

import os
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from pymongo import MongoClient
from pymongo.errors import PyMongoError

os.environ.setdefault("JWT_SECRET", "test-only-secret-not-used-in-production-000000")

from app.core.config import Settings  # imported after JWT_SECRET is set
from app.main import create_app

TEST_DB = os.environ.get("MONGO_DB_TEST", "mokhotsi_test")


@pytest.fixture(scope="session")
def settings() -> Settings:
    return Settings(mongo_db=TEST_DB, environment="test")  # type: ignore[call-arg]


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
def client(settings: Settings) -> Iterator[TestClient]:
    # Entering the context runs the lifespan: one AsyncMongoClient + index creation.
    with TestClient(create_app(settings)) as test_client:
        yield test_client


@pytest.fixture(scope="session", autouse=True)
def _drop_test_database(settings: Settings, mongo_available: bool) -> Iterator[None]:
    yield
    if mongo_available:
        with MongoClient(settings.mongo_uri, serverSelectionTimeoutMS=1_500) as client:
            client.drop_database(settings.mongo_db)


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line("markers", "requires_mongo: needs a reachable MongoDB")
