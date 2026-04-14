from __future__ import annotations

import asyncio
import json
import logging
from typing import TYPE_CHECKING, Any

from app.agent.backend import MicrosandboxBackend
from app.config import Settings
from app.services.file_service import FileService
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
        run_service: RunService,
        runtime_service: RuntimeService,
        settings: Settings,
        sandbox_backend_factory=MicrosandboxBackend,
    ) -> None:
        self._thread_service = thread_service
        self._file_service = file_service
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

        event_count = 0
        content_parts: list[str] = []

        def next_event_id() -> str:
            nonlocal event_count
            event_count += 1
            return f"{run['run_id']}:{event_count}"

        yield _sse(
            "metadata",
            {
                "run_id": run["run_id"],
                "thread_id": thread_id,
                "status": "running",
            },
            event_id=next_event_id(),
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
                                content_parts.append(delta)

                        yield _sse(
                            event["event"],
                            event["data"],
                            event_id=next_event_id(),
                        )

                self._run_service.complete_run(
                    run_id=str(run["run_id"]),
                    output_text="".join(content_parts),
                    event_count=event_count,
                )
                yield _sse(
                    "done",
                    {
                        "run_id": run["run_id"],
                        "thread_id": thread_id,
                        "status": "completed",
                    },
                    event_id=next_event_id(),
                )
        except TimeoutError:
            detail = f"Run exceeded {self._settings.agent_run_timeout_seconds} seconds"
            self._run_service.fail_run(
                run_id=str(run["run_id"]),
                error_detail=detail,
                output_text="".join(content_parts),
                event_count=event_count,
            )
            yield _sse("error", {"detail": detail, "run_id": run["run_id"]}, event_id=next_event_id())
        except Exception as exc:
            logger.exception("Run %s failed for thread %s", run["run_id"], thread_id)
            detail = self._normalize_runtime_error(exc)
            self._run_service.fail_run(
                run_id=str(run["run_id"]),
                error_detail=detail,
                output_text="".join(content_parts),
                event_count=event_count,
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
