from dataclasses import dataclass
from functools import lru_cache

from app.config import Settings, get_settings
from app.db.repositories import FileRepository, ThreadRepository
from app.db.session import get_session_factory, init_database
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
    init_database()
    session_factory = get_session_factory()
    thread_repository = ThreadRepository(session_factory=session_factory)
    file_repository = FileRepository(session_factory=session_factory)
    thread_service = ThreadService(repository=thread_repository)
    minio_storage = MinioStorage(settings)
    file_service = FileService(
        thread_service=thread_service,
        storage=minio_storage,
        repository=file_repository,
    )
    stream_service = StreamService(thread_service=thread_service, settings=settings)
    return ServiceContainer(
        settings=settings,
        thread_service=thread_service,
        file_service=file_service,
        stream_service=stream_service,
    )
