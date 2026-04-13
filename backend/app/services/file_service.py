from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from uuid import uuid4

from app.services.thread_service import ThreadService
from app.storage.minio import MinioStorage


@dataclass
class FileRecord:
    file_id: str
    thread_id: str
    object_key: str
    original_filename: str
    content_type: str
    size: int
    purpose: str
    status: str
    created_at: str


class FileService:
    def __init__(self, thread_service: ThreadService, storage: MinioStorage) -> None:
        self._thread_service = thread_service
        self._storage = storage
        self._files: dict[str, FileRecord] = {}

    def create_upload_ticket(
        self,
        owner_id: str,
        thread_id: str,
        filename: str,
        content_type: str,
        size: int,
        purpose: str,
    ) -> dict[str, object]:
        self._require_owned_thread(owner_id, thread_id)
        file_id = str(uuid4())
        object_key = f"threads/{thread_id}/{purpose}s/{file_id}/{filename}"
        ticket = self._storage.create_presigned_upload(object_key)
        return {
            "file_id": file_id,
            "thread_id": thread_id,
            "object_key": ticket.object_key,
            "url": ticket.url,
            "required_headers": ticket.required_headers,
            "expires_at": ticket.expires_at,
            "content_type": content_type,
            "size": size,
        }

    def complete_upload(
        self,
        owner_id: str,
        thread_id: str,
        object_key: str,
        original_filename: str,
        content_type: str,
        size: int,
        purpose: str,
    ) -> dict[str, object]:
        self._require_owned_thread(owner_id, thread_id)
        record = FileRecord(
            file_id=str(uuid4()),
            thread_id=thread_id,
            object_key=object_key,
            original_filename=original_filename,
            content_type=content_type,
            size=size,
            purpose=purpose,
            status="uploaded",
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        self._files[record.file_id] = record
        return asdict(record)

    def create_download_ticket(
        self,
        owner_id: str,
        thread_id: str,
        file_id: str | None,
        object_key: str | None,
    ) -> dict[str, object]:
        self._require_owned_thread(owner_id, thread_id)
        resolved_object_key = object_key or self._resolve_file_id(thread_id=thread_id, file_id=file_id)
        ticket = self._storage.create_presigned_download(resolved_object_key)
        return {
            "thread_id": thread_id,
            "object_key": ticket.object_key,
            "url": ticket.url,
            "required_headers": ticket.required_headers,
            "expires_at": ticket.expires_at,
        }

    def list_files(self, owner_id: str, thread_id: str) -> list[dict[str, object]]:
        self._require_owned_thread(owner_id, thread_id)
        records = [record for record in self._files.values() if record.thread_id == thread_id]
        records.sort(key=lambda item: item.created_at, reverse=True)
        return [asdict(record) for record in records]

    def _require_owned_thread(self, owner_id: str, thread_id: str) -> None:
        if self._thread_service.get_thread_for_owner(owner_id=owner_id, thread_id=thread_id) is None:
            raise ValueError("Thread not found")

    def _resolve_file_id(self, thread_id: str, file_id: str | None) -> str:
        if file_id is None:
            raise ValueError("Either file_id or object_key is required")
        record = self._files.get(file_id)
        if record is None or record.thread_id != thread_id:
            raise ValueError("File not found")
        return record.object_key
