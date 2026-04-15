from dataclasses import asdict, dataclass
import logging

import httpx

from app.db.repositories import SandboxSessionRepository, ThreadRepository
from app.security import ROLE_ADMIN, ROLE_SUPER_ADMIN
from app.storage.minio import MinioStorage

logger = logging.getLogger(__name__)


@dataclass
class ThreadRecord:
    thread_id: str
    owner_id: str
    title: str | None
    created_at: str


class ThreadService:
    def __init__(
        self,
        repository: ThreadRepository,
        storage: MinioStorage | None = None,
        sandbox_session_repository: SandboxSessionRepository | None = None,
    ) -> None:
        self._repository = repository
        self._storage = storage
        self._sandbox_session_repository = sandbox_session_repository

    def create_thread(
        self, owner_id: str, title: str | None = None
    ) -> dict[str, str | None]:
        thread = self._repository.create_thread(owner_id=owner_id, title=title)
        return asdict(self._to_record(thread))

    def list_threads(
        self, actor_user_id: str, actor_role: str
    ) -> list[dict[str, str | None]]:
        if actor_role == ROLE_SUPER_ADMIN:
            records = self._repository.list_all_threads()
        elif actor_role == ROLE_ADMIN:
            records = self._repository.list_admin_visible_threads(actor_user_id)
        else:
            records = self._repository.list_threads(owner_id=actor_user_id)
        return [asdict(self._to_record(record)) for record in records]

    def get_thread_for_owner(
        self, owner_id: str, thread_id: str
    ) -> dict[str, str | None] | None:
        record = self._repository.get_thread_for_owner(
            owner_id=owner_id, thread_id=thread_id
        )
        if record is None:
            return None
        return asdict(self._to_record(record))

    def get_thread_for_actor(
        self,
        *,
        actor_user_id: str,
        actor_role: str,
        thread_id: str,
    ) -> dict[str, str | None] | None:
        if actor_role == ROLE_SUPER_ADMIN:
            record = self._repository.get_thread(thread_id)
        elif actor_role == ROLE_ADMIN:
            record = self._repository.get_admin_visible_thread(
                admin_id=actor_user_id,
                thread_id=thread_id,
            )
        else:
            record = self._repository.get_thread_for_owner(
                owner_id=actor_user_id, thread_id=thread_id
            )
        if record is None:
            return None
        return asdict(self._to_record(record))

    def update_thread_title(
        self,
        actor_user_id: str,
        actor_role: str,
        thread_id: str,
        title: str | None,
    ) -> dict[str, str | None] | None:
        if (
            self.get_thread_for_actor(
                actor_user_id=actor_user_id, actor_role=actor_role, thread_id=thread_id
            )
            is None
        ):
            return None
        normalized_title = title.strip() if isinstance(title, str) else None
        record = self._repository.update_title(
            thread_id=thread_id, title=normalized_title or None
        )
        if record is None:
            return None
        return asdict(self._to_record(record))

    def delete_thread(
        self, actor_user_id: str, actor_role: str, thread_id: str
    ) -> bool:
        if (
            self.get_thread_for_actor(
                actor_user_id=actor_user_id, actor_role=actor_role, thread_id=thread_id
            )
            is None
        ):
            return False
        self._delete_executor_session(thread_id)
        if self._storage is not None:
            try:
                self._storage.delete_prefix(f"{thread_id}/")
            except Exception:
                logger.warning(
                    "Failed to delete storage objects for thread %s",
                    thread_id,
                    exc_info=True,
                )
        return self._repository.delete_thread(thread_id=thread_id)

    def _delete_executor_session(self, thread_id: str) -> None:
        if self._sandbox_session_repository is None:
            return

        mapping = self._sandbox_session_repository.get(thread_id=thread_id)
        if mapping is None:
            return

        with httpx.Client(base_url=mapping.executor_base_url, timeout=10.0) as client:
            response = client.delete(f"/v1/sessions/{mapping.sandbox_session_id}")
            if response.status_code in {204, 404}:
                return
            response.raise_for_status()

    @staticmethod
    def _to_record(record) -> ThreadRecord:
        return ThreadRecord(
            thread_id=record.id,
            owner_id=record.owner_id,
            title=record.title,
            created_at=record.created_at.isoformat(),
        )
