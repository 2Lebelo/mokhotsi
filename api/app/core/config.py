"""Settings loaded from the environment (and an optional `.env` file) via pydantic-settings."""

from functools import lru_cache
from typing import Literal, Self

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Mokhotsi API"
    environment: Literal["dev", "test", "prod"] = "dev"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"

    # MongoDB must run as a replica set (single node is fine): writes + audit entries use transactions.
    mongo_uri: str = "mongodb://localhost:27017"
    mongo_db: str = "mokhotsi"

    jwt_secret: SecretStr = Field(min_length=32)
    jwt_algorithm: Literal["HS256"] = "HS256"
    access_token_ttl_minutes: int = Field(default=15, gt=0)
    refresh_token_ttl_days: int = Field(default=30, gt=0)

    # Empty = rate limits are kept in process memory (fine for one dev/test process only).
    redis_url: str | None = None
    rate_limit_enabled: bool = True
    rate_limit_user_per_minute: int = Field(default=300, gt=0)
    rate_limit_anon_per_minute: int = Field(default=60, gt=0)
    rate_limit_login_per_minute: int = Field(default=5, gt=0)
    login_max_failures: int = Field(default=10, gt=0)
    login_lockout_minutes: int = Field(default=15, gt=0)

    idempotency_ttl_hours: int = Field(default=24, gt=0)

    # Only enable behind a proxy you control; otherwise clients can spoof X-Forwarded-For.
    trust_proxy_headers: bool = False

    # Empty = no CORS middleware at all (the phone app is not a browser).
    cors_origins: list[str] = []

    @model_validator(mode="after")
    def _prod_requires_redis(self) -> Self:
        if self.environment == "prod" and self.rate_limit_enabled and not self.redis_url:
            raise ValueError("REDIS_URL is required in prod: rate limits must be shared")
        return self


@lru_cache
def get_settings() -> Settings:
    # JWT_SECRET has no default on purpose: the app refuses to start without it.
    return Settings()  # type: ignore[call-arg]
