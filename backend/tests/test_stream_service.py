from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from app.agent.backend import FileUploadResponse
from app.config import Settings
from app.services.stream_service import StreamService
from langgraph.errors import GraphRecursionError


class StubThreadService:
    def __init__(self) -> None:
        self.updated_titles: list[dict[str, str]] = []

    def get_thread_for_actor(
        self, *, actor_user_id: str, actor_role: str, thread_id: str
    ):
        if actor_user_id == "user-1" and thread_id == "thread-1":
            return {
                "thread_id": thread_id,
                "owner_id": "user-1",
                "title": "New Conversation",
            }
        return None

    def update_thread_title(
        self, actor_user_id: str, actor_role: str, thread_id: str, title: str
    ):
        self.updated_titles.append(
            {
                "owner_id": actor_user_id,
                "actor_role": actor_role,
                "thread_id": thread_id,
                "title": title,
            }
        )
        return {"thread_id": thread_id, "owner_id": actor_user_id, "title": title}


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
        self.imported_artifacts: list[dict[str, object]] = []

    def list_files(
        self, actor_user_id: str, actor_role: str, thread_id: str
    ) -> list[dict[str, object]]:
        self.list_files_calls.append((actor_user_id, actor_role, thread_id))
        return list(self._files)

    def list_files_by_ids(
        self, thread_id: str, file_ids: list[str]
    ) -> list[dict[str, object]]:
        self.list_files_by_ids_calls.append((thread_id, list(file_ids)))
        file_ids_set = set(file_ids)
        return [file for file in self._files if file["file_id"] in file_ids_set]

    def get_file_content(self, thread_id: str, file_id: str) -> tuple[str, bytes]:
        self.content_requests.append(file_id)
        if thread_id != "thread-1" or file_id != "file-1":
            raise ValueError("File not found")
        return ("iris.csv", b"sepal_length,sepal_width\n5.1,3.5\n")

    def import_artifact(
        self,
        *,
        actor_user_id: str,
        actor_role: str,
        thread_id: str,
        relative_path: str,
        content: bytes,
        content_type: str | None = None,
    ) -> dict[str, object]:
        artifact = {
            "owner_id": actor_user_id,
            "actor_role": actor_role,
            "thread_id": thread_id,
            "relative_path": relative_path,
            "content": content,
            "content_type": content_type,
        }
        self.imported_artifacts.append(artifact)
        return artifact


class StubSandboxBackend:
    instances: list["StubSandboxBackend"] = []
    next_upload_results: list[FileUploadResponse] | None = None
    next_session_files: list[dict[str, object]] | None = None
    next_downloads: dict[str, bytes] = {}
    next_delete_result: bool = True
    delete_calls: int = 0

    def __init__(
        self, *, executor_base_url: str, thread_id: str, user_id: str | None = None
    ) -> None:
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

    def list_files(self) -> list[dict[str, object]]:
        if StubSandboxBackend.next_session_files is not None:
            return StubSandboxBackend.next_session_files
        return [{"path": "iris.csv", "size": 31, "content_type": "text/csv"}]

    def download_files(self, paths: list[str]):
        return [
            type(
                "Download",
                (),
                {
                    "path": path,
                    "content": StubSandboxBackend.next_downloads.get(path),
                    "error": (
                        None
                        if path in StubSandboxBackend.next_downloads
                        else "file_not_found"
                    ),
                },
            )()
            for path in paths
        ]

    def delete_session(self) -> bool:
        StubSandboxBackend.delete_calls += 1
        return StubSandboxBackend.next_delete_result


class StubRunService:
    def __init__(self) -> None:
        self.created_runs: list[dict[str, object]] = []
        self.running_runs: list[str] = []
        self.completed_runs: list[dict[str, object]] = []
        self.failed_runs: list[dict[str, object]] = []

    def create_run(self, **kwargs):
        run = {"run_id": "run-1", **kwargs, "status": "pending"}
        self.created_runs.append(run)
        return run

    def mark_running(self, *, run_id: str):
        self.running_runs.append(run_id)
        return {"run_id": run_id, "status": "running"}

    def complete_run(self, **kwargs):
        self.completed_runs.append(kwargs)
        return kwargs

    def fail_run(self, **kwargs):
        self.failed_runs.append(kwargs)
        return kwargs


