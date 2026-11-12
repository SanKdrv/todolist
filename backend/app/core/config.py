"""Application settings loaded from environment variables / .env file."""

from functools import lru_cache
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


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

    # Session / cookie policy (used by the session layer in the next stage).
    session_ttl_days: int = Field(default=30, ge=1)
    session_touch_interval_minutes: int = Field(default=60, ge=1)
    session_cleanup_interval_minutes: int = Field(default=60, ge=1)
    session_cookie_name: str = "tf_session"
    session_cookie_secure: bool = False
    session_cookie_samesite: Literal["lax", "strict"] = "lax"

    @model_validator(mode="after")
    def _check_production_cookie_policy(self) -> "Settings":
        if self.app_env == "production" and not self.session_cookie_secure:
            raise ValueError("SESSION_COOKIE_SECURE must be true in production")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
