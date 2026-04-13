from app.agent.backend import build_executor_session_id, normalize_workspace_path


def test_build_executor_session_id_is_stable() -> None:
    assert build_executor_session_id("thread-123") == "sess_thread_thread-123"


def test_normalize_workspace_path_strips_leading_slash() -> None:
    assert normalize_workspace_path("/artifacts/chart.png") == "artifacts/chart.png"


def test_normalize_workspace_path_rejects_parent_escape() -> None:
    try:
        normalize_workspace_path("../secrets.txt")
    except ValueError as exc:
        assert "escapes workspace" in str(exc)
    else:  # pragma: no cover - defensive branch
        raise AssertionError("Expected ValueError for path traversal")
