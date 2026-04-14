from dataclasses import asdict, dataclass
import logging

from app.db.repositories import ThreadRepository
from app.storage.minio import MinioStorage

logger = logging.getLogger(__name__)


@dataclass
class ThreadRecord:
    thread_id: str
    owner_id: str
    title: str | None
    created_at: str


class ThreadService:
    def __init__(self, repository: ThreadRepository, storage: MinioStorage | None = None) -> None:
        self._repository = repository
        self._storage = storage

    def create_thread(self, owner_id: str, title: str | None = None) -> dict[str, str | None]:
        thread = self._repository.create_thread(owner_id=owner_id, title=title)
        return asdict(self._to_record(thread))

    def list_threads(self, owner_id: str) -> list[dict[str, str | None]]:
        return [asdict(self._to_record(record)) for record in self._repository.list_threads(owner_id=owner_id)]

    def get_thread_for_owner(self, owner_id: str, thread_id: str) -> dict[str, str | None] | None:
        record = self._repository.get_thread_for_owner(owner_id=owner_id, thread_id=thread_id)
        if record is None:
            return None
        return asdict(self._to_record(record))

    def update_thread_title(self, owner_id: str, thread_id: str, title: str | None) -> dict[str, str | None] | None:
        normalized_title = title.strip() if isinstance(title, str) else None
        record = self._repository.update_title(
            owner_id=owner_id,
            thread_id=thread_id,
            title=normalized_title or None,
        )
        if record is None:
            return None
        return asdict(self._to_record(record))

    def delete_thread(self, owner_id: str, thread_id: str) -> bool:
        if self.get_thread_for_owner(owner_id=owner_id, thread_id=thread_id) is None:
            return False
        if self._storage is not None:
            try:
                self._storage.delete_prefix(f"{thread_id}/")
            except Exception:
                logger.warning("Failed to delete storage objects for thread %s", thread_id, exc_info=True)
        return self._repository.delete_thread(owner_id=owner_id, thread_id=thread_id)

    @staticmethod
    def _to_record(record) -> ThreadRecord:
        return ThreadRecord(
            thread_id=record.id,
            owner_id=record.owner_id,
            title=record.title,
            created_at=record.created_at.isoformat(),
        )
