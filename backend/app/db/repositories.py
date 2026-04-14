from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import asc, desc, select
from sqlalchemy.orm import sessionmaker

from app.db.models import Thread, ThreadFile, ThreadMessage, ThreadRun, ThreadRunEvent, ThreadSandboxSession, User


@dataclass(frozen=True)
class SandboxSessionRecord:
    thread_id: str
    sandbox_session_id: str
    executor_base_url: str


@dataclass(frozen=True)
class ThreadRunRecord:
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
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None
    last_event_at: datetime | None


@dataclass(frozen=True)
class ThreadMessageRecord:
    message_id: str
    thread_id: str
    owner_id: str
    role: str
    content: str
    status: str
    run_id: str | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class ThreadRunEventRecord:
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
    created_at: datetime


class ThreadRepository:
    def __init__(self, session_factory: sessionmaker) -> None:
        self._session_factory = session_factory

    def create_thread(self, owner_id: str, title: str | None = None) -> Thread:
        with self._session_factory() as session:
            self._ensure_user(session=session, user_id=owner_id)
            thread = Thread(owner_id=owner_id, title=title)
            session.add(thread)
            session.commit()
            session.refresh(thread)
            return thread

    def list_threads(self, owner_id: str) -> list[Thread]:
        with self._session_factory() as session:
            statement = (
                select(Thread)
                .where(Thread.owner_id == owner_id)
                .order_by(desc(Thread.created_at))
            )
            return list(session.scalars(statement))

    def get_thread_for_owner(self, owner_id: str, thread_id: str) -> Thread | None:
        with self._session_factory() as session:
            statement = select(Thread).where(Thread.id == thread_id, Thread.owner_id == owner_id)
            return session.scalar(statement)

    @staticmethod
    def _ensure_user(*, session, user_id: str) -> None:
        existing = session.get(User, user_id)
        if existing is None:
            session.add(User(id=user_id))
            session.flush()


class FileRepository:
    def __init__(self, session_factory: sessionmaker) -> None:
        self._session_factory = session_factory

    def create_file(
        self,
        *,
        thread_id: str,
        object_key: str,
        filename: str,
        kind: str,
        content_type: str,
        size: int,
        status: str,
    ) -> ThreadFile:
        with self._session_factory() as session:
            record = ThreadFile(
                thread_id=thread_id,
                object_key=object_key,
                filename=filename,
                kind=kind,
                content_type=content_type,
                size=size,
                status=status,
            )
            session.add(record)
            session.commit()
            session.refresh(record)
            return record

    def list_files(self, thread_id: str) -> list[ThreadFile]:
        with self._session_factory() as session:
            statement = (
                select(ThreadFile)
                .where(ThreadFile.thread_id == thread_id)
                .order_by(desc(ThreadFile.created_at))
            )
            return list(session.scalars(statement))

    def get_file(self, thread_id: str, file_id: str) -> ThreadFile | None:
        with self._session_factory() as session:
            statement = select(ThreadFile).where(ThreadFile.id == file_id, ThreadFile.thread_id == thread_id)
            return session.scalar(statement)

    def get_files_by_ids(self, thread_id: str, file_ids: list[str]) -> list[ThreadFile]:
        if not file_ids:
            return []
        with self._session_factory() as session:
            statement = select(ThreadFile).where(
                ThreadFile.thread_id == thread_id,
                ThreadFile.id.in_(file_ids)
            )
            return list(session.scalars(statement))


class SandboxSessionRepository:
    def __init__(self, session_factory: sessionmaker) -> None:
        self._session_factory = session_factory

    def get_or_create(
        self,
        *,
        thread_id: str,
        sandbox_session_id: str,
        executor_base_url: str,
    ) -> SandboxSessionRecord:
        with self._session_factory() as session:
            record = session.get(ThreadSandboxSession, thread_id)
            if record is None:
                record = ThreadSandboxSession(
                    thread_id=thread_id,
                    sandbox_session_id=sandbox_session_id,
                    executor_base_url=executor_base_url,
                )
                session.add(record)
                session.commit()
                return self._to_record(record)

            changed = False
            if record.executor_base_url != executor_base_url:
                record.executor_base_url = executor_base_url
                changed = True
            if not record.sandbox_session_id:
                record.sandbox_session_id = sandbox_session_id
                changed = True
            if changed:
                session.commit()
            return self._to_record(record)

    @staticmethod
    def _to_record(record: ThreadSandboxSession) -> SandboxSessionRecord:
        return SandboxSessionRecord(
            thread_id=record.thread_id,
            sandbox_session_id=record.sandbox_session_id,
            executor_base_url=record.executor_base_url,
        )


