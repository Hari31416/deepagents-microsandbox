from __future__ import annotations

import json
from typing import Any

import httpx

from app.config import Settings
from app.agent.backend import MicrosandboxBackend
from app.services.file_service import FileService
from app.services.thread_service import ThreadService


def _sse(event: str, data: dict[str, object]) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


class StreamService:
    def __init__(
        self,
        thread_service: ThreadService,
        file_service: FileService,
        settings: Settings,
        transport: httpx.AsyncBaseTransport | None = None,
        sandbox_backend_factory=MicrosandboxBackend,
    ) -> None:
        self._thread_service = thread_service
        self._file_service = file_service
        self._settings = settings
        self._transport = transport
        self._sandbox_backend_factory = sandbox_backend_factory

    async def stream_chat(
        self,
        owner_id: str,
        thread_id: str,
        message: str,
        selected_file_ids: list[str],
    ):
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

        async with httpx.AsyncClient(
            base_url=self._settings.langgraph_base_url.rstrip("/"),
            timeout=None,
            transport=self._transport,
            headers=self._request_headers(owner_id=owner_id, thread_id=thread_id),
        ) as client:
            thread_error = await self._ensure_langgraph_thread(
                client=client,
                owner_id=owner_id,
                thread_id=thread_id,
            )
            if thread_error is not None:
                yield _sse("error", {"detail": thread_error})
                return

            async with client.stream(
                "POST",
                f"/threads/{thread_id}/runs/stream",
                json=self._build_run_payload(
                    owner_id=owner_id,
                    thread_id=thread_id,
                    message=message,
                    selected_file_ids=resolved_file_ids,
                    workspace_files=workspace_files,
                ),
            ) as response:
                if not response.is_success:
                    yield _sse("error", {"detail": await self._response_error(response)})
                    return

                async for chunk in response.aiter_bytes():
                    if chunk:
                        yield chunk

    async def _ensure_langgraph_thread(
        self,
        *,
        client: httpx.AsyncClient,
        owner_id: str,
        thread_id: str,
    ) -> str | None:
        response = await client.post(
            "/threads",
            json={
                "thread_id": thread_id,
                "metadata": {"owner_id": owner_id},
            },
        )
        if response.status_code in {200, 201, 409}:
            return None
        return await self._response_error(response)

    def _build_run_payload(
        self,
        *,
        owner_id: str,
        thread_id: str,
        message: str,
        selected_file_ids: list[str],
        workspace_files: list[dict[str, Any]],
    ) -> dict[str, Any]:
        enriched_message = message
        if workspace_files:
            file_inventory = "\n".join(
                f"- /workspace/{file['original_filename']} (file_id: {file['file_id']})"
                for file in workspace_files
            )
            enriched_message = (
                "Workspace files are mounted under /workspace in the sandbox.\n"
                "Workspace files currently available in the sandbox:\n"
                f"{file_inventory}\n\n"
                "User request:\n"
                f"{message}"
            )

        return {
            "assistant_id": self._settings.langgraph_assistant_id,
            "input": {
                "messages": [{"role": "user", "content": enriched_message}],
                "selected_file_ids": selected_file_ids,
            },
            "context": {
                "user_id": owner_id,
                "thread_id": thread_id,
                "selected_file_ids": selected_file_ids,
                "workspace_files": [f"/workspace/{file['original_filename']}" for file in workspace_files],
            },
            "stream_mode": self._settings.langgraph_stream_mode,
        }

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
    def _request_headers(*, owner_id: str, thread_id: str) -> dict[str, str]:
        return {
            "X-User-Id": owner_id,
            "X-Thread-Id": thread_id,
            "Accept": "text/event-stream",
        }

    @staticmethod
    async def _response_error(response: httpx.Response) -> str:
        try:
            payload = await response.aread()
        except httpx.HTTPError:
            return f"LangGraph request failed with HTTP {response.status_code}"

        if not payload:
            return f"LangGraph request failed with HTTP {response.status_code}"

        try:
            decoded = json.loads(payload)
        except json.JSONDecodeError:
            return payload.decode("utf-8", errors="replace")
        return str(decoded.get("detail") or decoded.get("error") or f"HTTP {response.status_code}")
