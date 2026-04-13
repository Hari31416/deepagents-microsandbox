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
    ) -> None:
        self._thread_service = thread_service
        self._file_service = file_service
        self._settings = settings
        self._transport = transport

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

        # Stage files in the sandbox before starting the run
        if selected_file_ids:
            try:
                backend = MicrosandboxBackend(
                    executor_base_url=self._settings.executor_base_url,
                    thread_id=thread_id,
                    user_id=owner_id,
                )
                files_to_upload = []
                for file_id in selected_file_ids:
                    filename, content = self._file_service.get_file_content(thread_id=thread_id, file_id=file_id)
                    files_to_upload.append((filename, content))
                
                if files_to_upload:
                    # upload_files is synchronous in MicrosandboxBackend
                    backend.upload_files(files_to_upload)
            except Exception as e:
                yield _sse("error", {"detail": f"Failed to stage files in sandbox: {str(e)}"})
                return

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
                    selected_file_ids=selected_file_ids,
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
    ) -> dict[str, Any]:
        # Fetch filenames for the selected IDs to provide context to the agent
        files = self._file_service.list_files_by_ids(thread_id=thread_id, file_ids=selected_file_ids)
        file_inventory = ", ".join([f"{f['original_filename']} (ID: {f['file_id']})" for f in files])
        
        # Prepend the file inventory to the user's message for maximum visibility
        enriched_message = f"[Workspace Context: The following files are available in your sandbox: {file_inventory}]\n\n{message}"

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
            },
            "stream_mode": self._settings.langgraph_stream_mode,
        }

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