class ThreadRunRepository:
    def __init__(self, session_factory: sessionmaker) -> None:
        self._session_factory = session_factory

    def create_run(
        self,
        *,
        thread_id: str,
        owner_id: str,
        input_message: str,
        selected_file_ids: list[str],
        workspace_files: list[str],
    ) -> ThreadRunRecord:
        with self._session_factory() as session:
            record = ThreadRun(
                thread_id=thread_id,
                owner_id=owner_id,
                status="pending",
                input_message=input_message,
                selected_file_ids=list(selected_file_ids),
                workspace_files=list(workspace_files),
            )
            session.add(record)
            session.commit()
            session.refresh(record)
            return self._to_record(record)

    def mark_running(self, *, run_id: str) -> ThreadRunRecord:
        return self._update_status(run_id=run_id, status="running", started_at=datetime.now(UTC))

    def complete_run(
        self,
        *,
        run_id: str,
        output_text: str,
        event_count: int,
    ) -> ThreadRunRecord:
        finished_at = datetime.now(UTC)
        with self._session_factory() as session:
            record = session.get(ThreadRun, run_id)
            if record is None:
                raise ValueError("Run not found")
            record.status = "completed"
            record.output_text = output_text
            record.error_detail = None
            record.event_count = event_count
            record.completed_at = finished_at
            record.last_event_at = finished_at
            session.commit()
            session.refresh(record)
            return self._to_record(record)

    def fail_run(
        self,
        *,
        run_id: str,
        error_detail: str,
        output_text: str,
        event_count: int,
    ) -> ThreadRunRecord:
        finished_at = datetime.now(UTC)
        with self._session_factory() as session:
            record = session.get(ThreadRun, run_id)
            if record is None:
                raise ValueError("Run not found")
            record.status = "failed"
            record.error_detail = error_detail
            record.output_text = output_text
            record.event_count = event_count
            record.completed_at = finished_at
            record.last_event_at = finished_at
            session.commit()
            session.refresh(record)
            return self._to_record(record)

    def list_runs(self, *, owner_id: str, thread_id: str) -> list[ThreadRunRecord]:
        with self._session_factory() as session:
            statement = (
                select(ThreadRun)
                .where(ThreadRun.owner_id == owner_id, ThreadRun.thread_id == thread_id)
                .order_by(desc(ThreadRun.created_at))
            )
            return [self._to_record(record) for record in session.scalars(statement)]

    def get_run(self, *, owner_id: str, thread_id: str, run_id: str) -> ThreadRunRecord | None:
        with self._session_factory() as session:
            statement = select(ThreadRun).where(
                ThreadRun.id == run_id,
                ThreadRun.owner_id == owner_id,
                ThreadRun.thread_id == thread_id,
            )
            record = session.scalar(statement)
            return None if record is None else self._to_record(record)

    def touch_run(self, *, run_id: str, event_count: int) -> ThreadRunRecord:
        with self._session_factory() as session:
            record = session.get(ThreadRun, run_id)
            if record is None:
                raise ValueError("Run not found")
            record.event_count = event_count
            record.last_event_at = datetime.now(UTC)
            session.commit()
            session.refresh(record)
            return self._to_record(record)

    def _update_status(
        self,
        *,
        run_id: str,
        status: str,
        started_at: datetime | None = None,
    ) -> ThreadRunRecord:
        with self._session_factory() as session:
            record = session.get(ThreadRun, run_id)
            if record is None:
                raise ValueError("Run not found")
            record.status = status
            if started_at is not None:
                record.started_at = started_at
                record.last_event_at = started_at
            session.commit()
            session.refresh(record)
            return self._to_record(record)

    @staticmethod
    def _to_record(record: ThreadRun) -> ThreadRunRecord:
        return ThreadRunRecord(
            run_id=record.id,
            thread_id=record.thread_id,
            owner_id=record.owner_id,
            status=record.status,
            input_message=record.input_message,
            selected_file_ids=list(record.selected_file_ids or []),
            workspace_files=list(record.workspace_files or []),
            output_text=record.output_text,
            error_detail=record.error_detail,
            event_count=record.event_count,
            created_at=record.created_at,
            started_at=record.started_at,
            completed_at=record.completed_at,
            last_event_at=record.last_event_at,
        )