class StubMessageService:
    def __init__(self) -> None:
        self.created_messages: list[dict[str, object]] = []
        self.updated_messages: list[dict[str, object]] = []

    def create_message(self, **kwargs):
        message = {
            "message_id": f"msg-{len(self.created_messages) + 1}",
            **kwargs,
        }
        self.created_messages.append(message)
        return message

    def update_message(self, **kwargs):
        self.updated_messages.append(kwargs)
        return kwargs

    def list_messages(self, *, owner_id: str, thread_id: str):
        return [
            message
            for message in self.created_messages
            if message["owner_id"] == owner_id and message["thread_id"] == thread_id
        ]


class StubRunEventService:
    def __init__(self) -> None:
        self.created_events: list[dict[str, object]] = []

    def create_event(self, **kwargs):
        self.created_events.append(kwargs)
        return kwargs


class StubMessageChunk:
    def __init__(self, text: str) -> None:
        self.text = text


class StubGraph:
    def __init__(
        self,
        parts: list[dict[str, object]] | None = None,
        error: Exception | None = None,
    ) -> None:
        self.parts = parts or []
        self.error = error
        self.calls: list[dict[str, object]] = []

    async def astream(self, payload, *, config, context, stream_mode, version):
        self.calls.append(
            {
                "payload": payload,
                "config": config,
                "context": context,
                "stream_mode": stream_mode,
                "version": version,
            }
        )
        if self.error is not None:
            raise self.error
        for part in self.parts:
            yield part


class StubRuntimeService:
    def __init__(self, graph: StubGraph) -> None:
        self.graph_instance = graph

    @asynccontextmanager
    async def graph(self):
        yield self.graph_instance


