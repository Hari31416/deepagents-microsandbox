from dataclasses import asdict, dataclass

from app.db.repositories import FileRepository
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
    def __init__(
        self,
        thread_service: ThreadService,
        storage: MinioStorage,
        repository: FileRepository,
    ) -> None:
        self._thread_service = thread_service
        self._storage = storage
        self._repository = repository

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
        file_id = self._storage.allocate_file_id()
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
        record = self._repository.create_file(
            thread_id=thread_id,
            object_key=object_key,
            filename=original_filename,
            kind=purpose,
            content_type=content_type,
            size=size,
            status="uploaded",
        )
        return asdict(self._to_record(record))

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
        return [asdict(self._to_record(record)) for record in self._repository.list_files(thread_id=thread_id)]

    def _require_owned_thread(self, owner_id: str, thread_id: str) -> None:
        if self._thread_service.get_thread_for_owner(owner_id=owner_id, thread_id=thread_id) is None:
            raise ValueError("Thread not found")

    def _resolve_file_id(self, thread_id: str, file_id: str | None) -> str:
        if file_id is None:
            raise ValueError("Either file_id or object_key is required")
        record = self._repository.get_file(thread_id=thread_id, file_id=file_id)
        if record is None:
            raise ValueError("File not found")
        return record.object_key

    @staticmethod
    def _to_record(record) -> FileRecord:
        return FileRecord(
            file_id=record.id,
            thread_id=record.thread_id,
            object_key=record.object_key,
            original_filename=record.filename,
            content_type=record.content_type,
            size=record.size,
            purpose=record.kind,
            status=record.status,
            created_at=record.created_at.isoformat(),
        )
