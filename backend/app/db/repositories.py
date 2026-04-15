from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import asc, delete, desc, or_, select, update
from sqlalchemy.orm import Session, sessionmaker

from app.db.models import (
    AuditLog,
    RefreshToken,
    Thread,
    ThreadFile,
    ThreadMessage,
    ThreadRun,
    ThreadRunEvent,
    ThreadSandboxSession,
    User,
)
from app.security import ROLE_USER


@dataclass(frozen=True)
class UserRecord:
    user_id: str
    email: str
    display_name: str | None
    password_hash: str
    role: str
    status: str
    created_by: str | None
    is_seeded: bool
    created_at: datetime
    updated_at: datetime
    last_login_at: datetime | None


@dataclass(frozen=True)
class RefreshTokenRecord:
    token_id: str
    user_id: str
    token_hash: str
    expires_at: datetime
    revoked_at: datetime | None
    created_at: datetime


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


class UserRepository:
    def __init__(self, session_factory: sessionmaker) -> None:
        self._session_factory = session_factory

    def create_user(
        self,
        *,
        email: str,
        display_name: str | None,
        password_hash: str,
        role: str,
        status: str,
        created_by: str | None,
        is_seeded: bool,
    ) -> UserRecord:
        with self._session_factory() as session:
            record = User(
                email=email,
                display_name=display_name,
                password_hash=password_hash,
                role=role,
                status=status,
                created_by=created_by,
                is_seeded=is_seeded,
            )
            session.add(record)
            session.commit()
            session.refresh(record)
            return self._to_record(record)

    def get_by_id(self, user_id: str) -> UserRecord | None:
        with self._session_factory() as session:
            record = session.get(User, user_id)
            return None if record is None else self._to_record(record)

    def get_by_email(self, email: str) -> UserRecord | None:
        with self._session_factory() as session:
            statement = select(User).where(User.email == email)
            record = session.scalar(statement)
            return None if record is None else self._to_record(record)

    def list_users(self) -> list[UserRecord]:
        with self._session_factory() as session:
            statement = select(User).order_by(asc(User.created_at), asc(User.email))
            return [self._to_record(record) for record in session.scalars(statement)]

    def has_role(self, role: str) -> bool:
        with self._session_factory() as session:
            statement = select(User.id).where(User.role == role).limit(1)
            return session.scalar(statement) is not None

    def update_user(
        self,
        *,
        user_id: str,
        display_name: str | None = None,
        role: str | None = None,
        status: str | None = None,
    ) -> UserRecord:
        with self._session_factory() as session:
            record = session.get(User, user_id)
            if record is None:
                raise ValueError("User not found")
            if display_name is not None:
                record.display_name = display_name
            if role is not None:
                record.role = role
            if status is not None:
                record.status = status
            session.commit()
            session.refresh(record)
            return self._to_record(record)

    def update_password(self, *, user_id: str, password_hash: str) -> UserRecord:
        with self._session_factory() as session:
            record = session.get(User, user_id)
            if record is None:
                raise ValueError("User not found")
            record.password_hash = password_hash
            session.commit()
            session.refresh(record)
            return self._to_record(record)

    def update_last_login(self, *, user_id: str, last_login_at: datetime) -> None:
        with self._session_factory() as session:
            record = session.get(User, user_id)
            if record is None:
                raise ValueError("User not found")
            record.last_login_at = last_login_at
            session.commit()

    def exists(self, *, session: Session, user_id: str) -> bool:
        return session.get(User, user_id) is not None

    @staticmethod
    def _to_record(record: User) -> UserRecord:
        return UserRecord(
            user_id=record.id,
            email=record.email,
            display_name=record.display_name,
            password_hash=record.password_hash,
            role=record.role,
            status=record.status,
            created_by=record.created_by,
            is_seeded=record.is_seeded,
            created_at=record.created_at,
            updated_at=record.updated_at,
            last_login_at=record.last_login_at,
        )


