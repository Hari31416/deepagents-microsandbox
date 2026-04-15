from __future__ import annotations

from datetime import UTC, datetime

from app.db.repositories import SandboxSessionRecord
from app.services.thread_service import ThreadService


class StubThreadRepository:
    def __init__(self) -> None:
        self.deleted_thread_id: str | None = None

    def get_thread_for_owner(self, owner_id: str, thread_id: str):
        return type(
            "ThreadRecord",
            (),
            {
                "id": thread_id,
                "owner_id": owner_id,
                "title": None,
                "created_at": datetime.now(UTC),
            },
        )()

    def delete_thread(self, *, thread_id: str) -> bool:
        self.deleted_thread_id = thread_id
        return True


class StubSandboxSessionRepository:
    def __init__(self) -> None:
        self.mapping = SandboxSessionRecord(
            thread_id="thread-1",
            sandbox_session_id="sess-thread-1",
            executor_base_url="http://executor.test",
        )

    def get(self, *, thread_id: str) -> SandboxSessionRecord | None:
        if thread_id == self.mapping.thread_id:
            return self.mapping
        return None


def test_delete_thread_deletes_executor_session(monkeypatch) -> None:
    calls: list[tuple[str, float, str]] = []

    class FakeResponse:
        status_code = 204

        def raise_for_status(self) -> None:
            return None

    class FakeClient:
        def __init__(self, *, base_url: str, timeout: float) -> None:
            self.base_url = base_url
            self.timeout = timeout

        def __enter__(self) -> "FakeClient":
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

        def delete(self, path: str) -> FakeResponse:
            calls.append((self.base_url, self.timeout, path))
            return FakeResponse()

    monkeypatch.setattr("app.services.thread_service.httpx.Client", FakeClient)

    repository = StubThreadRepository()
    sandbox_repository = StubSandboxSessionRepository()
    service = ThreadService(
        repository=repository,
        sandbox_session_repository=sandbox_repository,
    )

    deleted = service.delete_thread(
        actor_user_id="user-1",
        actor_role="user",
        thread_id="thread-1",
    )

    assert deleted is True
    assert repository.deleted_thread_id == "thread-1"
    assert calls == [("http://executor.test", 10.0, "/v1/sessions/sess-thread-1")]
