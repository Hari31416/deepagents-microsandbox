from dataclasses import asdict, dataclass

from app.db.repositories import ThreadRepository


@dataclass
class ThreadRecord:
    thread_id: str
    owner_id: str
    title: str | None
    created_at: str


class ThreadService:
    def __init__(self, repository: ThreadRepository) -> None:
        self._repository = repository

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

    def update_thread_title(self, owner_id: str, thread_id: str, title: str) -> dict[str, str | None] | None:
        record = self._repository.update_title(owner_id=owner_id, thread_id=thread_id, title=title)
        if record is None:
            return None
        return asdict(self._to_record(record))

    @staticmethod
    def _to_record(record) -> ThreadRecord:
        return ThreadRecord(
            thread_id=record.id,
            owner_id=record.owner_id,
            title=record.title,
            created_at=record.created_at.isoformat(),
        )