class RefreshTokenRepository:
    def __init__(self, session_factory: sessionmaker) -> None:
        self._session_factory = session_factory

    def create_token(
        self,
        *,
        user_id: str,
        token_hash: str,
        expires_at: datetime,
    ) -> RefreshTokenRecord:
        with self._session_factory() as session:
            record = RefreshToken(
                user_id=user_id,
                token_hash=token_hash,
                expires_at=expires_at,
            )
            session.add(record)
            session.commit()
            session.refresh(record)
            return self._to_record(record)

    def get_active_by_hash(self, token_hash: str) -> RefreshTokenRecord | None:
        with self._session_factory() as session:
            statement = select(RefreshToken).where(
                RefreshToken.token_hash == token_hash
            )
            record = session.scalar(statement)
            if record is None:
                return None
            now = datetime.now(UTC)
            if record.revoked_at is not None or record.expires_at <= now:
                return None
            return self._to_record(record)

    def revoke_token(self, token_id: str) -> None:
        with self._session_factory() as session:
            record = session.get(RefreshToken, token_id)
            if record is None:
                return
            if record.revoked_at is None:
                record.revoked_at = datetime.now(UTC)
                session.commit()

    def revoke_all_tokens_for_user(self, user_id: str) -> int:
        now = datetime.now(UTC)
        with self._session_factory() as session:
            statement = (
                update(RefreshToken)
                .where(
                    RefreshToken.user_id == user_id,
                    RefreshToken.revoked_at.is_(None),
                    RefreshToken.expires_at > now,
                )
                .values(revoked_at=now)
            )
            result = session.execute(statement)
            session.commit()
            return int(result.rowcount or 0)

    @staticmethod
    def _to_record(record: RefreshToken) -> RefreshTokenRecord:
        return RefreshTokenRecord(
            token_id=record.id,
            user_id=record.user_id,
            token_hash=record.token_hash,
            expires_at=record.expires_at,
            revoked_at=record.revoked_at,
            created_at=record.created_at,
        )


class AuditLogRepository:
    def __init__(self, session_factory: sessionmaker) -> None:
        self._session_factory = session_factory

    def create_log(
        self,
        *,
        actor_id: str | None,
        actor_role: str | None,
        action: str,
        target_type: str | None,
        target_id: str | None,
        payload: dict[str, object],
    ) -> None:
        with self._session_factory() as session:
            record = AuditLog(
                actor_id=actor_id,
                actor_role=actor_role,
                action=action,
                target_type=target_type,
                target_id=target_id,
                payload=payload,
            )
            session.add(record)
            session.commit()


class ThreadRepository:
    def __init__(self, session_factory: sessionmaker) -> None:
        self._session_factory = session_factory

    def create_thread(self, owner_id: str, title: str | None = None) -> Thread:
        with self._session_factory() as session:
            if session.get(User, owner_id) is None:
                raise ValueError("Owner not found")
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

    def list_all_threads(self) -> list[Thread]:
        with self._session_factory() as session:
            statement = select(Thread).order_by(desc(Thread.created_at))
            return list(session.scalars(statement))

    def list_admin_visible_threads(self, admin_id: str) -> list[Thread]:
        with self._session_factory() as session:
            statement = (
                select(Thread)
                .join(User, Thread.owner_id == User.id)
                .where(or_(Thread.owner_id == admin_id, User.role == ROLE_USER))
                .order_by(desc(Thread.created_at))
            )
            return list(session.scalars(statement))

    def get_thread(self, thread_id: str) -> Thread | None:
        with self._session_factory() as session:
            return session.get(Thread, thread_id)

    def get_admin_visible_thread(self, *, admin_id: str, thread_id: str) -> Thread | None:
        with self._session_factory() as session:
            statement = (
                select(Thread)
                .join(User, Thread.owner_id == User.id)
                .where(
                    Thread.id == thread_id,
                    or_(Thread.owner_id == admin_id, User.role == ROLE_USER),
                )
            )
            return session.scalar(statement)

    def get_thread_for_owner(self, owner_id: str, thread_id: str) -> Thread | None:
        with self._session_factory() as session:
            statement = select(Thread).where(
                Thread.id == thread_id, Thread.owner_id == owner_id
            )
            return session.scalar(statement)

    def update_title(self, *, thread_id: str, title: str | None) -> Thread | None:
        with self._session_factory() as session:
            record = session.get(Thread, thread_id)
            if record is None:
                return None
            record.title = title
            session.commit()
            session.refresh(record)
            return record

    def delete_thread(self, *, thread_id: str) -> bool:
        with self._session_factory() as session:
            record = session.get(Thread, thread_id)
            if record is None:
                return False

            session.execute(
                delete(ThreadRunEvent).where(ThreadRunEvent.thread_id == thread_id)
            )
            session.execute(
                delete(ThreadMessage).where(ThreadMessage.thread_id == thread_id)
            )
            session.execute(delete(ThreadFile).where(ThreadFile.thread_id == thread_id))
            session.execute(
                delete(ThreadSandboxSession).where(
                    ThreadSandboxSession.thread_id == thread_id
                )
            )
            session.execute(delete(ThreadRun).where(ThreadRun.thread_id == thread_id))
            session.delete(record)
            session.commit()
            return True


