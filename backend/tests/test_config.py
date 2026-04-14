from app.config import Settings


def test_settings_use_postgres_uri_when_present() -> None:
    settings = Settings(POSTGRES_URI="postgresql://postgres:postgres@host.docker.internal:5432/postgres")

    assert settings.database_url == "postgresql+psycopg://postgres:postgres@host.docker.internal:5432/postgres"
