from __future__ import annotations

from dataclasses import asdict, dataclass

from app.db.repositories import ThreadRunRecord, ThreadRunRepository


@dataclass
class RunRecord:
    run_id: str
    thread_id: str
    owner_id: str
    status: str
    input_message: str
    selected_file_ids: list[str]
    workspace_files: list[str]
    output_text: str | None
    error_detail: str | None
    event_count: int
    created_at: str
    started_at: str | None
    completed_at: str | None
    last_event_at: str | None


class RunService:
    def __init__(self, repository: ThreadRunRepository) -> None:
        self._repository = repository

    def create_run(
        self,
        *,
        thread_id: str,
        owner_id: str,
        input_message: str,
        selected_file_ids: list[str],
        workspace_files: list[str],
    ) -> dict[str, object]:
        return asdict(
            self._to_record(
                self._repository.create_run(
                    thread_id=thread_id,
                    owner_id=owner_id,
                    input_message=input_message,
                    selected_file_ids=selected_file_ids,
                    workspace_files=workspace_files,
                )
            )
        )

    def mark_running(self, *, run_id: str) -> dict[str, object]:
        return asdict(self._to_record(self._repository.mark_running(run_id=run_id)))

    def touch_run(self, *, run_id: str, event_count: int) -> dict[str, object]:
        return asdict(self._to_record(self._repository.touch_run(run_id=run_id, event_count=event_count)))

    def complete_run(self, *, run_id: str, output_text: str, event_count: int) -> dict[str, object]:
        return asdict(
            self._to_record(
                self._repository.complete_run(
                    run_id=run_id,
                    output_text=output_text,
                    event_count=event_count,
                )
            )
        )

    def fail_run(
        self,
        *,
        run_id: str,
        error_detail: str,
        output_text: str,
        event_count: int,
    ) -> dict[str, object]:
        return asdict(
            self._to_record(
                self._repository.fail_run(
                    run_id=run_id,
                    error_detail=error_detail,
                    output_text=output_text,
                    event_count=event_count,
                )
            )
        )

    def list_runs(self, *, owner_id: str, thread_id: str) -> list[dict[str, object]]:
        return [asdict(self._to_record(record)) for record in self._repository.list_runs(owner_id=owner_id, thread_id=thread_id)]

    def get_run(self, *, owner_id: str, thread_id: str, run_id: str) -> dict[str, object] | None:
        record = self._repository.get_run(owner_id=owner_id, thread_id=thread_id, run_id=run_id)
        return None if record is None else asdict(self._to_record(record))

    @staticmethod
    def _to_record(record: ThreadRunRecord) -> RunRecord:
        return RunRecord(
            run_id=record.run_id,
            thread_id=record.thread_id,
            owner_id=record.owner_id,
            status=record.status,
            input_message=record.input_message,
            selected_file_ids=record.selected_file_ids,
            workspace_files=record.workspace_files,
            output_text=record.output_text,
            error_detail=record.error_detail,
            event_count=record.event_count,
            created_at=record.created_at.isoformat(),
            started_at=record.started_at.isoformat() if record.started_at else None,
            completed_at=record.completed_at.isoformat() if record.completed_at else None,
            last_event_at=record.last_event_at.isoformat() if record.last_event_at else None,
        )