class FileRepository:
    def __init__(self, session_factory: sessionmaker) -> None:
        self._session_factory = session_factory

    def create_file(
        self,
        *,
        file_id: str | None = None,
        thread_id: str,
        object_key: str,
        filename: str,
        kind: str,
        content_type: str,
        size: int,
        status: str,
    ) -> ThreadFile:
        with self._session_factory() as session:
            record_kwargs = {
                "thread_id": thread_id,
                "object_key": object_key,
                "filename": filename,
                "kind": kind,
                "content_type": content_type,
                "size": size,
                "status": status,
            }
            if file_id is not None:
                record_kwargs["id"] = file_id
            record = ThreadFile(**record_kwargs)
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
            statement = select(ThreadFile).where(
                ThreadFile.id == file_id, ThreadFile.thread_id == thread_id
            )
            return session.scalar(statement)

    def get_files_by_ids(self, thread_id: str, file_ids: list[str]) -> list[ThreadFile]:
        if not file_ids:
            return []
        with self._session_factory() as session:
            statement = select(ThreadFile).where(
                ThreadFile.thread_id == thread_id, ThreadFile.id.in_(file_ids)
            )
            return list(session.scalars(statement))

    def get_file_by_object_key(
        self, *, thread_id: str, object_key: str
    ) -> ThreadFile | None:
        with self._session_factory() as session:
            statement = select(ThreadFile).where(
                ThreadFile.thread_id == thread_id, ThreadFile.object_key == object_key
            )
            return session.scalar(statement)

    def update_file(
        self,
        *,
        thread_id: str,
        file_id: str,
        content_type: str,
        size: int,
        status: str,
    ) -> ThreadFile:
        with self._session_factory() as session:
            statement = select(ThreadFile).where(
                ThreadFile.id == file_id, ThreadFile.thread_id == thread_id
            )
            record = session.scalar(statement)
            if record is None:
                raise ValueError("File not found")
            record.content_type = content_type
            record.size = size
            record.status = status
            session.commit()
            session.refresh(record)
            return record


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
        return self._update_status(
            run_id=run_id, status="running", started_at=datetime.now(UTC)
        )

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

    def list_runs_by_thread(self, *, thread_id: str) -> list[ThreadRunRecord]:
        with self._session_factory() as session:
            statement = (
                select(ThreadRun)
                .where(ThreadRun.thread_id == thread_id)
                .order_by(desc(ThreadRun.created_at))
            )
            return [self._to_record(record) for record in session.scalars(statement)]

    def get_run(
        self, *, owner_id: str, thread_id: str, run_id: str
    ) -> ThreadRunRecord | None:
        with self._session_factory() as session:
            statement = select(ThreadRun).where(
                ThreadRun.id == run_id,
                ThreadRun.owner_id == owner_id,
                ThreadRun.thread_id == thread_id,
            )
            record = session.scalar(statement)
            return None if record is None else self._to_record(record)

    def get_run_by_thread(
        self, *, thread_id: str, run_id: str
    ) -> ThreadRunRecord | None:
        with self._session_factory() as session:
            statement = select(ThreadRun).where(
                ThreadRun.id == run_id, ThreadRun.thread_id == thread_id
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

    def list_messages(
        self, *, owner_id: str, thread_id: str
    ) -> list[ThreadMessageRecord]:
        with self._session_factory() as session:
            statement = (
                select(ThreadMessage)
                .where(
                    ThreadMessage.owner_id == owner_id,
                    ThreadMessage.thread_id == thread_id,
                )
                .order_by(
                    asc(ThreadMessage.created_at),
                    asc(ThreadMessage.id),
                )
            )
            return [self._to_record(record) for record in session.scalars(statement)]

    def list_messages_by_thread(self, *, thread_id: str) -> list[ThreadMessageRecord]:
        with self._session_factory() as session:
            statement = (
                select(ThreadMessage)
                .where(ThreadMessage.thread_id == thread_id)
                .order_by(
                    asc(ThreadMessage.created_at),
                    asc(ThreadMessage.id),
                )
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
                .where(
                    ThreadRunEvent.owner_id == owner_id,
                    ThreadRunEvent.thread_id == thread_id,
                )
                .order_by(
                    asc(ThreadRunEvent.created_at),
                    asc(ThreadRunEvent.sequence),
                    asc(ThreadRunEvent.id),
                )
            )
            if run_id is not None:
                statement = statement.where(ThreadRunEvent.run_id == run_id)
            return [self._to_record(record) for record in session.scalars(statement)]

    def list_events_by_thread(
        self,
        *,
        thread_id: str,
        run_id: str | None = None,
    ) -> list[ThreadRunEventRecord]:
        with self._session_factory() as session:
            statement = (
                select(ThreadRunEvent)
                .where(ThreadRunEvent.thread_id == thread_id)
                .order_by(
                    asc(ThreadRunEvent.created_at),
                    asc(ThreadRunEvent.sequence),
                    asc(ThreadRunEvent.id),
                )
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
