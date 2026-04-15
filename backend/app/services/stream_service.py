from __future__ import annotations

import asyncio
import json
import logging
from posixpath import basename
from typing import TYPE_CHECKING, Any

from app.agent.backend import MicrosandboxBackend
from app.config import Settings
from app.services.file_service import FileService
from app.services.message_service import MessageService
from app.services.run_event_service import RunEventService
from app.services.run_service import RunService
from app.services.runtime_service import RuntimeService
from app.services.thread_service import ThreadService
from langgraph.errors import GraphRecursionError

if TYPE_CHECKING:
    from collections.abc import AsyncIterator


logger = logging.getLogger(__name__)


_INTERNAL_NODES: frozenset[str] = frozenset(
    {
        "write_todos",
        "task",
        "plan",
        "orchestrator",
        "planner",
        "tools",
        "__start__",
        "__end__",
    }
)


def _sse(event: str, data: dict[str, object], *, event_id: str | None = None) -> str:
    lines: list[str] = []
    if event_id:
        lines.append(f"id: {event_id}")
    lines.append(f"event: {event}")
    lines.append(f"data: {json.dumps(data)}")
    return "\n".join(lines) + "\n\n"


class StreamService:
    def __init__(
        self,
        thread_service: ThreadService,
        file_service: FileService,
        message_service: MessageService,
        run_event_service: RunEventService,
        run_service: RunService,
        runtime_service: RuntimeService,
        settings: Settings,
        sandbox_backend_factory=MicrosandboxBackend,
    ) -> None:
        self._thread_service = thread_service
        self._file_service = file_service
        self._message_service = message_service
        self._run_event_service = run_event_service
        self._run_service = run_service
        self._runtime_service = runtime_service
        self._settings = settings
        self._sandbox_backend_factory = sandbox_backend_factory

    async def stream_chat(
        self,
        actor_user_id: str,
        actor_role: str,
        thread_id: str,
        message: str,
        selected_file_ids: list[str],
    ) -> AsyncIterator[str]:
        thread = self._thread_service.get_thread_for_actor(
            actor_user_id=actor_user_id,
            actor_role=actor_role,
            thread_id=thread_id,
        )
        if thread is None:
            yield _sse("error", {"detail": "Thread not found"})
            return
        owner_id = str(thread["owner_id"])

        self._maybe_update_thread_title(
            owner_id=owner_id,
            actor_role=actor_role,
            thread_id=thread_id,
            current_title=thread.get("title"),
            message=message,
        )

        user_message = self._message_service.create_message(
            thread_id=thread_id,
            owner_id=owner_id,
            role="user",
            content=message,
            status="completed",
        )
        assistant_message_id: str | None = None

        try:
            workspace_files = self._resolve_workspace_files(
                actor_user_id=actor_user_id,
                actor_role=actor_role,
                thread_id=thread_id,
                selected_file_ids=selected_file_ids,
            )
            self._stage_workspace_files(
                owner_id=owner_id,
                thread_id=thread_id,
                workspace_files=workspace_files,
            )
        except Exception as exc:
            assistant_message = self._message_service.create_message(
                thread_id=thread_id,
                owner_id=owner_id,
                role="assistant",
                content=str(exc),
                status="failed",
            )
            assistant_message_id = str(assistant_message["message_id"])
            yield _sse("error", {"detail": str(exc)})
            self._teardown_sandbox_session(owner_id=owner_id, thread_id=thread_id)
            return

        resolved_file_ids = [str(file["file_id"]) for file in workspace_files]
        workspace_paths = [
            f"/workspace/{file['original_filename']}" for file in workspace_files
        ]
        input_message = self._build_input_message(
            message=message, workspace_files=workspace_files
        )
        run = self._run_service.create_run(
            thread_id=thread_id,
            owner_id=owner_id,
            input_message=input_message,
            selected_file_ids=resolved_file_ids,
            workspace_files=workspace_paths,
        )
        self._run_service.mark_running(run_id=str(run["run_id"]))
        assistant_message = self._message_service.create_message(
            thread_id=thread_id,
            owner_id=owner_id,
            role="assistant",
            content="",
            status="streaming",
            run_id=str(run["run_id"]),
        )
        assistant_message_id = str(assistant_message["message_id"])

        event_count = 0
        delta_response_content = ""
        updated_response_content: str | None = None
        latest_content_source: str | None = None
        event_sequence = 0

        def next_event_id() -> str:
            nonlocal event_count
            event_count += 1
            return f"{run['run_id']}:{event_count}"

        def record_run_event(
            *,
            event_type: str,
            name: str | None = None,
            node_name: str | None = None,
            correlation_id: str | None = None,
            status: str | None = None,
            payload: dict[str, object] | None = None,
        ) -> None:
            nonlocal event_sequence
            event_sequence += 1
            self._run_event_service.create_event(
                run_id=str(run["run_id"]),
                thread_id=thread_id,
                owner_id=owner_id,
                sequence=event_sequence,
                event_type=event_type,
                name=name,
                node_name=node_name,
                correlation_id=correlation_id,
                status=status,
                payload=payload or {},
            )

        yield _sse(
            "metadata",
            {
                "run_id": run["run_id"],
                "thread_id": thread_id,
                "status": "running",
                "message_id": assistant_message_id,
                "user_message_id": user_message["message_id"],
            },
            event_id=next_event_id(),
        )
        record_run_event(
            event_type="run_started",
            correlation_id=str(run["run_id"]),
            status="running",
            payload={
                "message_id": str(assistant_message_id),
                "user_message_id": str(user_message["message_id"]),
            },
        )

        try:
            async with asyncio.timeout(self._settings.agent_run_timeout_seconds):
                async with self._runtime_service.graph() as graph:
                    async for event in self._stream_graph_events(
                        graph=graph,
                        owner_id=owner_id,
                        thread_id=thread_id,
                        message=input_message,
                        selected_file_ids=resolved_file_ids,
                        workspace_files=workspace_paths,
                    ):
                        if event["event"] == "delta":
                            delta = str(event["data"].get("delta", ""))
                            if delta:
                                delta_response_content = (
                                    f"{delta_response_content}{delta}"
                                )
                                latest_content_source = "delta"
                        elif event["event"] == "updates":
                            updated_content = self._extract_content_from_updates(
                                event["data"]
                            )
                            if updated_content is not None:
                                updated_response_content = updated_content
                                latest_content_source = "updates"
                            for update_event in self._extract_update_events(
                                event["data"]
                            ):
                                record_run_event(**update_event)

                        yield _sse(
                            event["event"],
                            event["data"],
                            event_id=next_event_id(),
                        )

                final_response_content = self._final_response_content(
                    delta_response_content=delta_response_content,
                    updated_response_content=updated_response_content,
                    latest_content_source=latest_content_source,
                )
                if not final_response_content.strip():
                    raise RuntimeError(
                        "Run ended before the agent produced a final response"
                    )
                self._import_generated_artifacts(
                    actor_user_id=actor_user_id,
                    actor_role=actor_role,
                    thread_id=thread_id,
                    workspace_files=workspace_files,
                )
                self._run_service.complete_run(
                    run_id=str(run["run_id"]),
                    output_text=final_response_content,
                    event_count=event_count,
                )
                if assistant_message_id is not None:
                    self._message_service.update_message(
                        message_id=assistant_message_id,
                        content=final_response_content,
                        status="completed",
                        run_id=str(run["run_id"]),
                    )
                record_run_event(
                    event_type="run_completed",
                    correlation_id=str(run["run_id"]),
                    status="completed",
                    payload={"message_id": str(assistant_message_id)},
                )
                yield _sse(
                    "done",
                    {
                        "run_id": run["run_id"],
                        "thread_id": thread_id,
                        "status": "completed",
                        "message_id": assistant_message_id,
                    },
                    event_id=next_event_id(),
                )
        except TimeoutError:
            detail = f"Run exceeded {self._settings.agent_run_timeout_seconds} seconds"
            final_response_content = self._final_response_content(
                delta_response_content=delta_response_content,
                updated_response_content=updated_response_content,
                latest_content_source=latest_content_source,
            )
            self._run_service.fail_run(
                run_id=str(run["run_id"]),
                error_detail=detail,
                output_text=final_response_content,
                event_count=event_count,
            )
            persisted_error = self._build_persisted_error_content(
                current_response_content=final_response_content,
                detail=detail,
            )
            if assistant_message_id is not None:
                self._message_service.update_message(
                    message_id=assistant_message_id,
                    content=persisted_error,
                    status="failed",
                    run_id=str(run["run_id"]),
                )
            record_run_event(
                event_type="run_failed",
                correlation_id=str(run["run_id"]),
                status="failed",
                payload={
                    "detail": detail,
                    "message_id": str(assistant_message_id),
                },
            )
            yield _sse(
                "error",
                {"detail": detail, "run_id": run["run_id"]},
                event_id=next_event_id(),
            )
        except Exception as exc:
            logger.exception("Run %s failed for thread %s", run["run_id"], thread_id)
            detail = self._normalize_runtime_error(exc)
            final_response_content = self._final_response_content(
                delta_response_content=delta_response_content,
                updated_response_content=updated_response_content,
                latest_content_source=latest_content_source,
            )
            self._run_service.fail_run(
                run_id=str(run["run_id"]),
                error_detail=detail,
                output_text=final_response_content,
                event_count=event_count,
            )
            persisted_error = self._build_persisted_error_content(
                current_response_content=final_response_content,
                detail=detail,
            )
            if assistant_message_id is not None:
                self._message_service.update_message(
                    message_id=assistant_message_id,
                    content=persisted_error,
                    status="failed",
                    run_id=str(run["run_id"]),
                )
            record_run_event(
                event_type="run_failed",
                correlation_id=str(run["run_id"]),
                status="failed",
                payload={
                    "detail": detail,
                    "message_id": str(assistant_message_id),
                },
            )
            yield _sse(
                "error",
                {"detail": detail, "run_id": run["run_id"]},
                event_id=next_event_id(),
            )
        finally:
            self._teardown_sandbox_session(owner_id=owner_id, thread_id=thread_id)

    async def _stream_graph_events(
        self,
        *,
        graph,
        owner_id: str,
        thread_id: str,
        message: str,
        selected_file_ids: list[str],
        workspace_files: list[str],
    ) -> AsyncIterator[dict[str, object]]:
        config = {
            "recursion_limit": self._settings.agent_max_run_steps,
            "configurable": {
                "thread_id": thread_id,
            }
        }
        context = {
            "user_id": owner_id,
            "thread_id": thread_id,
            "selected_file_ids": selected_file_ids,
            "workspace_files": workspace_files,
        }
        payload = {
            "messages": [{"role": "user", "content": message}],
            "selected_file_ids": selected_file_ids,
        }

        async for part in graph.astream(
            payload,
            config=config,
            context=context,
            stream_mode=("updates", "messages"),
            version="v2",
        ):
            if not isinstance(part, dict):
                continue
            part_type = str(part.get("type", ""))
            if part_type == "updates":
                updates = part.get("data")
                if isinstance(updates, dict) and updates:
                    yield {"event": "updates", "data": self._serialize_payload(updates)}
                continue
            if part_type != "messages":
                continue

            chunk_payload = part.get("data")
            if not isinstance(chunk_payload, tuple) or len(chunk_payload) != 2:
                continue

            message_chunk = chunk_payload[0]
            metadata = chunk_payload[1]
            node_name = metadata.get("langgraph_node", "")
            delta = self._extract_message_text(message_chunk)
            if delta:
                yield {
                    "event": "delta",
                    "data": {"delta": delta, "node_name": node_name},
                }

    def _build_input_message(
        self,
        *,
        message: str,
        workspace_files: list[dict[str, Any]],
    ) -> str:
        if not workspace_files:
            return message

        file_inventory = "\n".join(
            f"- /workspace/{file['original_filename']} (file_id: {file['file_id']})"
            for file in workspace_files
        )
        return (
            "Workspace files are mounted under /workspace in the sandbox.\n"
            "Workspace files currently available in the sandbox:\n"
            f"{file_inventory}\n\n"
            "User request:\n"
            f"{message}"
        )

    def _resolve_workspace_files(
        self,
        *,
        actor_user_id: str,
        actor_role: str,
        thread_id: str,
        selected_file_ids: list[str],
    ) -> list[dict[str, Any]]:
        if selected_file_ids:
            files = self._file_service.list_files_by_ids(
                thread_id=thread_id, file_ids=selected_file_ids
            )
            files_by_id = {str(file["file_id"]): file for file in files}
            missing_file_ids = [
                file_id for file_id in selected_file_ids if file_id not in files_by_id
            ]
            if missing_file_ids:
                missing = ", ".join(missing_file_ids)
                raise ValueError(f"Selected files not found in thread: {missing}")
            ordered_files = [files_by_id[file_id] for file_id in selected_file_ids]
        else:
            ordered_files = self._file_service.list_files(
                actor_user_id=actor_user_id,
                actor_role=actor_role,
                thread_id=thread_id,
            )

        return [
            file
            for file in ordered_files
            if file.get("purpose") == "upload" and file.get("status") == "completed"
        ]

    def _stage_workspace_files(
        self,
        *,
        owner_id: str,
        thread_id: str,
        workspace_files: list[dict[str, Any]],
    ) -> None:
        if not workspace_files:
            return

        backend = self._sandbox_backend_factory(
            executor_base_url=self._settings.executor_base_url,
            thread_id=thread_id,
            user_id=owner_id,
        )
        files_to_upload: list[tuple[str, bytes]] = []

        for file in workspace_files:
            filename, content = self._file_service.get_file_content(
                thread_id=thread_id,
                file_id=str(file["file_id"]),
            )
            files_to_upload.append((filename, content))

        upload_results = backend.upload_files(files_to_upload)
        failures = [
            result for result in upload_results if getattr(result, "error", None)
        ]
        if failures:
            failure_details = ", ".join(
                f"{result.path}: {result.error}" for result in failures
            )
            raise RuntimeError(f"Failed to stage files in sandbox: {failure_details}")

    def _teardown_sandbox_session(self, *, owner_id: str, thread_id: str) -> None:
        backend = self._sandbox_backend_factory(
            executor_base_url=self._settings.executor_base_url,
            thread_id=thread_id,
            user_id=owner_id,
        )

        try:
            deleted = backend.delete_session()
        except Exception:
            logger.exception(
                "Failed to tear down sandbox session for thread %s", thread_id
            )
            return

        if not deleted:
            logger.warning(
                "Sandbox session for thread %s could not be deleted because it is still active",
                thread_id,
            )

    @staticmethod
    def _extract_message_text(message_chunk: object) -> str:
        content = getattr(message_chunk, "text", "")
        if isinstance(content, str):
            return content

        raw_content = getattr(message_chunk, "content", "")
        if isinstance(raw_content, str):
            return raw_content
        if isinstance(raw_content, list):
            parts = [
                str(part.get("text", ""))
                for part in raw_content
                if isinstance(part, dict) and part.get("type") == "text"
            ]
            return "".join(parts)
        return ""

    @staticmethod
    def _normalize_runtime_error(exc: Exception) -> str:
        if isinstance(exc, GraphRecursionError):
            return "Run stopped after reaching the maximum step limit"
        detail = str(exc).strip()
        return detail or exc.__class__.__name__

    @classmethod
    def _extract_content_from_updates(cls, payload: object) -> str | None:
        if not isinstance(payload, dict):
            return None

        for node_name, node_data in payload.items():
            if node_name in _INTERNAL_NODES:
                continue

            messages = cls._extract_node_messages(node_data)
            for message in messages:
                if (
                    message.get("type") not in {"ai", "assistant"}
                    and message.get("role") != "assistant"
                ):
                    continue
                # Skip planning steps / tool calls
                if message.get("tool_calls"):
                    continue
                content = message.get("content")
                if isinstance(content, str) and content.strip():
                    return content
        return None

    @classmethod
    def _extract_node_messages(cls, node_data: object) -> list[dict[str, Any]]:
        if not isinstance(node_data, dict):
            return []

        messages = node_data.get("messages", node_data.get("value"))
        if isinstance(messages, list):
            return [message for message in messages if isinstance(message, dict)]
        if isinstance(messages, dict):
            nested_value = messages.get("value")
            if isinstance(nested_value, list):
                return [
                    message for message in nested_value if isinstance(message, dict)
                ]
            if isinstance(nested_value, dict):
                return [nested_value]
            return [messages]
        value = node_data.get("value")
        if isinstance(value, list):
            return [message for message in value if isinstance(message, dict)]
        return []

    @staticmethod
    def _build_persisted_error_content(
        *,
        current_response_content: str,
        detail: str,
    ) -> str:
        if current_response_content:
            return f"{current_response_content}\n\n{detail}"
        return detail

    @staticmethod
    def _final_response_content(
        *,
        delta_response_content: str,
        updated_response_content: str | None,
        latest_content_source: str | None,
    ) -> str:
        if latest_content_source == "updates" and updated_response_content is not None:
            return updated_response_content
        if latest_content_source == "delta" and delta_response_content:
            return delta_response_content
        if updated_response_content is not None:
            return updated_response_content
        return delta_response_content

    def _maybe_update_thread_title(
        self,
        *,
        owner_id: str,
        actor_role: str,
        thread_id: str,
        current_title: object,
        message: str,
    ) -> None:
        existing_messages = self._message_service.list_messages(
            owner_id=owner_id, thread_id=thread_id
        )
        if existing_messages:
            return

        normalized_title = self._derive_thread_title(message)
        current_title_text = str(current_title or "").strip()
        if current_title_text and current_title_text not in {
            "New Conversation",
            "Untitled Chat",
        }:
            return

        self._thread_service.update_thread_title(
            actor_user_id=owner_id,
            actor_role=actor_role,
            thread_id=thread_id,
            title=normalized_title,
        )

    @staticmethod
    def _derive_thread_title(message: str, max_length: int = 80) -> str:
        normalized = " ".join(message.split()).strip()
        if not normalized:
            return "New Conversation"
        if len(normalized) <= max_length:
            return normalized
        return f"{normalized[: max_length - 1].rstrip()}…"

    def _import_generated_artifacts(
        self,
        *,
        actor_user_id: str,
        actor_role: str,
        thread_id: str,
        workspace_files: list[dict[str, Any]],
    ) -> None:
        thread = self._thread_service.get_thread_for_actor(
            actor_user_id=actor_user_id,
            actor_role=actor_role,
            thread_id=thread_id,
        )
        if thread is None:
            return
        owner_id = str(thread["owner_id"])
        backend = self._sandbox_backend_factory(
            executor_base_url=self._settings.executor_base_url,
            thread_id=thread_id,
            user_id=owner_id,
        )
        existing_upload_names = {
            str(file.get("original_filename"))
            for file in workspace_files
            if file.get("original_filename")
        }

        try:
            session_files = backend.list_files()
        except Exception:
            logger.exception(
                "Failed to list sandbox session files for thread %s", thread_id
            )
            return

        artifact_paths: list[str] = []
        for file in session_files:
            relative_path = str(file.get("path") or "").strip()
            if not relative_path:
                continue
            if relative_path in existing_upload_names:
                continue
            if (
                basename(relative_path) in existing_upload_names
                and "/" not in relative_path
            ):
                continue
            artifact_paths.append(relative_path)

        if not artifact_paths:
            return

        downloads = backend.download_files(artifact_paths)
        for download in downloads:
            if getattr(download, "error", None):
                logger.warning(
                    "Skipping artifact import for %s on thread %s: %s",
                    download.path,
                    thread_id,
                    download.error,
                )
                continue
            if download.content is None:
                continue

            content_type = self._content_type_for_path(download.path)
            try:
                self._file_service.import_artifact(
                    actor_user_id=actor_user_id,
                    actor_role=actor_role,
                    thread_id=thread_id,
                    relative_path=download.path,
                    content=download.content,
                    content_type=content_type,
                )
            except Exception:
                logger.exception(
                    "Failed to import generated artifact %s for thread %s",
                    download.path,
                    thread_id,
                )

    @staticmethod
    def _content_type_for_path(path: str) -> str | None:
        normalized = path.lower()
        if normalized.endswith(".png"):
            return "image/png"
        if normalized.endswith(".jpg") or normalized.endswith(".jpeg"):
            return "image/jpeg"
        if normalized.endswith(".svg"):
            return "image/svg+xml"
        if normalized.endswith(".html"):
            return "text/html; charset=utf-8"
        if normalized.endswith(".csv"):
            return "text/csv; charset=utf-8"
        if normalized.endswith(".json"):
            return "application/json"
        if (
            normalized.endswith(".txt")
            or normalized.endswith(".log")
            or normalized.endswith(".py")
        ):
            return "text/plain; charset=utf-8"
        return None

    @classmethod
    def _extract_update_events(cls, payload: object) -> list[dict[str, object]]:
        if not isinstance(payload, dict):
            return []

        events: list[dict[str, object]] = []
        for node_name, node_data in payload.items():
            normalized_node_name = str(node_name)
            if normalized_node_name in _INTERNAL_NODES:
                continue
            if not isinstance(node_data, dict):
                continue

            for message in cls._extract_node_messages(node_data):
                message_role = str(message.get("role") or message.get("type") or "")
                if message_role in {"assistant", "ai"}:
                    content = message.get("content")
                    if isinstance(content, str) and content.strip():
                        events.append(
                            {
                                "event_type": "assistant_snapshot",
                                "node_name": normalized_node_name,
                                "correlation_id": str(
                                    message.get("id")
                                    or f"{normalized_node_name}-assistant"
                                ),
                                "status": "done",
                                "payload": {"content": content},
                            }
                        )
                    tool_calls = message.get("tool_calls")
                    if isinstance(tool_calls, list):
                        for tool_call in tool_calls:
                            if not isinstance(tool_call, dict):
                                continue
                            tool_name = tool_call.get("name")
                            events.append(
                                {
                                    "event_type": "tool_call",
                                    "name": str(tool_name) if tool_name else None,
                                    "node_name": normalized_node_name,
                                    "correlation_id": str(
                                        tool_call.get("id")
                                        or f"{normalized_node_name}-{tool_name or 'tool'}"
                                    ),
                                    "status": "live",
                                    "payload": {
                                        "args": cls._serialize_payload(
                                            tool_call.get("args")
                                        )
                                    },
                                }
                            )

                if message_role == "tool":
                    tool_status = str(message.get("status") or "success")
                    tool_name = message.get("name")
                    tool_content = message.get("content")
                    serialized_content = cls._serialize_payload(tool_content)
                    if not isinstance(serialized_content, str):
                        serialized_content = json.dumps(serialized_content)
                    events.append(
                        {
                            "event_type": "tool_result",
                            "name": str(tool_name) if tool_name else None,
                            "node_name": normalized_node_name,
                            "correlation_id": str(
                                message.get("tool_call_id")
                                or message.get("id")
                                or f"{normalized_node_name}-{tool_name or 'tool'}"
                            ),
                            "status": "done" if tool_status == "success" else "error",
                            "payload": {
                                "content": serialized_content,
                                "tool_status": tool_status,
                            },
                        }
                    )

        return events

    @classmethod
    def _serialize_payload(cls, value: Any) -> Any:
        if value is None or isinstance(value, (str, int, float, bool)):
            return value
        if isinstance(value, dict):
            return {
                str(key): cls._serialize_payload(item) for key, item in value.items()
            }
        if isinstance(value, (list, tuple)):
            return [cls._serialize_payload(item) for item in value]

        model_dump = getattr(value, "model_dump", None)
        if callable(model_dump):
            return cls._serialize_payload(model_dump(mode="json"))

        legacy_dict = getattr(value, "dict", None)
        if callable(legacy_dict):
            return cls._serialize_payload(legacy_dict())

        return str(value)
