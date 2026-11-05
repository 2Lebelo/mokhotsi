"""Settings loaded from the environment (and an optional `api/.env` file) via pydantic-settings."""

from functools import lru_cache
from pathlib import Path
from typing import Literal, Self

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# `api/.env`, found from this file rather than the working directory, so the API and CLI read
# the same file wherever they are started from. Real environment variables still take priority.
ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ENV_FILE, env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Mokhotsi API"
    environment: Literal["dev", "test", "prod"] = "dev"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"

    # MongoDB must run as a replica set (single node is fine): writes + audit entries use transactions.
    mongo_uri: str = "mongodb://localhost:27017"
    mongo_db: str = "mokhotsi"
    # One deadline for all database work in a request; on expiry the request fails with 503.
    mongo_request_timeout_seconds: float = Field(default=20, gt=0)

    jwt_secret: SecretStr = Field(min_length=32)
    jwt_algorithm: Literal["HS256"] = "HS256"
    access_token_ttl_minutes: int = Field(default=15, gt=0)
    refresh_token_ttl_days: int = Field(default=30, gt=0)
    # A system admin's session reaches every shop, so it expires sooner.
    admin_refresh_token_ttl_hours: int = Field(default=12, gt=0)
    device_token_ttl_minutes: int = Field(default=15, gt=0)

    # Empty = rate limits are kept in process memory (fine for one dev/test process only).
    redis_url: str | None = None
    rate_limit_enabled: bool = True
    rate_limit_user_per_minute: int = Field(default=300, gt=0)
    rate_limit_anon_per_minute: int = Field(default=60, gt=0)
    rate_limit_login_per_minute: int = Field(default=5, gt=0)
    rate_limit_register_per_hour: int = Field(default=10, gt=0)
    # PIN changes reveal whether a PIN is taken in the shop, so they are slowed down.
    rate_limit_pin_change_per_hour: int = Field(default=10, gt=0)

    # Wrong PINs lock the account for pin_lockout_seconds, doubling on every further lockout
    # (capped at pin_lockout_max_hours). The admin's PIN guards every shop: fewer tries.
    pin_max_failures: int = Field(default=5, gt=0)
    admin_pin_max_failures: int = Field(default=3, gt=0)
    pin_lockout_seconds: int = Field(default=60, gt=0)
    pin_lockout_max_hours: int = Field(default=24, gt=0)

    max_shops_per_owner: int = Field(default=20, gt=0)

    idempotency_ttl_hours: int = Field(default=24, gt=0)

    # Country calling code for phone numbers entered without one (Lesotho).
    default_country_code: str = Field(default="266", pattern=r"^[1-9]\d{0,2}$")

    # Empty = no CORS middleware at all (the phone app is not a browser).
    cors_origins: list[str] = []

    # Product photos and correction crops (ADR 0005 amendment 2). Phones upload straight to
    # Cloudinary with a signature from the API; without these the photo endpoints answer 503.
    cloudinary_cloud_name: str | None = None
    cloudinary_api_key: str | None = None
    cloudinary_api_secret: SecretStr | None = None
    photo_max_bytes: int = Field(default=5_000_000, gt=0)

    @property
    def cloudinary_configured(self) -> bool:
        return bool(
            self.cloudinary_cloud_name and self.cloudinary_api_key and self.cloudinary_api_secret
        )

    @model_validator(mode="after")
    def _prod_requires_redis(self) -> Self:
        if self.environment == "prod" and self.rate_limit_enabled and not self.redis_url:
            raise ValueError("REDIS_URL is required in prod: rate limits must be shared")
        return self

    @model_validator(mode="after")
    def _prod_requires_cloudinary(self) -> Self:
        if self.environment == "prod" and not self.cloudinary_configured:
            raise ValueError(
                "CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET are required "
                "in prod: phones store product photos there"
            )
        return self


@lru_cache
def get_settings() -> Settings:
    # JWT_SECRET has no default on purpose: the app refuses to start without it.
    return Settings()  # type: ignore[call-arg]
