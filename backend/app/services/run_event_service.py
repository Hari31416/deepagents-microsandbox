from __future__ import annotations

from dataclasses import asdict, dataclass

from app.db.repositories import ThreadRunEventRecord, ThreadRunEventRepository


@dataclass
class RunEventRecord:
    event_id: str
    run_id: str
    thread_id: str
    owner_id: str
    sequence: int
    event_type: str
    name: str | None
    node_name: str | None
    correlation_id: str | None
    status: str | None
    payload: dict[str, object]
    created_at: str


class RunEventService:
    def __init__(self, repository: ThreadRunEventRepository) -> None:
        self._repository = repository

    def create_event(
        self,
        *,
        run_id: str,
        thread_id: str,
        owner_id: str,
        sequence: int,
        event_type: str,
        name: str | None = None,
        node_name: str | None = None,
        correlation_id: str | None = None,
        status: str | None = None,
        payload: dict[str, object] | None = None,
    ) -> dict[str, object]:
        return asdict(
            self._to_record(
                self._repository.create_event(
                    run_id=run_id,
                    thread_id=thread_id,
                    owner_id=owner_id,
                    sequence=sequence,
                    event_type=event_type,
                    name=name,
                    node_name=node_name,
                    correlation_id=correlation_id,
                    status=status,
                    payload=payload or {},
                )
            )
        )

    def list_events(
        self,
        *,
        owner_id: str,
        thread_id: str,
        run_id: str | None = None,
    ) -> list[dict[str, object]]:
        return [
            asdict(self._to_record(record))
            for record in self._repository.list_events(owner_id=owner_id, thread_id=thread_id, run_id=run_id)
        ]

    @staticmethod
    def _to_record(record: ThreadRunEventRecord) -> RunEventRecord:
        return RunEventRecord(
            event_id=record.event_id,
            run_id=record.run_id,
            thread_id=record.thread_id,
            owner_id=record.owner_id,
            sequence=record.sequence,
            event_type=record.event_type,
            name=record.name,
            node_name=record.node_name,
            correlation_id=record.correlation_id,
            status=record.status,
            payload=record.payload,
            created_at=record.created_at.isoformat(),
        )
