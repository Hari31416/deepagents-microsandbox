from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from uuid import uuid4


@dataclass
class ThreadRecord:
    thread_id: str
    owner_id: str
    title: str | None
    created_at: str


class ThreadService:
    def __init__(self) -> None:
        self._threads: dict[str, ThreadRecord] = {}

    def create_thread(self, owner_id: str, title: str | None = None) -> dict[str, str | None]:
        record = ThreadRecord(
            thread_id=str(uuid4()),
            owner_id=owner_id,
            title=title,
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        self._threads[record.thread_id] = record
        return asdict(record)

    def list_threads(self, owner_id: str) -> list[dict[str, str | None]]:
        records = [record for record in self._threads.values() if record.owner_id == owner_id]
        records.sort(key=lambda item: item.created_at, reverse=True)
        return [asdict(record) for record in records]

    def get_thread_for_owner(self, owner_id: str, thread_id: str) -> dict[str, str | None] | None:
        record = self._threads.get(thread_id)
        if record is None or record.owner_id != owner_id:
            return None
        return asdict(record)
