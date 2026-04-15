from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from mimetypes import guess_type
from posixpath import basename
from threading import Lock
from typing import Any, BinaryIO

from app.db.repositories import FileRepository
from app.storage.minio import MinioStorage


@dataclass
class FileRecord:
    file_id: str
    thread_id: str
    original_filename: str
    content_type: str
    size: int
    purpose: str
    status: str
    created_at: str


@dataclass(frozen=True)
class UploadIntent:
    file_id: str
    actor_user_id: str
    thread_id: str
    object_key: str
    original_filename: str
    content_type: str
    size: int
    purpose: str
    expires_at: datetime


class FileService:
    def __init__(
        self,
        repository: FileRepository,
        thread_service=None,
        storage: MinioStorage | None = None,
    ) -> None:
        self._repository = repository
        self._thread_service = thread_service
        self._storage = storage
        self._upload_intents: dict[str, UploadIntent] = {}
        self._upload_intents_lock = Lock()

    def create_upload_ticket(
        self,
        actor_user_id: str,
        actor_role: str,
        thread_id: str,
        filename: str,
        content_type: str,
        size: int,
        purpose: str = "upload",
    ) -> dict[str, Any]:
        if not self._storage:
            raise ValueError("Storage not configured")

        # Verify thread exists and belongs to owner
        if self._thread_service:
            thread = self._thread_service.get_thread_for_actor(
                actor_user_id=actor_user_id,
                actor_role=actor_role,
                thread_id=thread_id,
            )
            if not thread:
                raise ValueError("Thread not found")

        normalized_filename = basename(filename.strip())
        if not normalized_filename:
            raise ValueError("Filename may not be empty")

        file_id = self._storage.allocate_file_id()
        object_key = f"{thread_id}/{file_id}/{normalized_filename}"
        ticket = self._storage.create_presigned_upload(object_key)
        self._store_upload_intent(
            UploadIntent(
                file_id=file_id,
                actor_user_id=actor_user_id,
                thread_id=thread_id,
                object_key=object_key,
                original_filename=normalized_filename,
                content_type=content_type,
                size=size,
                purpose=purpose,
                expires_at=datetime.now(UTC)
                + timedelta(seconds=self._storage.presigned_url_expiry_seconds),
            )
        )

        return {
            "file_id": file_id,
            "thread_id": thread_id,
            "object_key": object_key,
            "url": ticket.url,
            "required_headers": ticket.required_headers,
            "expires_at": ticket.expires_at,
            "content_type": content_type,
            "size": size,
        }

    def upload_file_stream(
        self,
        *,
        actor_user_id: str,
        actor_role: str,
        thread_id: str,
        filename: str,
        content_type: str,
        content_length: int,
        content_stream: BinaryIO,
        purpose: str = "upload",
    ) -> dict[str, Any]:
        if not self._storage:
            raise ValueError("Storage not configured")

        if self._thread_service:
            thread = self._thread_service.get_thread_for_actor(
                actor_user_id=actor_user_id,
                actor_role=actor_role,
                thread_id=thread_id,
            )
            if not thread:
                raise ValueError("Thread not found")

        normalized_filename = basename(filename.strip())
        if not normalized_filename:
            raise ValueError("Filename may not be empty")
        if content_length <= 0:
            raise ValueError("Uploaded file may not be empty")

        file_id = self._storage.allocate_file_id()
        object_key = f"{thread_id}/{file_id}/{normalized_filename}"
        content_stream.seek(0)
        self._storage.put_object_stream(
            object_key,
            content_stream,
            length=content_length,
            content_type=content_type,
        )
        object_metadata = self._storage.stat_object(object_key)
        self._assert_valid_thread_object_key(
            thread_id=thread_id,
            object_key=object_metadata.object_key,
            expected_file_id=file_id,
        )
        record = self._repository.create_file(
            file_id=file_id,
            thread_id=thread_id,
            object_key=object_key,
            filename=normalized_filename,
            kind=purpose,
            content_type=object_metadata.content_type or content_type,
            size=object_metadata.size,
            status="completed",
        )
        return asdict(self._to_record(record))

    def complete_upload(
        self,
        actor_user_id: str,
        actor_role: str,
        thread_id: str,
        file_id: str,
    ) -> dict[str, Any]:
        if self._thread_service:
            thread = self._thread_service.get_thread_for_actor(
                actor_user_id=actor_user_id,
                actor_role=actor_role,
                thread_id=thread_id,
            )
            if not thread:
                raise ValueError("Thread not found")

        existing = self._repository.get_file(thread_id=thread_id, file_id=file_id)
        if existing is not None:
            self._assert_valid_thread_object_key(
                thread_id=thread_id,
                object_key=existing.object_key,
                expected_file_id=file_id,
            )
            return asdict(self._to_record(existing))

        intent = self._get_upload_intent(
            actor_user_id=actor_user_id,
            thread_id=thread_id,
            file_id=file_id,
        )
        if intent is None:
            raise ValueError("Upload ticket expired or not found")

        if not self._storage:
            raise ValueError("Storage not configured")
        try:
            object_metadata = self._storage.stat_object(intent.object_key)
        except Exception as exc:
            raise ValueError("Uploaded object not found") from exc

        self._assert_valid_thread_object_key(
            thread_id=thread_id,
            object_key=object_metadata.object_key,
            expected_file_id=file_id,
        )
        record = self._repository.create_file(
            file_id=file_id,
            thread_id=thread_id,
            object_key=intent.object_key,
            filename=intent.original_filename,
            kind=intent.purpose,
            content_type=object_metadata.content_type or intent.content_type,
            size=object_metadata.size,
            status="completed",
        )
        self._consume_upload_intent(file_id)
        return asdict(self._to_record(record))

    def create_download_ticket(
        self,
        actor_user_id: str,
        actor_role: str,
        thread_id: str,
        file_id: str,
    ) -> dict[str, Any]:
        if not self._storage:
            raise ValueError("Storage not configured")
        record = self._get_authorized_file(
            actor_user_id=actor_user_id,
            actor_role=actor_role,
            thread_id=thread_id,
            file_id=file_id,
        )

        ticket = self._storage.create_presigned_download(record.object_key)
        return {
            "thread_id": thread_id,
            "object_key": record.object_key,
            "url": ticket.url,
            "required_headers": ticket.required_headers,
            "expires_at": ticket.expires_at,
        }

    def list_files(
        self, actor_user_id: str, actor_role: str, thread_id: str
    ) -> list[dict]:
        if self._thread_service:
            thread = self._thread_service.get_thread_for_actor(
                actor_user_id=actor_user_id,
                actor_role=actor_role,
                thread_id=thread_id,
            )
            if not thread:
                raise ValueError("Thread not found")

        records = self._repository.list_files(thread_id=thread_id)
        return [asdict(self._to_record(r)) for r in records]

    def list_files_by_ids(self, thread_id: str, file_ids: list[str]) -> list[dict]:
        records = self._repository.get_files_by_ids(
            thread_id=thread_id, file_ids=file_ids
        )
        return [asdict(self._to_record(r)) for r in records]

    def get_file_content(self, thread_id: str, file_id: str) -> tuple[str, bytes]:
        if not self._storage:
            raise ValueError("Storage not configured")

        record = self._repository.get_file(thread_id=thread_id, file_id=file_id)
        if not record:
            raise ValueError("File not found")

        content = self._storage.get_object(record.object_key)
        return record.filename, content

    def get_file_content_for_actor(
        self,
        *,
        actor_user_id: str,
        actor_role: str,
        thread_id: str,
        file_id: str,
    ) -> tuple[str, str, bytes]:
        if not self._storage:
            raise ValueError("Storage not configured")

        record = self._get_authorized_file(
            actor_user_id=actor_user_id,
            actor_role=actor_role,
            thread_id=thread_id,
            file_id=file_id,
        )
        content = self._storage.get_object(record.object_key)
        return (
            record.filename,
            record.content_type or "application/octet-stream",
            content,
        )

    def get_file_for_actor(
        self,
        *,
        actor_user_id: str,
        actor_role: str,
        thread_id: str,
        file_id: str,
    ) -> dict[str, Any]:
        record = self._get_authorized_file(
            actor_user_id=actor_user_id,
            actor_role=actor_role,
            thread_id=thread_id,
            file_id=file_id,
        )
        return asdict(self._to_record(record))

    def import_artifact(
        self,
        *,
        actor_user_id: str,
        actor_role: str,
        thread_id: str,
        relative_path: str,
        content: bytes,
        content_type: str | None = None,
    ) -> dict[str, Any]:
        if not self._storage:
            raise ValueError("Storage not configured")

        if self._thread_service:
            thread = self._thread_service.get_thread_for_actor(
                actor_user_id=actor_user_id,
                actor_role=actor_role,
                thread_id=thread_id,
            )
            if not thread:
                raise ValueError("Thread not found")

        normalized_path = relative_path.strip().lstrip("/")
        if not normalized_path:
            raise ValueError("Artifact path may not be empty")

        artifact_content_type = (
            content_type or guess_type(normalized_path)[0] or "application/octet-stream"
        )
        object_key = f"{thread_id}/artifacts/{normalized_path}"
        self._storage.put_object(object_key, content, artifact_content_type)

        existing = self._repository.get_file_by_object_key(
            thread_id=thread_id, object_key=object_key
        )
        if existing is not None:
            record = self._repository.update_file(
                thread_id=thread_id,
                file_id=existing.id,
                content_type=artifact_content_type,
                size=len(content),
                status="completed",
            )
            return asdict(self._to_record(record))

        record = self._repository.create_file(
            thread_id=thread_id,
            object_key=object_key,
            filename=basename(normalized_path),
            kind="artifact",
            content_type=artifact_content_type,
            size=len(content),
            status="completed",
        )
        return asdict(self._to_record(record))

    @staticmethod
    def _to_record(record) -> FileRecord:
        return FileRecord(
            file_id=record.id,
            thread_id=record.thread_id,
            original_filename=record.filename,
            content_type=record.content_type,
            size=record.size,
            purpose=record.kind,
            status=record.status,
            created_at=record.created_at.isoformat(),
        )

    def _store_upload_intent(self, intent: UploadIntent) -> None:
        now = datetime.now(UTC)
        with self._upload_intents_lock:
            self._prune_expired_upload_intents(now)
            self._upload_intents[intent.file_id] = intent

    def _get_upload_intent(
        self,
        *,
        actor_user_id: str,
        thread_id: str,
        file_id: str,
    ) -> UploadIntent | None:
        now = datetime.now(UTC)
        with self._upload_intents_lock:
            self._prune_expired_upload_intents(now)
            intent = self._upload_intents.get(file_id)
            if intent is None:
                return None
            if intent.actor_user_id != actor_user_id or intent.thread_id != thread_id:
                return None
            return intent

    def _consume_upload_intent(self, file_id: str) -> None:
        with self._upload_intents_lock:
            self._upload_intents.pop(file_id, None)

    def _prune_expired_upload_intents(self, now: datetime) -> None:
        expired_ids = [
            file_id
            for file_id, intent in self._upload_intents.items()
            if intent.expires_at <= now
        ]
        for file_id in expired_ids:
            self._upload_intents.pop(file_id, None)

    @staticmethod
    def _assert_valid_thread_object_key(
        *,
        thread_id: str,
        object_key: str,
        purpose: str | None = None,
        expected_file_id: str | None = None,
    ) -> None:
        if purpose == "artifact":
            expected_prefix = f"{thread_id}/artifacts/"
        elif expected_file_id is not None:
            expected_prefix = f"{thread_id}/{expected_file_id}/"
        else:
            expected_prefix = f"{thread_id}/"
        if not object_key.startswith(expected_prefix):
            raise ValueError("File not found")

    def _get_authorized_file(
        self,
        *,
        actor_user_id: str,
        actor_role: str,
        thread_id: str,
        file_id: str,
    ):
        if self._thread_service:
            thread = self._thread_service.get_thread_for_actor(
                actor_user_id=actor_user_id,
                actor_role=actor_role,
                thread_id=thread_id,
            )
            if not thread:
                raise ValueError("Thread not found")

        record = self._repository.get_file(thread_id=thread_id, file_id=file_id)
        if not record:
            raise ValueError("File not found")
        self._assert_valid_thread_object_key(
            thread_id=thread_id,
            object_key=record.object_key,
            purpose=record.kind,
            expected_file_id=file_id if record.kind != "artifact" else None,
        )
        return record
