from __future__ import annotations

from pathlib import Path

import pytest

from app.api.dependencies import get_services
from app.config import get_settings
from app.db.session import get_engine, get_session_factory


@pytest.fixture(autouse=True)
def isolate_backend_state(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    database_path = tmp_path / "backend.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite+pysqlite:///{database_path}")
    get_settings.cache_clear()
    get_engine.cache_clear()
    get_session_factory.cache_clear()
    get_services.cache_clear()
    yield
    get_services.cache_clear()
    get_session_factory.cache_clear()
    get_engine.cache_clear()
    get_settings.cache_clear()
