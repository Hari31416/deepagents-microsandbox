from functools import lru_cache

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


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
    agent_run_timeout_seconds: int = 600
    minio_endpoint: str = "localhost:9000"
    minio_access_key: str = "minioadmin"
    minio_secret_key: str = "minioadminpassword"
    minio_bucket: str = "deepagent"
    minio_secure: bool = False
    presigned_url_expiry_seconds: int = 900

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    @model_validator(mode="after")
    def apply_langgraph_postgres_uri(self) -> "Settings":
        if self.postgres_uri:
            self.database_url = self.postgres_uri.replace("postgresql://", "postgresql+psycopg://", 1)
        return self

    @property
    def runtime_postgres_uri(self) -> str | None:
        if self.database_url.startswith("postgresql+psycopg://"):
            return self.database_url.replace("postgresql+psycopg://", "postgresql://", 1)
        if self.database_url.startswith("postgresql://"):
            return self.database_url
        return None


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
