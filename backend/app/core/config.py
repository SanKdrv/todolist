"""Application settings loaded from environment variables / .env file."""

from datetime import timedelta
from functools import lru_cache
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEV_COOKIE_NAME = "tf_session"
PROD_COOKIE_NAME = "__Host-tf_session"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_env: Literal["development", "test", "production"] = "development"
    app_debug: bool = False

    database_url: str = "postgresql+psycopg://taskflow:taskflow@localhost:5432/taskflow"

    # Session policy.
    session_ttl_days: int = Field(default=30, ge=1)
    session_touch_interval_minutes: int = Field(default=60, ge=1)
    session_cleanup_interval_minutes: int = Field(default=60, ge=1)

    # Optional explicit overrides. Left unset, they follow app_env
    # (dev: tf_session / insecure, prod: __Host-tf_session / Secure).
    session_cookie_name: str | None = None
    session_cookie_secure: bool | None = None

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @property
    def cookie_name(self) -> str:
        if self.session_cookie_name:
            return self.session_cookie_name
        return PROD_COOKIE_NAME if self.is_production else DEV_COOKIE_NAME

    @property
    def cookie_secure(self) -> bool:
        if self.session_cookie_secure is not None:
            return self.session_cookie_secure
        return self.is_production

    @property
    def session_ttl(self) -> timedelta:
        return timedelta(days=self.session_ttl_days)

    @property
    def session_touch_interval(self) -> timedelta:
        return timedelta(minutes=self.session_touch_interval_minutes)

    @model_validator(mode="after")
    def _validate_cookie_policy(self) -> "Settings":
        # __Host- prefix is only meaningful with Secure and is enforced by browsers.
        if self.cookie_name.startswith("__Host-") and not self.cookie_secure:
            raise ValueError("__Host- cookies require SESSION_COOKIE_SECURE=true")
        if self.is_production:
            if not self.cookie_secure:
                raise ValueError("SESSION_COOKIE_SECURE must be true in production")
            if not self.cookie_name.startswith("__Host-"):
                raise ValueError("SESSION_COOKIE_NAME must start with '__Host-' in production")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
