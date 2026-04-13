from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "deepagent-sandbox-backend"
    app_env: str = "development"
    api_prefix: str = "/api"
    default_user_id: str = "dev-user"
    database_url: str = Field(
        default="postgresql+psycopg://deepagent:deepagent_password@localhost:5432/deepagent"
    )
    executor_base_url: str = "http://localhost:3000"
    langgraph_base_url: str = "http://localhost:8123"
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


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