def test_stream_service_emits_backend_owned_sse_and_records_runs() -> None:
    thread_service = StubThreadService()
    file_service = StubFileService()
    message_service = StubMessageService()
    run_event_service = StubRunEventService()
    run_service = StubRunService()
    graph = StubGraph(
        parts=[
            {
                "type": "updates",
                "data": {
                    "agent": {
                        "messages": [
                            {
                                "type": "ai",
                                "id": "ai-1",
                                "content": "Inspecting iris.csv",
                                "tool_calls": [
                                    {
                                        "id": "call-1",
                                        "name": "python",
                                        "args": {"code": "print(1)"},
                                    }
                                ],
                            },
                            {
                                "type": "tool",
                                "id": "tool-1",
                                "tool_call_id": "call-1",
                                "name": "python",
                                "status": "success",
                                "content": "1",
                            },
                        ]
                    }
                },
            },
            {
                "type": "messages",
                "data": (StubMessageChunk("hello"), {"langgraph_node": "agent"}),
            },
        ]
    )
    StubSandboxBackend.instances = []
    StubSandboxBackend.next_upload_results = None
    StubSandboxBackend.next_session_files = [
        {"path": "iris.csv", "size": 31, "content_type": "text/csv"},
        {"path": "gender_survival_rate.png", "size": 1024, "content_type": "image/png"},
    ]
    StubSandboxBackend.next_downloads = {
        "gender_survival_rate.png": b"png-bytes",
    }
    StubSandboxBackend.next_delete_result = True
    StubSandboxBackend.delete_calls = 0
    service = StreamService(
        thread_service=thread_service,
        file_service=file_service,
        message_service=message_service,
        run_event_service=run_event_service,
        run_service=run_service,
        runtime_service=StubRuntimeService(graph),
        settings=Settings(database_url="sqlite+pysqlite:///:memory:"),
        sandbox_backend_factory=StubSandboxBackend,
    )

    async def consume_stream() -> str:
        chunks: list[str] = []
        async for chunk in service.stream_chat(
            actor_user_id="user-1",
            actor_role="user",
            thread_id="thread-1",
            message="What columns are in the file?",
            selected_file_ids=[],
        ):
            chunks.append(chunk)
        return "".join(chunks)

    output = asyncio.run(consume_stream())

    assert "event: metadata" in output
    assert "event: updates" in output
    assert "event: delta" in output
    assert "event: done" in output
    assert file_service.list_files_calls == [("user-1", "user", "thread-1")]
    assert thread_service.updated_titles == [
        {
            "owner_id": "user-1",
            "actor_role": "user",
            "thread_id": "thread-1",
            "title": "What columns are in the file?",
        }
    ]
    assert file_service.content_requests == ["file-1"]
    assert file_service.imported_artifacts == [
        {
            "owner_id": "user-1",
            "actor_role": "user",
            "thread_id": "thread-1",
            "relative_path": "gender_survival_rate.png",
            "content": b"png-bytes",
            "content_type": "image/png",
        }
    ]
    assert len(StubSandboxBackend.instances) == 3
    assert StubSandboxBackend.instances[0].uploaded_files == [
        ("iris.csv", b"sepal_length,sepal_width\n5.1,3.5\n")
    ]
    assert StubSandboxBackend.delete_calls == 1
    assert run_service.created_runs == [
        {
            "run_id": "run-1",
            "thread_id": "thread-1",
            "owner_id": "user-1",
            "input_message": (
                "Workspace files are mounted under /workspace in the sandbox.\n"
                "Workspace files currently available in the sandbox:\n"
                "- /workspace/iris.csv (file_id: file-1)\n\n"
                "User request:\n"
                "What columns are in the file?"
            ),
            "selected_file_ids": ["file-1"],
            "workspace_files": ["/workspace/iris.csv"],
            "status": "pending",
        }
    ]
    assert run_service.running_runs == ["run-1"]
    assert run_service.completed_runs == [
        {
            "run_id": "run-1",
            "output_text": "hello",
            "event_count": 3,
        }
    ]
    assert run_service.failed_runs == []
    assert message_service.created_messages == [
        {
            "message_id": "msg-1",
            "thread_id": "thread-1",
            "owner_id": "user-1",
            "role": "user",
            "content": "What columns are in the file?",
            "status": "completed",
        },
        {
            "message_id": "msg-2",
            "thread_id": "thread-1",
            "owner_id": "user-1",
            "role": "assistant",
            "content": "",
            "status": "streaming",
            "run_id": "run-1",
        },
    ]
    assert message_service.updated_messages == [
        {
            "message_id": "msg-2",
            "content": "hello",
            "status": "completed",
            "run_id": "run-1",
        }
    ]
    assert run_event_service.created_events == [
        {
            "run_id": "run-1",
            "thread_id": "thread-1",
            "owner_id": "user-1",
            "sequence": 1,
            "event_type": "run_started",
            "name": None,
            "node_name": None,
            "correlation_id": "run-1",
            "status": "running",
            "payload": {"message_id": "msg-2", "user_message_id": "msg-1"},
        },
        {
            "run_id": "run-1",
            "thread_id": "thread-1",
            "owner_id": "user-1",
            "sequence": 2,
            "event_type": "assistant_snapshot",
            "name": None,
            "node_name": "agent",
            "correlation_id": "ai-1",
            "status": "done",
            "payload": {"content": "Inspecting iris.csv"},
        },
        {
            "run_id": "run-1",
            "thread_id": "thread-1",
            "owner_id": "user-1",
            "sequence": 3,
            "event_type": "tool_call",
            "name": "python",
            "node_name": "agent",
            "correlation_id": "call-1",
            "status": "live",
            "payload": {"args": {"code": "print(1)"}},
        },
        {
            "run_id": "run-1",
            "thread_id": "thread-1",
            "owner_id": "user-1",
            "sequence": 4,
            "event_type": "tool_result",
            "name": "python",
            "node_name": "agent",
            "correlation_id": "call-1",
            "status": "done",
            "payload": {"content": "1", "tool_status": "success"},
        },
        {
            "run_id": "run-1",
            "thread_id": "thread-1",
            "owner_id": "user-1",
            "sequence": 5,
            "event_type": "run_completed",
            "name": None,
            "node_name": None,
            "correlation_id": "run-1",
            "status": "completed",
            "payload": {"message_id": "msg-2"},
        },
    ]
    assert graph.calls == [
        {
            "payload": {
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
            "config": {
                "recursion_limit": 50,
                "configurable": {"thread_id": "thread-1"},
            },
            "context": {
                "user_id": "user-1",
                "thread_id": "thread-1",
                "selected_file_ids": ["file-1"],
                "workspace_files": ["/workspace/iris.csv"],
            },
            "stream_mode": ("updates", "messages"),
            "version": "v2",
        }
    ]


def test_stream_service_stops_when_workspace_staging_fails() -> None:
    thread_service = StubThreadService()
    file_service = StubFileService()
    StubSandboxBackend.instances = []
    StubSandboxBackend.next_upload_results = [
        FileUploadResponse(path="iris.csv", error="permission_denied")
    ]
    StubSandboxBackend.next_session_files = None
    StubSandboxBackend.next_downloads = {}
    StubSandboxBackend.next_delete_result = True
    StubSandboxBackend.delete_calls = 0
    message_service = StubMessageService()
    run_event_service = StubRunEventService()
    run_service = StubRunService()
    service = StreamService(
        thread_service=thread_service,
        file_service=file_service,
        message_service=message_service,
        run_event_service=run_event_service,
        run_service=run_service,
        runtime_service=StubRuntimeService(StubGraph()),
        settings=Settings(database_url="sqlite+pysqlite:///:memory:"),
        sandbox_backend_factory=StubSandboxBackend,
    )

    async def consume_stream() -> str:
        chunks: list[str] = []
        async for chunk in service.stream_chat(
            actor_user_id="user-1",
            actor_role="user",
            thread_id="thread-1",
            message="Summarize the dataset",
            selected_file_ids=["file-1"],
        ):
            chunks.append(chunk)
        return "".join(chunks)

    output = asyncio.run(consume_stream())

    assert "event: error" in output
    assert "Failed to stage files in sandbox: iris.csv: permission_denied" in output
    assert run_service.created_runs == []
    assert thread_service.updated_titles == [
        {
            "owner_id": "user-1",
            "actor_role": "user",
            "thread_id": "thread-1",
            "title": "Summarize the dataset",
        }
    ]
    assert message_service.created_messages == [
        {
            "message_id": "msg-1",
            "thread_id": "thread-1",
            "owner_id": "user-1",
            "role": "user",
            "content": "Summarize the dataset",
            "status": "completed",
        },
        {
            "message_id": "msg-2",
            "thread_id": "thread-1",
            "owner_id": "user-1",
            "role": "assistant",
            "content": "Failed to stage files in sandbox: iris.csv: permission_denied",
            "status": "failed",
        },
    ]
    assert message_service.updated_messages == []
    assert run_event_service.created_events == []
    assert StubSandboxBackend.delete_calls == 1


def test_stream_service_records_runtime_failures() -> None:
    StubSandboxBackend.next_upload_results = None
    StubSandboxBackend.next_session_files = None
    StubSandboxBackend.next_downloads = {}
    StubSandboxBackend.next_delete_result = True
    StubSandboxBackend.delete_calls = 0
    thread_service = StubThreadService()
    message_service = StubMessageService()
    run_event_service = StubRunEventService()
    run_service = StubRunService()
    service = StreamService(
        thread_service=thread_service,
        file_service=StubFileService(),
        message_service=message_service,
        run_event_service=run_event_service,
        run_service=run_service,
        runtime_service=StubRuntimeService(
            StubGraph(error=RuntimeError("model backend offline"))
        ),
        settings=Settings(database_url="sqlite+pysqlite:///:memory:"),
        sandbox_backend_factory=StubSandboxBackend,
    )

    async def consume_stream() -> str:
        chunks: list[str] = []
        async for chunk in service.stream_chat(
            actor_user_id="user-1",
            actor_role="user",
            thread_id="thread-1",
            message="Summarize the dataset",
            selected_file_ids=["file-1"],
        ):
            chunks.append(chunk)
        return "".join(chunks)

    output = asyncio.run(consume_stream())

    assert "event: error" in output
    assert "model backend offline" in output
    assert thread_service.updated_titles == [
        {
            "owner_id": "user-1",
            "actor_role": "user",
            "thread_id": "thread-1",
            "title": "Summarize the dataset",
        }
    ]
    assert run_service.failed_runs == [
        {
            "run_id": "run-1",
            "error_detail": "model backend offline",
            "output_text": "",
            "event_count": 1,
        }
    ]
    assert message_service.updated_messages == [
        {
            "message_id": "msg-2",
            "content": "model backend offline",
            "status": "failed",
            "run_id": "run-1",
        }
    ]
    assert run_event_service.created_events == [
        {
            "run_id": "run-1",
            "thread_id": "thread-1",
            "owner_id": "user-1",
            "sequence": 1,
            "event_type": "run_started",
            "name": None,
            "node_name": None,
            "correlation_id": "run-1",
            "status": "running",
            "payload": {"message_id": "msg-2", "user_message_id": "msg-1"},
        },
        {
            "run_id": "run-1",
            "thread_id": "thread-1",
            "owner_id": "user-1",
            "sequence": 2,
            "event_type": "run_failed",
            "name": None,
            "node_name": None,
            "correlation_id": "run-1",
            "status": "failed",
            "payload": {"detail": "model backend offline", "message_id": "msg-2"},
        },
    ]
    assert StubSandboxBackend.delete_calls == 1


def test_stream_service_fails_when_run_reaches_step_limit() -> None:
    StubSandboxBackend.next_upload_results = None
    StubSandboxBackend.next_session_files = None
    StubSandboxBackend.next_downloads = {}
    StubSandboxBackend.next_delete_result = True
    StubSandboxBackend.delete_calls = 0
    thread_service = StubThreadService()
    message_service = StubMessageService()
    run_event_service = StubRunEventService()
    run_service = StubRunService()
    graph = StubGraph(error=GraphRecursionError())
    service = StreamService(
        thread_service=thread_service,
        file_service=StubFileService(),
        message_service=message_service,
        run_event_service=run_event_service,
        run_service=run_service,
        runtime_service=StubRuntimeService(graph),
        settings=Settings(
            database_url="sqlite+pysqlite:///:memory:",
            agent_max_run_steps=7,
        ),
        sandbox_backend_factory=StubSandboxBackend,
    )

    async def consume_stream() -> str:
        chunks: list[str] = []
        async for chunk in service.stream_chat(
            actor_user_id="user-1",
            actor_role="user",
            thread_id="thread-1",
            message="Summarize the dataset",
            selected_file_ids=["file-1"],
        ):
            chunks.append(chunk)
        return "".join(chunks)

    output = asyncio.run(consume_stream())

    assert "event: error" in output
    assert "Run stopped after reaching the maximum step limit" in output
    assert run_service.failed_runs == [
        {
            "run_id": "run-1",
            "error_detail": "Run stopped after reaching the maximum step limit",
            "output_text": "",
            "event_count": 1,
        }
    ]
    assert graph.calls == [
        {
            "payload": {
                "messages": [
                    {
                        "role": "user",
                        "content": (
                            "Workspace files are mounted under /workspace in the sandbox.\n"
                            "Workspace files currently available in the sandbox:\n"
                            "- /workspace/iris.csv (file_id: file-1)\n\n"
                            "User request:\n"
                            "Summarize the dataset"
                        ),
                    }
                ],
                "selected_file_ids": ["file-1"],
            },
            "config": {
                "recursion_limit": 7,
                "configurable": {"thread_id": "thread-1"},
            },
            "context": {
                "user_id": "user-1",
                "thread_id": "thread-1",
                "selected_file_ids": ["file-1"],
                "workspace_files": ["/workspace/iris.csv"],
            },
            "stream_mode": ("updates", "messages"),
            "version": "v2",
        }
    ]
    assert StubSandboxBackend.delete_calls == 1


def test_stream_service_fails_when_graph_finishes_without_final_response() -> None:
    StubSandboxBackend.next_upload_results = None
    StubSandboxBackend.next_session_files = [
        {"path": "iris.csv", "size": 31, "content_type": "text/csv"}
    ]
    StubSandboxBackend.next_downloads = {}
    StubSandboxBackend.next_delete_result = True
    StubSandboxBackend.delete_calls = 0
    thread_service = StubThreadService()
    message_service = StubMessageService()
    run_event_service = StubRunEventService()
    run_service = StubRunService()
    service = StreamService(
        thread_service=thread_service,
        file_service=StubFileService(),
        message_service=message_service,
        run_event_service=run_event_service,
        run_service=run_service,
        runtime_service=StubRuntimeService(
            StubGraph(
                parts=[
                    {
                        "type": "updates",
                        "data": {
                            "agent": {
                                "messages": [
                                    {
                                        "type": "ai",
                                        "id": "ai-1",
                                        "content": "",
                                        "tool_calls": [
                                            {
                                                "id": "call-1",
                                                "name": "python",
                                                "args": {"code": "print(1)"},
                                            }
                                        ],
                                    }
                                ]
                            }
                        },
                    }
                ]
            )
        ),
        settings=Settings(database_url="sqlite+pysqlite:///:memory:"),
        sandbox_backend_factory=StubSandboxBackend,
    )

    async def consume_stream() -> str:
        chunks: list[str] = []
        async for chunk in service.stream_chat(
            actor_user_id="user-1",
            actor_role="user",
            thread_id="thread-1",
            message="Summarize the dataset",
            selected_file_ids=["file-1"],
        ):
            chunks.append(chunk)
        return "".join(chunks)

    output = asyncio.run(consume_stream())

    assert "event: error" in output
    assert "Run ended before the agent produced a final response" in output
    assert run_service.completed_runs == []
    assert run_service.failed_runs == [
        {
            "run_id": "run-1",
            "error_detail": "Run ended before the agent produced a final response",
            "output_text": "",
            "event_count": 2,
        }
    ]
    assert StubSandboxBackend.delete_calls == 1
