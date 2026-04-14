from dataclasses import dataclass
from functools import lru_cache

from app.config import Settings, get_settings
from app.db.repositories import FileRepository, ThreadMessageRepository, ThreadRepository, ThreadRunEventRepository, ThreadRunRepository
from app.db.session import get_session_factory, init_database
from app.services.file_service import FileService
from app.services.message_service import MessageService
from app.services.run_event_service import RunEventService
from app.services.run_service import RunService
from app.services.runtime_service import RuntimeService
from app.services.stream_service import StreamService
from app.services.thread_service import ThreadService
from app.storage.minio import MinioStorage


@dataclass(frozen=True)
class ServiceContainer:
    settings: Settings
    thread_service: ThreadService
    file_service: FileService
    message_service: MessageService
    run_event_service: RunEventService
    run_service: RunService
    runtime_service: RuntimeService
    stream_service: StreamService


@lru_cache(maxsize=1)
def get_services() -> ServiceContainer:
    settings = get_settings()
    init_database()
    session_factory = get_session_factory()
    thread_repository = ThreadRepository(session_factory=session_factory)
    file_repository = FileRepository(session_factory=session_factory)
    message_repository = ThreadMessageRepository(session_factory=session_factory)
    run_event_repository = ThreadRunEventRepository(session_factory=session_factory)
    run_repository = ThreadRunRepository(session_factory=session_factory)
    minio_storage = MinioStorage(settings)
    thread_service = ThreadService(repository=thread_repository, storage=minio_storage)
    file_service = FileService(
        thread_service=thread_service,
        storage=minio_storage,
        repository=file_repository,
    )
    message_service = MessageService(repository=message_repository)
    run_event_service = RunEventService(repository=run_event_repository)
    run_service = RunService(repository=run_repository)
    runtime_service = RuntimeService(settings=settings)
    stream_service = StreamService(
        thread_service=thread_service,
        file_service=file_service,
        message_service=message_service,
        run_event_service=run_event_service,
        run_service=run_service,
        runtime_service=runtime_service,
        settings=settings,
    )
    return ServiceContainer(
        settings=settings,
        thread_service=thread_service,
        file_service=file_service,
        message_service=message_service,
        run_event_service=run_event_service,
        run_service=run_service,
        runtime_service=runtime_service,
        stream_service=stream_service,
    )
