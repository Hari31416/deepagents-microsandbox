from functools import lru_cache

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_AUTH_SECRET_KEY = "deepagent-dev-secret"
DEFAULT_SUPER_ADMIN_PASSWORD = "ChangeMe123!"


class Settings(BaseSettings):
    app_name: str = "deepagent-sandbox-backend"
    app_env: str = "development"
    api_prefix: str = "/api"
    default_user_id: str = "dev-user"
    agent_model: str = "openai:gpt-4o-mini"
    database_url: str = Field(
        default="postgresql+psycopg://deepagent:deepagent_password@localhost:5432/deepagent"
    )
    postgres_uri: str | None = Field(default=None, alias="POSTGRES_URI")
    executor_base_url: str = "http://localhost:3000"
    cors_allowed_origins: str = "http://localhost:3001,http://127.0.0.1:3001"
    agent_run_timeout_seconds: int = 600
    minio_endpoint: str = "localhost:9000"
    minio_access_key: str = "minioadmin"
    minio_secret_key: str = "minioadminpassword"
    minio_bucket: str = "deepagent"
    minio_secure: bool = False
    presigned_url_expiry_seconds: int = 900
    auth_secret_key: str = DEFAULT_AUTH_SECRET_KEY
    auth_access_cookie_name: str = "deepagent_access_token"
    auth_refresh_cookie_name: str = "deepagent_refresh_token"
    auth_access_token_ttl_seconds: int = 3600
    auth_refresh_token_ttl_seconds: int = 604800
    auth_cookie_secure: bool = False
    auth_login_max_attempts: int = 5
    auth_login_window_seconds: int = 300
    auth_login_lockout_seconds: int = 900
    super_admin_email: str = "superadmin@deepagent.local"
    super_admin_password: str = DEFAULT_SUPER_ADMIN_PASSWORD
    super_admin_name: str = "Super Admin"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    @model_validator(mode="after")
    def apply_langgraph_postgres_uri(self) -> "Settings":
        if self.postgres_uri:
            self.database_url = self.postgres_uri.replace(
                "postgresql://", "postgresql+psycopg://", 1
            )
        return self

    @model_validator(mode="after")
    def enforce_secure_auth_defaults(self) -> "Settings":
        if self.app_env.strip().lower() in {
            "development",
            "dev",
            "local",
            "test",
            "testing",
        }:
            return self

        if self.auth_secret_key == DEFAULT_AUTH_SECRET_KEY:
            raise ValueError("AUTH_SECRET_KEY must be changed outside development")
        if len(self.auth_secret_key) < 32:
            raise ValueError(
                "AUTH_SECRET_KEY must be at least 32 characters outside development"
            )
        if self.super_admin_password == DEFAULT_SUPER_ADMIN_PASSWORD:
            raise ValueError("SUPER_ADMIN_PASSWORD must be changed outside development")
        if not self.auth_cookie_secure:
            raise ValueError("AUTH_COOKIE_SECURE must be true outside development")
        return self

    @property
    def runtime_postgres_uri(self) -> str | None:
        if self.database_url.startswith("postgresql+psycopg://"):
            return self.database_url.replace(
                "postgresql+psycopg://", "postgresql://", 1
            )
        if self.database_url.startswith("postgresql://"):
            return self.database_url
        return None

    @property
    def parsed_cors_allowed_origins(self) -> list[str]:
        return [
            origin.strip()
            for origin in self.cors_allowed_origins.split(",")
            if origin.strip()
        ]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
