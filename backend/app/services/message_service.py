from __future__ import annotations

from dataclasses import asdict, dataclass

from app.db.repositories import ThreadMessageRecord, ThreadMessageRepository


@dataclass
class MessageRecord:
    message_id: str
    thread_id: str
    owner_id: str
    role: str
    content: str
    status: str
    run_id: str | None
    created_at: str
    updated_at: str


class MessageService:
    def __init__(self, repository: ThreadMessageRepository) -> None:
        self._repository = repository

    def create_message(
        self,
        *,
        thread_id: str,
        owner_id: str,
        role: str,
        content: str,
        status: str = "completed",
        run_id: str | None = None,
    ) -> dict[str, object]:
        return asdict(
            self._to_record(
                self._repository.create_message(
                    thread_id=thread_id,
                    owner_id=owner_id,
                    role=role,
                    content=content,
                    status=status,
                    run_id=run_id,
                )
            )
        )

    def update_message(
        self,
        *,
        message_id: str,
        content: str,
        status: str,
        run_id: str | None = None,
    ) -> dict[str, object]:
        return asdict(
            self._to_record(
                self._repository.update_message(
                    message_id=message_id,
                    content=content,
                    status=status,
                    run_id=run_id,
                )
            )
        )

    def list_messages(
        self, *, owner_id: str, thread_id: str
    ) -> list[dict[str, object]]:
        return [
            asdict(self._to_record(record))
            for record in self._repository.list_messages(
                owner_id=owner_id, thread_id=thread_id
            )
        ]

    def get_message(
        self,
        *,
        owner_id: str,
        thread_id: str,
        message_id: str,
    ) -> dict[str, object] | None:
        record = self._repository.get_message(
            owner_id=owner_id,
            thread_id=thread_id,
            message_id=message_id,
        )
        return None if record is None else asdict(self._to_record(record))

    @staticmethod
    def _to_record(record: ThreadMessageRecord) -> MessageRecord:
        return MessageRecord(
            message_id=record.message_id,
            thread_id=record.thread_id,
            owner_id=record.owner_id,
            role=record.role,
            content=record.content,
            status=record.status,
            run_id=record.run_id,
            created_at=record.created_at.isoformat(),
            updated_at=record.updated_at.isoformat(),
        )
