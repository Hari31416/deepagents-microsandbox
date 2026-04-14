from __future__ import annotations

from dataclasses import dataclass
import re
from typing import TYPE_CHECKING

import httpx
from app.db.repositories import SandboxSessionRepository

try:
    from deepagents.backends.protocol import ExecuteResponse, FileDownloadResponse, FileUploadResponse
    from deepagents.backends.sandbox import BaseSandbox
except ImportError:  # pragma: no cover - exercised only when deepagents is not installed
    @dataclass
    class ExecuteResponse:
        output: str
        exit_code: int | None = None
        truncated: bool = False

    @dataclass
    class FileDownloadResponse:
        path: str
        content: bytes | None = None
        error: str | None = None

    @dataclass
    class FileUploadResponse:
        path: str
        error: str | None = None

    class BaseSandbox:  # type: ignore[override]
        pass


if TYPE_CHECKING:
    from collections.abc import Iterable


_UNSAFE_PATH_PATTERN = re.compile(r"(^\.\.?/)|(/\.\.?/)|(^\.\.$)|/\.\.$")


def build_executor_session_id(thread_id: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9._-]", "-", thread_id).strip("-")
    return f"sess_thread_{normalized or 'default'}"


def normalize_workspace_path(path: str) -> str:
    candidate = path.strip()
    if not candidate:
        raise ValueError("Path may not be empty")
    candidate = candidate.lstrip("/")
    if _UNSAFE_PATH_PATTERN.search(candidate):
        raise ValueError(f"Path escapes workspace: {path}")
    if candidate in {".", ".."}:
        raise ValueError(f"Path escapes workspace: {path}")
    return candidate


class MicrosandboxBackend(BaseSandbox):
    """DeepAgents-compatible sandbox backend backed by microsandbox-executor."""

    def __init__(
        self,
        executor_base_url: str,
        thread_id: str,
        user_id: str | None = None,
        session_repository: SandboxSessionRepository | None = None,
        timeout_seconds: int = 300,
    ) -> None:
        self.executor_base_url = executor_base_url.rstrip("/")
        self.thread_id = thread_id
        self.user_id = user_id
        resolved_session_id = build_executor_session_id(thread_id)
        if session_repository is not None:
            mapping = session_repository.get_or_create(
                thread_id=thread_id,
                sandbox_session_id=resolved_session_id,
                executor_base_url=self.executor_base_url,
            )
            resolved_session_id = mapping.sandbox_session_id
        self._session_id = resolved_session_id
        self._client = httpx.Client(
            base_url=self.executor_base_url,
            timeout=timeout_seconds,
            headers=self._build_headers(user_id=user_id),
        )

    @property
    def id(self) -> str:
        return self._session_id

    def execute(
        self,
        command: str,
        *,
        timeout: int | None = None,
    ) -> ExecuteResponse:
        self._ensure_session()
        payload = {
            "session_id": self._session_id,
            "script": command,
            "entrypoint": "agent_command.sh",
        }
        if timeout is not None:
            payload["timeout_seconds"] = timeout

        response = self._client.post("/v1/execute/bash", json=payload)
        response.raise_for_status()
        data = response.json()
        stdout = data.get("stdout", "")
        stderr = data.get("stderr", "")
        output = stdout
        if stderr:
            output = f"{stdout.rstrip()}\n{stderr}".strip() if stdout else stderr

        return ExecuteResponse(
            output=output,
            exit_code=data.get("exit_code"),
            truncated=False,
        )

    def upload_files(self, files: list[tuple[str, bytes]]) -> list[FileUploadResponse]:
        self._ensure_session()
        multipart_files = []

        for path, content in files:
            relative_path = normalize_workspace_path(path)
            multipart_files.append(
                ("files", (relative_path, content, "application/octet-stream"))
            )

        response = self._client.post(f"/v1/sessions/{self._session_id}/files", files=multipart_files)
        if response.is_success:
            return [FileUploadResponse(path=path) for path, _ in files]

        error = self._extract_error(response)
        return [FileUploadResponse(path=path, error=error) for path, _ in files]

    def download_files(self, paths: list[str]) -> list[FileDownloadResponse]:
        self._ensure_session()
        downloads: list[FileDownloadResponse] = []

        for path in paths:
            relative_path = normalize_workspace_path(path)
            response = self._client.get(f"/v1/sessions/{self._session_id}/files/{relative_path}")

            if response.is_success:
                downloads.append(FileDownloadResponse(path=path, content=response.content))
                continue

            downloads.append(
                FileDownloadResponse(path=path, content=None, error=self._normalize_download_error(response))
            )

        return downloads

    def list_files(self) -> list[dict[str, object]]:
        self._ensure_session()
        response = self._client.get(f"/v1/sessions/{self._session_id}/files")
        response.raise_for_status()
        payload = response.json()
        files = payload.get("files", [])
        return [file for file in files if isinstance(file, dict)]

    def _ensure_session(self) -> None:
        response = self._client.post("/v1/sessions", json={"session_id": self._session_id})
        if response.status_code not in {201, 409}:
            response.raise_for_status()

    @staticmethod
    def _normalize_download_error(response: httpx.Response) -> str:
        if response.status_code == 404:
            return "file_not_found"
        if response.status_code == 403:
            return "permission_denied"
        return MicrosandboxBackend._extract_error(response)

    @staticmethod
    def _extract_error(response: httpx.Response) -> str:
        try:
            payload = response.json()
        except ValueError:
            return response.text or f"HTTP {response.status_code}"
        return str(payload.get("error") or payload.get("detail") or f"HTTP {response.status_code}")

    @staticmethod
    def _build_headers(user_id: str | None) -> dict[str, str]:
        if not user_id:
            return {}
        return {"X-User-Id": user_id}
