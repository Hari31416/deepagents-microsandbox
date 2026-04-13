from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import desc, select
from sqlalchemy.orm import sessionmaker

from app.db.models import Thread, ThreadFile, ThreadSandboxSession, User


@dataclass(frozen=True)
class SandboxSessionRecord:
    thread_id: str
    sandbox_session_id: str
    executor_base_url: str


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