class ThreadMessageRepository:
    def __init__(self, session_factory: sessionmaker) -> None:
        self._session_factory = session_factory

    def create_message(
        self,
        *,
        thread_id: str,
        owner_id: str,
        role: str,
        content: str,
        status: str,
        run_id: str | None = None,
    ) -> ThreadMessageRecord:
        with self._session_factory() as session:
            record = ThreadMessage(
                thread_id=thread_id,
                owner_id=owner_id,
                role=role,
                content=content,
                status=status,
                run_id=run_id,
            )
            session.add(record)
            session.commit()
            session.refresh(record)
            return self._to_record(record)

    def update_message(
        self,
        *,
        message_id: str,
        content: str,
        status: str,
        run_id: str | None = None,
    ) -> ThreadMessageRecord:
        with self._session_factory() as session:
            record = session.get(ThreadMessage, message_id)
            if record is None:
                raise ValueError("Message not found")
            record.content = content
            record.status = status
            record.run_id = run_id
            session.commit()
            session.refresh(record)
            return self._to_record(record)

    def list_messages(self, *, owner_id: str, thread_id: str) -> list[ThreadMessageRecord]:
        with self._session_factory() as session:
            statement = (
                select(ThreadMessage)
                .where(ThreadMessage.owner_id == owner_id, ThreadMessage.thread_id == thread_id)
                .order_by(asc(ThreadMessage.created_at), asc(ThreadMessage.id))
            )
            return [self._to_record(record) for record in session.scalars(statement)]

    def get_message(
        self,
        *,
        owner_id: str,
        thread_id: str,
        message_id: str,
    ) -> ThreadMessageRecord | None:
        with self._session_factory() as session:
            statement = select(ThreadMessage).where(
                ThreadMessage.id == message_id,
                ThreadMessage.owner_id == owner_id,
                ThreadMessage.thread_id == thread_id,
            )
            record = session.scalar(statement)
            return None if record is None else self._to_record(record)

    @staticmethod
    def _to_record(record: ThreadMessage) -> ThreadMessageRecord:
        return ThreadMessageRecord(
            message_id=record.id,
            thread_id=record.thread_id,
            owner_id=record.owner_id,
            role=record.role,
            content=record.content,
            status=record.status,
            run_id=record.run_id,
            created_at=record.created_at,
            updated_at=record.updated_at,
        )


class ThreadRunEventRepository:
    def __init__(self, session_factory: sessionmaker) -> None:
        self._session_factory = session_factory

    def create_event(
        self,
        *,
        run_id: str,
        thread_id: str,
        owner_id: str,
        sequence: int,
        event_type: str,
        name: str | None,
        node_name: str | None,
        correlation_id: str | None,
        status: str | None,
        payload: dict[str, object],
    ) -> ThreadRunEventRecord:
        with self._session_factory() as session:
            record = ThreadRunEvent(
                run_id=run_id,
                thread_id=thread_id,
                owner_id=owner_id,
                sequence=sequence,
                event_type=event_type,
                name=name,
                node_name=node_name,
                correlation_id=correlation_id,
                status=status,
                payload=payload,
            )
            session.add(record)
            session.commit()
            session.refresh(record)
            return self._to_record(record)

    def list_events(
        self,
        *,
        owner_id: str,
        thread_id: str,
        run_id: str | None = None,
    ) -> list[ThreadRunEventRecord]:
        with self._session_factory() as session:
            statement = (
                select(ThreadRunEvent)
                .where(ThreadRunEvent.owner_id == owner_id, ThreadRunEvent.thread_id == thread_id)
                .order_by(asc(ThreadRunEvent.created_at), asc(ThreadRunEvent.sequence), asc(ThreadRunEvent.id))
            )
            if run_id is not None:
                statement = statement.where(ThreadRunEvent.run_id == run_id)
            return [self._to_record(record) for record in session.scalars(statement)]

    @staticmethod
    def _to_record(record: ThreadRunEvent) -> ThreadRunEventRecord:
        return ThreadRunEventRecord(
            event_id=record.id,
            run_id=record.run_id,
            thread_id=record.thread_id,
            owner_id=record.owner_id,
            sequence=record.sequence,
            event_type=record.event_type,
            name=record.name,
            node_name=record.node_name,
            correlation_id=record.correlation_id,
            status=record.status,
            payload=dict(record.payload or {}),
            created_at=record.created_at,
        )
