from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from minio import Minio

from app.config import Settings


@dataclass(frozen=True)
class PresignedUrl:
    object_key: str
    url: str
    expires_at: str
    required_headers: dict[str, str]


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

    @staticmethod
    def allocate_file_id() -> str:
        return str(uuid4())

    def create_presigned_upload(self, object_key: str) -> PresignedUrl:
        expires = timedelta(seconds=self._settings.presigned_url_expiry_seconds)
        url = self._client.presigned_put_object(self.bucket_name, object_key, expires=expires)
        return PresignedUrl(
            object_key=object_key,
            url=url,
            expires_at=self._expires_at(expires),
            required_headers={},
        )

    def create_presigned_download(self, object_key: str) -> PresignedUrl:
        expires = timedelta(seconds=self._settings.presigned_url_expiry_seconds)
        url = self._client.presigned_get_object(self.bucket_name, object_key, expires=expires)
        return PresignedUrl(
            object_key=object_key,
            url=url,
            expires_at=self._expires_at(expires),
            required_headers={},
        )

    def get_object(self, object_key: str) -> bytes:
        response = self._client.get_object(self.bucket_name, object_key)
        try:
            return response.read()
        finally:
            response.close()
            response.release_conn()

    @staticmethod
    def _expires_at(expires: timedelta) -> str:
        return (datetime.now(timezone.utc) + expires).isoformat()
