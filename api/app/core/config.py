"""Settings loaded from the environment (and an optional `.env` file) via pydantic-settings."""

from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Mokhotsi API"
    environment: Literal["dev", "test", "prod"] = "dev"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"

    mongo_uri: str = "mongodb://localhost:27017"
    mongo_db: str = "mokhotsi"

    jwt_secret: SecretStr = Field(min_length=32)
    jwt_algorithm: Literal["HS256"] = "HS256"
    access_token_ttl_minutes: int = Field(default=15, gt=0)
    refresh_token_ttl_days: int = Field(default=30, gt=0)

    # Empty = no CORS middleware at all (the phone app is not a browser).
    cors_origins: list[str] = []


@lru_cache
def get_settings() -> Settings:
    # JWT_SECRET has no default on purpose: the app refuses to start without it.
    return Settings()  # type: ignore[call-arg]
