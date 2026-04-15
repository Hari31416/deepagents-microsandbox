from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from io import BytesIO
from typing import BinaryIO
from uuid import uuid4

from minio import Minio

from app.config import Settings


@dataclass(frozen=True)
class PresignedUrl:
    object_key: str
    url: str
    expires_at: str
    required_headers: dict[str, str]


@dataclass(frozen=True)
class StoredObjectMetadata:
    object_key: str
    size: int
    content_type: str | None


class MinioStorage:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client = Minio(
            endpoint=settings.minio_endpoint,
            access_key=settings.minio_access_key,
            secret_key=settings.minio_secret_key,
            secure=settings.minio_secure,
        )

    @property
    def bucket_name(self) -> str:
        return self._settings.minio_bucket

    @property
    def presigned_url_expiry_seconds(self) -> int:
        return self._settings.presigned_url_expiry_seconds

    @staticmethod
    def allocate_file_id() -> str:
        return str(uuid4())

    def create_presigned_upload(self, object_key: str) -> PresignedUrl:
        expires = timedelta(seconds=self._settings.presigned_url_expiry_seconds)
        url = self._client.presigned_put_object(
            self.bucket_name, object_key, expires=expires
        )
        return PresignedUrl(
            object_key=object_key,
            url=url,
            expires_at=self._expires_at(expires),
            required_headers={},
        )

    def create_presigned_download(self, object_key: str) -> PresignedUrl:
        expires = timedelta(seconds=self._settings.presigned_url_expiry_seconds)
        url = self._client.presigned_get_object(
            self.bucket_name, object_key, expires=expires
        )
        return PresignedUrl(
            object_key=object_key,
            url=url,
            expires_at=self._expires_at(expires),
            required_headers={},
        )

    def stat_object(self, object_key: str) -> StoredObjectMetadata:
        stat = self._client.stat_object(self.bucket_name, object_key)
        return StoredObjectMetadata(
            object_key=getattr(stat, "object_name", object_key),
            size=int(stat.size),
            content_type=getattr(stat, "content_type", None),
        )

    def get_object(self, object_key: str) -> bytes:
        response = self._client.get_object(self.bucket_name, object_key)
        try:
            return response.read()
        finally:
            response.close()
            response.release_conn()

    def put_object(
        self, object_key: str, content: bytes, content_type: str | None = None
    ) -> None:
        self._client.put_object(
            self.bucket_name,
            object_key,
            BytesIO(content),
            length=len(content),
            content_type=content_type or "application/octet-stream",
        )

    def put_object_stream(
        self,
        object_key: str,
        stream: BinaryIO,
        *,
        length: int,
        content_type: str | None = None,
    ) -> None:
        self._client.put_object(
            self.bucket_name,
            object_key,
            stream,
            length=length,
            content_type=content_type or "application/octet-stream",
        )

    def delete_prefix(self, prefix: str) -> None:
        objects = self._client.list_objects(
            self.bucket_name, prefix=prefix, recursive=True
        )
        for obj in objects:
            self._client.remove_object(self.bucket_name, obj.object_name)

    @staticmethod
    def _expires_at(expires: timedelta) -> str:
        return (datetime.now(timezone.utc) + expires).isoformat()
