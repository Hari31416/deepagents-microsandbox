from __future__ import annotations

import asyncio
import json
import logging
from typing import TYPE_CHECKING, Any

from app.agent.backend import MicrosandboxBackend
from app.config import Settings
from app.services.file_service import FileService
from app.services.message_service import MessageService
from app.services.run_event_service import RunEventService
from app.services.run_service import RunService
from app.services.runtime_service import RuntimeService
from app.services.thread_service import ThreadService

if TYPE_CHECKING:
    from collections.abc import AsyncIterator


logger = logging.getLogger(__name__)


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
        owner_id: str,
        thread_id: str,
        message: str,
        selected_file_ids: list[str],
    ) -> AsyncIterator[str]:
        if self._thread_service.get_thread_for_owner(owner_id=owner_id, thread_id=thread_id) is None:
            yield _sse("error", {"detail": "Thread not found"})
            return

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
                owner_id=owner_id,
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
            return

        resolved_file_ids = [str(file["file_id"]) for file in workspace_files]
        workspace_paths = [f"/workspace/{file['original_filename']}" for file in workspace_files]
        input_message = self._build_input_message(message=message, workspace_files=workspace_files)
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
                                delta_response_content = f"{delta_response_content}{delta}"
                                latest_content_source = "delta"
                        elif event["event"] == "updates":
                            updated_content = self._extract_content_from_updates(event["data"])
                            if updated_content is not None:
                                updated_response_content = updated_content
                                latest_content_source = "updates"
                            for update_event in self._extract_update_events(event["data"]):
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
            yield _sse("error", {"detail": detail, "run_id": run["run_id"]}, event_id=next_event_id())
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
            yield _sse("error", {"detail": detail, "run_id": run["run_id"]}, event_id=next_event_id())

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
            delta = self._extract_message_text(message_chunk)
            if delta:
                yield {"event": "delta", "data": {"delta": delta}}

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
        owner_id: str,
        thread_id: str,
        selected_file_ids: list[str],
    ) -> list[dict[str, Any]]:
        if selected_file_ids:
            files = self._file_service.list_files_by_ids(thread_id=thread_id, file_ids=selected_file_ids)
            files_by_id = {str(file["file_id"]): file for file in files}
            missing_file_ids = [file_id for file_id in selected_file_ids if file_id not in files_by_id]
            if missing_file_ids:
                missing = ", ".join(missing_file_ids)
                raise ValueError(f"Selected files not found in thread: {missing}")
            ordered_files = [files_by_id[file_id] for file_id in selected_file_ids]
        else:
            ordered_files = self._file_service.list_files(owner_id=owner_id, thread_id=thread_id)

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
        failures = [result for result in upload_results if getattr(result, "error", None)]
        if failures:
            failure_details = ", ".join(
                f"{result.path}: {result.error}" for result in failures
            )
            raise RuntimeError(f"Failed to stage files in sandbox: {failure_details}")

    @staticmethod
    def _extract_message_text(message_chunk: object) -> str:
        content = getattr(message_chunk, "text", "")
        if callable(content):
            content = content()
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
        detail = str(exc).strip()
        return detail or exc.__class__.__name__

    @classmethod
    def _extract_content_from_updates(cls, payload: object) -> str | None:
        if not isinstance(payload, dict):
            return None

        for node_data in payload.values():
            messages = cls._extract_node_messages(node_data)
            for message in messages:
                if message.get("type") not in {"ai", "assistant"} and message.get("role") != "assistant":
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
                return [message for message in nested_value if isinstance(message, dict)]
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

    @classmethod
    def _extract_update_events(cls, payload: object) -> list[dict[str, object]]:
        if not isinstance(payload, dict):
            return []

        events: list[dict[str, object]] = []
        for node_name, node_data in payload.items():
            normalized_node_name = str(node_name)
            if node_data is None:
                events.append(
                    {
                        "event_type": "node_completed",
                        "node_name": normalized_node_name,
                        "correlation_id": f"{normalized_node_name}-idle",
                        "status": "done",
                        "payload": {},
                    }
                )
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
                                "correlation_id": str(message.get("id") or f"{normalized_node_name}-assistant"),
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
                                        tool_call.get("id") or f"{normalized_node_name}-{tool_name or 'tool'}"
                                    ),
                                    "status": "live",
                                    "payload": {"args": cls._serialize_payload(tool_call.get("args"))},
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
                                message.get("tool_call_id") or message.get("id") or f"{normalized_node_name}-{tool_name or 'tool'}"
                            ),
                            "status": "done" if tool_status == "success" else "error",
                            "payload": {"content": serialized_content, "tool_status": tool_status},
                        }
                    )

        return events

    @classmethod
    def _serialize_payload(cls, value: Any) -> Any:
        if value is None or isinstance(value, (str, int, float, bool)):
            return value
        if isinstance(value, dict):
            return {str(key): cls._serialize_payload(item) for key, item in value.items()}
        if isinstance(value, (list, tuple)):
            return [cls._serialize_payload(item) for item in value]

        model_dump = getattr(value, "model_dump", None)
        if callable(model_dump):
            return cls._serialize_payload(model_dump(mode="json"))

        legacy_dict = getattr(value, "dict", None)
        if callable(legacy_dict):
            return cls._serialize_payload(legacy_dict())

        return str(value)
