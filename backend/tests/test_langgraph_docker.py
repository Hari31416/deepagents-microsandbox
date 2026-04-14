import pytest

from scripts.langgraph_docker import ensure_license_configured, sanitize_compose_stdin


def test_sanitize_compose_stdin_preserves_dependency_loop_variables() -> None:
    compose_stdin = 'RUN echo "Installing $dep" && [ -d "$dep" ] && (cd "$dep" && uv pip install -e .)'

    sanitized = sanitize_compose_stdin(compose_stdin)

    assert sanitized == 'RUN echo "Installing $$dep" && [ -d "$$dep" ] && (cd "$$dep" && uv pip install -e .)'


def test_ensure_license_configured_requires_langgraph_license(monkeypatch) -> None:
    monkeypatch.delenv("LANGSMITH_API_KEY", raising=False)
    monkeypatch.delenv("LANGGRAPH_CLOUD_LICENSE_KEY", raising=False)

    with pytest.raises(RuntimeError, match="LANGSMITH_API_KEY"):
        ensure_license_configured()


def test_ensure_license_configured_accepts_langsmith_api_key(monkeypatch) -> None:
    monkeypatch.setenv("LANGSMITH_API_KEY", "ls-test-key")
    monkeypatch.delenv("LANGGRAPH_CLOUD_LICENSE_KEY", raising=False)

    ensure_license_configured()
