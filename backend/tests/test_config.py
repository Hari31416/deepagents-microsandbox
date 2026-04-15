import pytest

from app.config import Settings


def test_settings_use_postgres_uri_when_present() -> None:
    settings = Settings(
        POSTGRES_URI="postgresql://postgres:postgres@host.docker.internal:5432/postgres"
    )

    assert (
        settings.database_url
        == "postgresql+psycopg://postgres:postgres@host.docker.internal:5432/postgres"
    )
    assert (
        settings.runtime_postgres_uri
        == "postgresql://postgres:postgres@host.docker.internal:5432/postgres"
    )


def test_settings_reject_insecure_auth_defaults_outside_development() -> None:
    with pytest.raises(
        ValueError, match="AUTH_SECRET_KEY must be changed outside development"
    ):
        Settings(app_env="production")


def test_settings_accept_secure_auth_configuration_outside_development() -> None:
    settings = Settings(
        app_env="production",
        auth_secret_key="x" * 32,
        super_admin_password="StrongPassword123!",
        auth_cookie_secure=True,
    )

    assert settings.app_env == "production"


def test_settings_default_agent_max_run_steps() -> None:
    settings = Settings()

    assert settings.agent_max_run_steps == 50


def test_settings_accept_agent_max_run_steps_from_env(monkeypatch) -> None:
    monkeypatch.setenv("AGENT_MAX_RUN_STEPS", "75")

    settings = Settings()

    assert settings.agent_max_run_steps == 75


def test_settings_reject_non_positive_agent_max_run_steps() -> None:
    with pytest.raises(ValueError, match="greater than or equal to 1"):
        Settings(agent_max_run_steps=0)
