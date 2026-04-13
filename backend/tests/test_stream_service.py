import asyncio

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

from app.agent.backend import FileUploadResponse
from app.config import Settings
from app.services.stream_service import StreamService


class StubThreadService:
    def get_thread_for_owner(self, owner_id: str, thread_id: str):
        if owner_id == "user-1" and thread_id == "thread-1":
            return {"thread_id": thread_id, "owner_id": owner_id}
        return None


class StubFileService:
    def __init__(self) -> None:
        self._files = [
            {
                "file_id": "file-1",
                "thread_id": "thread-1",
                "original_filename": "iris.csv",
                "content_type": "text/csv",
                "size": 128,
                "purpose": "upload",
                "status": "completed",
                "created_at": "2026-04-13T12:00:00Z",
            },
            {
                "file_id": "artifact-1",
                "thread_id": "thread-1",
                "original_filename": "chart.png",
                "content_type": "image/png",
                "size": 512,
                "purpose": "artifact",
                "status": "completed",
                "created_at": "2026-04-13T12:05:00Z",
            },
        ]
        self.list_files_calls: list[tuple[str, str]] = []
        self.list_files_by_ids_calls: list[tuple[str, list[str]]] = []
        self.content_requests: list[str] = []

    def list_files(self, owner_id: str, thread_id: str) -> list[dict[str, object]]:
        self.list_files_calls.append((owner_id, thread_id))
        return list(self._files)

    def list_files_by_ids(self, thread_id: str, file_ids: list[str]) -> list[dict[str, object]]:
        self.list_files_by_ids_calls.append((thread_id, list(file_ids)))
        file_ids_set = set(file_ids)
        return [file for file in self._files if file["file_id"] in file_ids_set]

    def get_file_content(self, thread_id: str, file_id: str) -> tuple[str, bytes]:
        self.content_requests.append(file_id)
        if thread_id != "thread-1" or file_id != "file-1":
            raise ValueError("File not found")
        return ("iris.csv", b"sepal_length,sepal_width\n5.1,3.5\n")


class StubSandboxBackend:
    instances: list["StubSandboxBackend"] = []
    next_upload_results: list[FileUploadResponse] | None = None

    def __init__(self, *, executor_base_url: str, thread_id: str, user_id: str | None = None) -> None:
        self.executor_base_url = executor_base_url
        self.thread_id = thread_id
        self.user_id = user_id
        self.uploaded_files: list[tuple[str, bytes]] = []
        StubSandboxBackend.instances.append(self)

    def upload_files(self, files: list[tuple[str, bytes]]) -> list[FileUploadResponse]:
        self.uploaded_files.extend(files)
        if StubSandboxBackend.next_upload_results is not None:
            return StubSandboxBackend.next_upload_results
        return [FileUploadResponse(path=path) for path, _ in files]


def test_stream_service_stages_thread_uploads_when_request_omits_file_ids() -> None:
    observed: dict[str, dict[str, object]] = {}
    app = FastAPI()

    @app.post("/threads")
    async def create_thread(request: Request):
        observed["create_thread"] = {
            "headers": dict(request.headers),
            "payload": await request.json(),
        }
        return JSONResponse({"thread_id": "thread-1"}, status_code=201)

    @app.post("/threads/thread-1/runs/stream")
    async def stream_run(request: Request):
        observed["stream_run"] = {
            "headers": dict(request.headers),
            "payload": await request.json(),
        }

        async def event_stream():
            yield b"event: message\ndata: {\"delta\":\"hello\"}\n\n"
            yield b"event: done\ndata: {\"thread_id\":\"thread-1\"}\n\n"

        return StreamingResponse(event_stream(), media_type="text/event-stream")

    file_service = StubFileService()
    StubSandboxBackend.instances = []
    StubSandboxBackend.next_upload_results = None
    service = StreamService(
        thread_service=StubThreadService(),
        file_service=file_service,
        settings=Settings(
            database_url="sqlite+pysqlite:///:memory:",
            langgraph_base_url="http://langgraph.test",
            langgraph_assistant_id="data-analyst",
            langgraph_stream_mode="updates",
        ),
        transport=httpx.ASGITransport(app=app),
        sandbox_backend_factory=StubSandboxBackend,
    )

    async def consume_stream() -> str:
        chunks: list[str] = []
        async for chunk in service.stream_chat(
            owner_id="user-1",
            thread_id="thread-1",
            message="What columns are in the file?",
            selected_file_ids=[],
        ):
            chunks.append(chunk.decode("utf-8") if isinstance(chunk, bytes) else chunk)
        return "".join(chunks)

    output = asyncio.run(consume_stream())

    assert "event: message" in output
    assert file_service.list_files_calls == [("user-1", "thread-1")]
    assert file_service.content_requests == ["file-1"]
    assert len(StubSandboxBackend.instances) == 1
    assert StubSandboxBackend.instances[0].uploaded_files == [
        ("iris.csv", b"sepal_length,sepal_width\n5.1,3.5\n")
    ]
    assert observed["stream_run"]["payload"] == {
        "assistant_id": "data-analyst",
        "input": {
            "messages": [
                {
                    "role": "user",
                    "content": (
                        "Workspace files are mounted under /workspace in the sandbox.\n"
                        "Workspace files currently available in the sandbox:\n"
                        "- /workspace/iris.csv (file_id: file-1)\n\n"
                        "User request:\n"
                        "What columns are in the file?"
                    ),
                }
            ],
            "selected_file_ids": ["file-1"],
        },
        "context": {
            "user_id": "user-1",
            "thread_id": "thread-1",
            "selected_file_ids": ["file-1"],
            "workspace_files": ["/workspace/iris.csv"],
        },
        "stream_mode": "updates",
    }


def test_stream_service_stops_when_workspace_staging_fails() -> None:
    file_service = StubFileService()
    StubSandboxBackend.instances = []
    StubSandboxBackend.next_upload_results = [
        FileUploadResponse(path="iris.csv", error="permission_denied")
    ]
    service = StreamService(
        thread_service=StubThreadService(),
        file_service=file_service,
        settings=Settings(
            database_url="sqlite+pysqlite:///:memory:",
            langgraph_base_url="http://langgraph.test",
            langgraph_assistant_id="data-analyst",
            langgraph_stream_mode="updates",
        ),
        transport=httpx.ASGITransport(app=FastAPI()),
        sandbox_backend_factory=StubSandboxBackend,
    )

    async def consume_stream() -> str:
        chunks: list[str] = []
        async for chunk in service.stream_chat(
            owner_id="user-1",
            thread_id="thread-1",
            message="Summarize the dataset",
            selected_file_ids=["file-1"],
        ):
            chunks.append(chunk.decode("utf-8") if isinstance(chunk, bytes) else chunk)
        return "".join(chunks)

    output = asyncio.run(consume_stream())

    assert "event: error" in output
    assert "Failed to stage files in sandbox: iris.csv: permission_denied" in output
