from dataclasses import dataclass
from functools import lru_cache

from app.config import Settings, get_settings
from app.services.file_service import FileService
from app.services.stream_service import StreamService
from app.services.thread_service import ThreadService
from app.storage.minio import MinioStorage


@dataclass(frozen=True)
class ServiceContainer:
    settings: Settings
    thread_service: ThreadService
    file_service: FileService
    stream_service: StreamService


@lru_cache(maxsize=1)
def get_services() -> ServiceContainer:
    settings = get_settings()
    thread_service = ThreadService()
    minio_storage = MinioStorage(settings)
    file_service = FileService(thread_service=thread_service, storage=minio_storage)
    stream_service = StreamService(thread_service=thread_service)
    return ServiceContainer(
        settings=settings,
        thread_service=thread_service,
        file_service=file_service,
        stream_service=stream_service,
    )
