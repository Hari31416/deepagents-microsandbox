from dataclasses import asdict, dataclass
from mimetypes import guess_type
from posixpath import basename
from typing import Any, Literal
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

        file_id = self._storage.allocate_file_id()
        object_key = f"{thread_id}/{file_id}/{filename}"
        ticket = self._storage.create_presigned_upload(object_key)

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

    def complete_upload(
        self,
        actor_user_id: str,
        actor_role: str,
        thread_id: str,
        object_key: str,
        original_filename: str,
        content_type: str,
        size: int,
        purpose: str = "upload",
    ) -> dict[str, Any]:
        if self._thread_service:
            thread = self._thread_service.get_thread_for_actor(
                actor_user_id=actor_user_id,
                actor_role=actor_role,
                thread_id=thread_id,
            )
            if not thread:
                raise ValueError("Thread not found")

        record = self._repository.create_file(
            thread_id=thread_id,
            object_key=object_key,
            filename=original_filename,
            kind=purpose,
            content_type=content_type,
            size=size,
            status="completed",
        )
        return asdict(self._to_record(record))

    def create_download_ticket(
        self,
        actor_user_id: str,
        actor_role: str,
        thread_id: str,
        file_id: str | None = None,
        object_key: str | None = None,
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

        if not object_key and file_id:
            record = self._repository.get_file(thread_id=thread_id, file_id=file_id)
            if not record:
                raise ValueError("File not found")
            object_key = record.object_key

        if not object_key:
            raise ValueError("Either file_id or object_key must be provided")

        ticket = self._storage.create_presigned_download(object_key)
        return {
            "thread_id": thread_id,
            "object_key": object_key,
            "url": ticket.url,
            "required_headers": ticket.required_headers,
            "expires_at": ticket.expires_at,
        }

    def list_files(self, actor_user_id: str, actor_role: str, thread_id: str) -> list[dict]:
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

        artifact_content_type = content_type or guess_type(normalized_path)[0] or "application/octet-stream"
        object_key = f"{thread_id}/artifacts/{normalized_path}"
        self._storage.put_object(object_key, content, artifact_content_type)

        existing = self._repository.get_file_by_object_key(thread_id=thread_id, object_key=object_key)
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
