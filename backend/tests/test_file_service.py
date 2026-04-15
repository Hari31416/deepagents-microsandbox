from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

import pytest

from app.services.file_service import FileService
from app.storage.minio import PresignedUrl, StoredObjectMetadata


class StubThreadService:
    def get_thread_for_actor(self, *, actor_user_id: str, actor_role: str, thread_id: str):
        if thread_id != "thread-1":
            return None
        return {"thread_id": thread_id, "owner_id": actor_user_id}


@dataclass
class StubFileRow:
    id: str
    thread_id: str
    object_key: str
    filename: str
    kind: str
    content_type: str
    size: int
    status: str
    created_at: datetime


class StubFileRepository:
    def __init__(self) -> None:
        self.records: dict[tuple[str, str], StubFileRow] = {}

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
    ) -> StubFileRow:
        record = StubFileRow(
            id=file_id or f"generated-{len(self.records) + 1}",
            thread_id=thread_id,
            object_key=object_key,
            filename=filename,
            kind=kind,
            content_type=content_type,
            size=size,
            status=status,
            created_at=datetime.now(UTC),
        )
        self.records[(thread_id, record.id)] = record
        return record

    def get_file(self, thread_id: str, file_id: str) -> StubFileRow | None:
        return self.records.get((thread_id, file_id))


class StubStorage:
    def __init__(self) -> None:
        self._counter = 0
        self.objects: dict[str, StoredObjectMetadata] = {}

    @property
    def presigned_url_expiry_seconds(self) -> int:
        return 900

    def allocate_file_id(self) -> str:
        self._counter += 1
        return f"file-{self._counter}"

    def create_presigned_upload(self, object_key: str) -> PresignedUrl:
        return PresignedUrl(
            object_key=object_key,
            url=f"https://storage.example/upload/{object_key}",
            expires_at="2026-04-15T00:00:00Z",
            required_headers={},
        )

    def create_presigned_download(self, object_key: str) -> PresignedUrl:
        return PresignedUrl(
            object_key=object_key,
            url=f"https://storage.example/download/{object_key}",
            expires_at="2026-04-15T00:00:00Z",
            required_headers={},
        )

    def stat_object(self, object_key: str) -> StoredObjectMetadata:
        metadata = self.objects.get(object_key)
        if metadata is None:
            raise ValueError("missing object")
        return metadata


def test_complete_upload_uses_server_issued_intent_and_persists_same_file_id() -> None:
    repository = StubFileRepository()
    storage = StubStorage()
    service = FileService(
        repository=repository,
        thread_service=StubThreadService(),
        storage=storage,
    )

    ticket = service.create_upload_ticket(
        actor_user_id="user-1",
        actor_role="user",
        thread_id="thread-1",
        filename="report.csv",
        content_type="text/csv",
        size=12,
    )
    storage.objects[ticket["object_key"]] = StoredObjectMetadata(
        object_key=ticket["object_key"],
        size=12,
        content_type="text/csv",
    )

    completed = service.complete_upload(
        actor_user_id="user-1",
        actor_role="user",
        thread_id="thread-1",
        file_id=ticket["file_id"],
    )

    assert completed["file_id"] == ticket["file_id"]
    assert completed["original_filename"] == "report.csv"
    assert repository.get_file("thread-1", ticket["file_id"]) is not None


def test_complete_upload_rejects_stolen_upload_intent() -> None:
    repository = StubFileRepository()
    storage = StubStorage()
    service = FileService(
        repository=repository,
        thread_service=StubThreadService(),
        storage=storage,
    )

    ticket = service.create_upload_ticket(
        actor_user_id="user-1",
        actor_role="user",
        thread_id="thread-1",
        filename="report.csv",
        content_type="text/csv",
        size=12,
    )
    storage.objects[ticket["object_key"]] = StoredObjectMetadata(
        object_key=ticket["object_key"],
        size=12,
        content_type="text/csv",
    )

    with pytest.raises(ValueError, match="Upload ticket expired or not found"):
        service.complete_upload(
            actor_user_id="user-2",
            actor_role="admin",
            thread_id="thread-1",
            file_id=ticket["file_id"],
        )


def test_download_ticket_validates_thread_prefix_before_presigning() -> None:
    repository = StubFileRepository()
    storage = StubStorage()
    service = FileService(
        repository=repository,
        thread_service=StubThreadService(),
        storage=storage,
    )
    repository.create_file(
        file_id="file-1",
        thread_id="thread-1",
        object_key="thread-2/file-1/report.csv",
        filename="report.csv",
        kind="upload",
        content_type="text/csv",
        size=12,
        status="completed",
    )

    with pytest.raises(ValueError, match="File not found"):
        service.create_download_ticket(
            actor_user_id="user-1",
            actor_role="user",
            thread_id="thread-1",
            file_id="file-1",
        )
