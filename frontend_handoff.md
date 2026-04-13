# Frontend Handoff

This document describes the backend contract that the frontend should integrate with today.

It is intentionally focused on API usage and client flow. It does not prescribe UI structure or component design.

## Backend Summary

The product-facing backend is the FastAPI app under [backend/app/api](/Users/hari/Desktop/sandbox/deepagent-sandbox-poc/backend/app/api).

Current responsibilities:

- thread creation and lookup
- file upload/download presign endpoints
- file metadata registration
- chat streaming proxy to LangGraph deployment
- ownership checks per thread

The frontend should talk only to this backend. It should not call MinIO or LangGraph deployment directly.

## Base URLs

- Backend root: `/`
- API prefix: `/api`
- OpenAPI docs: `/docs`
- Health: `/api/health`

Example local backend URLs:

- `http://localhost:8000/api/threads`
- `http://localhost:8000/api/chat/stream`

## Auth Contract

Current auth is a backend stub in [backend/app/api/auth.py](/Users/hari/Desktop/sandbox/deepagent-sandbox-poc/backend/app/api/auth.py).

For now:

- the backend reads `X-User-Id`
- if the header is missing, it falls back to a default dev user

Frontend implication:

- in development, send `X-User-Id` with all API calls
- in production, this will likely be replaced by session or token auth, but the thread ownership model should remain the same

Example:

```http
X-User-Id: user-123
```

## Endpoint Reference

### `GET /api/health`

Use for startup and readiness checks.

Example response:

```json
{
  "ok": true,
  "service": "deepagent-sandbox-backend",
  "environment": "development"
}
```

### `POST /api/threads`

Creates a new thread owned by the current user.

Request:

```json
{
  "title": "Revenue analysis"
}
```

Response:

```json
{
  "thread_id": "4fa23b73-0d77-4b0f-a6d4-74f05c3f4f22",
  "owner_id": "user-123",
  "title": "Revenue analysis",
  "created_at": "2026-04-13T10:20:30.123456+00:00"
}
```

Notes:

- `title` is optional
- create this before upload or chat

### `GET /api/threads`

Lists threads for the current user.

Response:

```json
{
  "threads": [
    {
      "thread_id": "4fa23b73-0d77-4b0f-a6d4-74f05c3f4f22",
      "owner_id": "user-123",
      "title": "Revenue analysis",
      "created_at": "2026-04-13T10:20:30.123456+00:00"
    }
  ]
}
```

### `GET /api/threads/{thread_id}`

Fetches one thread if the current user owns it.

Success response:

```json
{
  "thread_id": "4fa23b73-0d77-4b0f-a6d4-74f05c3f4f22",
  "owner_id": "user-123",
  "title": "Revenue analysis",
  "created_at": "2026-04-13T10:20:30.123456+00:00"
}
```

Not found response:

```json
{
  "detail": "Thread not found"
}
```

### `GET /api/threads/{thread_id}/files`

Lists registered files for the thread.

Response:

```json
{
  "files": [
    {
      "file_id": "0fc3b3fd-f853-47e0-b612-c80ea2400fef",
      "thread_id": "4fa23b73-0d77-4b0f-a6d4-74f05c3f4f22",
      "object_key": "threads/4fa23b73-0d77-4b0f-a6d4-74f05c3f4f22/uploads/0fc3b3fd-f853-47e0-b612-c80ea2400fef/data.csv",
      "original_filename": "data.csv",
      "content_type": "text/csv",
      "size": 48231,
      "purpose": "upload",
      "status": "uploaded",
      "created_at": "2026-04-13T10:22:11.000000+00:00"
    }
  ]
}
```

Notes:

- both uploads and artifacts are expected to appear here
- use `purpose` to distinguish them

### `POST /api/files/presign-upload`

Returns a presigned MinIO upload target for one file.

Request:

```json
{
  "thread_id": "4fa23b73-0d77-4b0f-a6d4-74f05c3f4f22",
  "filename": "data.csv",
  "content_type": "text/csv",
  "size": 48231,
  "purpose": "upload"
}
```

Response:

```json
{
  "file_id": "0fc3b3fd-f853-47e0-b612-c80ea2400fef",
  "thread_id": "4fa23b73-0d77-4b0f-a6d4-74f05c3f4f22",
  "object_key": "threads/4fa23b73-0d77-4b0f-a6d4-74f05c3f4f22/uploads/0fc3b3fd-f853-47e0-b612-c80ea2400fef/data.csv",
  "url": "http://minio-presigned-put-url",
  "required_headers": {},
  "expires_at": "2026-04-13T10:37:11.000000+00:00",
  "content_type": "text/csv",
  "size": 48231
}
```

Notes:

- the frontend uploads the raw file bytes directly to `url`
- `required_headers` is present for future compatibility, even if empty today
- this does not register the file yet; `complete-upload` is required after the PUT succeeds

### `POST /api/files/complete-upload`

Registers an uploaded file in Postgres after the direct MinIO upload finishes.

Request:

```json
{
  "thread_id": "4fa23b73-0d77-4b0f-a6d4-74f05c3f4f22",
  "object_key": "threads/4fa23b73-0d77-4b0f-a6d4-74f05c3f4f22/uploads/0fc3b3fd-f853-47e0-b612-c80ea2400fef/data.csv",
  "original_filename": "data.csv",
  "content_type": "text/csv",
  "size": 48231,
  "purpose": "upload"
}
```

Response:

```json
{
  "file_id": "0fc3b3fd-f853-47e0-b612-c80ea2400fef",
  "thread_id": "4fa23b73-0d77-4b0f-a6d4-74f05c3f4f22",
  "object_key": "threads/4fa23b73-0d77-4b0f-a6d4-74f05c3f4f22/uploads/0fc3b3fd-f853-47e0-b612-c80ea2400fef/data.csv",
  "original_filename": "data.csv",
  "content_type": "text/csv",
  "size": 48231,
  "purpose": "upload",
  "status": "uploaded",
  "created_at": "2026-04-13T10:22:11.000000+00:00"
}
```

### `POST /api/files/presign-download`

Returns a presigned MinIO download target.

Request using `file_id`:

```json
{
  "thread_id": "4fa23b73-0d77-4b0f-a6d4-74f05c3f4f22",
  "file_id": "0fc3b3fd-f853-47e0-b612-c80ea2400fef"
}
```

Request using `object_key`:

```json
{
  "thread_id": "4fa23b73-0d77-4b0f-a6d4-74f05c3f4f22",
  "object_key": "threads/4fa23b73-0d77-4b0f-a6d4-74f05c3f4f22/artifacts/a1/chart.png"
}
```

Response:

```json
{
  "thread_id": "4fa23b73-0d77-4b0f-a6d4-74f05c3f4f22",
  "object_key": "threads/4fa23b73-0d77-4b0f-a6d4-74f05c3f4f22/uploads/0fc3b3fd-f853-47e0-b612-c80ea2400fef/data.csv",
  "url": "http://minio-presigned-get-url",
  "required_headers": {},
  "expires_at": "2026-04-13T10:40:00.000000+00:00"
}
```

Notes:

- prefer `file_id` for files already registered by the backend
- `object_key` is useful when the UI has the object key but not a file row yet

### `POST /api/chat/stream`

Starts a streaming agent run for a thread.

Request:

```json
{
  "thread_id": "4fa23b73-0d77-4b0f-a6d4-74f05c3f4f22",
  "message": "Create a bar chart of revenue by month",
  "selected_file_ids": ["0fc3b3fd-f853-47e0-b612-c80ea2400fef"]
}
```

Response:

- content type: `text/event-stream`
- body: proxied SSE from LangGraph deployment

Important behavior:

- backend verifies the thread belongs to the user
- backend ensures the matching LangGraph thread exists
- backend forwards runtime headers:
  - `X-User-Id`
  - `X-Thread-Id`
- backend forwards run context:
  - `user_id`
  - `thread_id`
  - `selected_file_ids`

Backend-generated error example:

```text
event: error
data: {"detail":"Thread not found"}
```

LangGraph stream example from tests:

```text
event: message
data: {"delta":"hello"}

event: done
data: {"thread_id":"thread-1"}
```

Frontend guidance:

- treat this as a generic SSE stream
- do not hardcode only one event type
- parse `event:` and `data:` frames
- handle `error` events from the backend explicitly

## Required Client Flows

### 1. Create a new thread

1. `POST /api/threads`
2. store the returned `thread_id`
3. use that `thread_id` for uploads and chat

### 2. Upload one file

1. `POST /api/files/presign-upload`
2. upload the file bytes directly to the returned presigned `url`
3. `POST /api/files/complete-upload`
4. refresh `GET /api/threads/{thread_id}/files`

This is required. Do not skip `complete-upload`.

### 3. Start a streamed run

1. collect the user message
2. collect selected file ids from the thread file list
3. `POST /api/chat/stream`
4. consume the SSE stream incrementally
5. when the run finishes, refresh `GET /api/threads/{thread_id}/files`

### 4. Open a file or artifact

1. call `POST /api/files/presign-download`
2. use the returned `url`
3. render or download based on content type

## Suggested Frontend Data Model

The frontend can stay simple if it models only these objects:

- `Thread`
  - `thread_id`
  - `title`
  - `created_at`
- `ThreadFile`
  - `file_id`
  - `thread_id`
  - `object_key`
  - `original_filename`
  - `content_type`
  - `size`
  - `purpose`
  - `status`
  - `created_at`
- `ChatInput`
  - `thread_id`
  - `message`
  - `selected_file_ids`
- `SseEvent`
  - `event`
  - `data`

## Example Integration Snippets

### Create thread

```ts
async function createThread(title: string) {
  const res = await fetch("/api/threads", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-User-Id": "user-123",
    },
    body: JSON.stringify({ title }),
  });

  if (!res.ok) throw new Error("Failed to create thread");
  return res.json();
}
```

### Upload file

```ts
async function uploadFile(threadId: string, file: File) {
  const presignRes = await fetch("/api/files/presign-upload", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-User-Id": "user-123",
    },
    body: JSON.stringify({
      thread_id: threadId,
      filename: file.name,
      content_type: file.type || "application/octet-stream",
      size: file.size,
      purpose: "upload",
    }),
  });

  if (!presignRes.ok) throw new Error("Failed to presign upload");
  const ticket = await presignRes.json();

  const putRes = await fetch(ticket.url, {
    method: "PUT",
    headers: ticket.required_headers,
    body: file,
  });

  if (!putRes.ok) throw new Error("Failed to upload file bytes");

  const completeRes = await fetch("/api/files/complete-upload", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-User-Id": "user-123",
    },
    body: JSON.stringify({
      thread_id: threadId,
      object_key: ticket.object_key,
      original_filename: file.name,
      content_type: file.type || "application/octet-stream",
      size: file.size,
      purpose: "upload",
    }),
  });

  if (!completeRes.ok) throw new Error("Failed to register uploaded file");
  return completeRes.json();
}
```

### Stream chat

`fetch()` can read SSE as a byte stream.

```ts
async function streamChat(
  threadId: string,
  message: string,
  selectedFileIds: string[],
) {
  const res = await fetch("/api/chat/stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-User-Id": "user-123",
    },
    body: JSON.stringify({
      thread_id: threadId,
      message,
      selected_file_ids: selectedFileIds,
    }),
  });

  if (!res.ok || !res.body) throw new Error("Failed to start stream");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    console.log(chunk);
  }
}
```

A production client should parse SSE frames instead of treating each chunk as a complete event.

## Error Handling

Current backend errors are straightforward JSON responses:

```json
{
  "detail": "Thread not found"
}
```

For streaming:

- standard HTTP failure may happen before the stream starts
- once the stream starts, backend errors are emitted as SSE `error` events

Frontend should handle both.

## Current Gaps

These are important for frontend planning:

- there is no dedicated runs endpoint yet
- there is no message history endpoint yet
- there is no delete thread or delete file endpoint
- there is no artifact-specific preview endpoint
- the chat stream is proxied from LangGraph, so exact event types depend on the deployment stream contract
- auth is still a stub based on `X-User-Id`

Frontend implication:

- keep chat state client-side for now if you need immediate transcript rendering
- refresh file lists after upload completion and after stream completion
- do not assume artifact metadata will arrive via a separate API yet

## Recommended First Frontend Integration Order

1. wire a reusable API client that always sends `X-User-Id`
2. implement thread create/list/get
3. implement upload with presign -> PUT -> complete-upload
4. implement thread file listing
5. implement SSE chat streaming
6. implement presigned download for file/artifact preview

## Source Files

If the frontend team needs to verify behavior, use these files as the source of truth:

- [backend/app/api/routes/threads.py](/Users/hari/Desktop/sandbox/deepagent-sandbox-poc/backend/app/api/routes/threads.py)
- [backend/app/api/routes/files.py](/Users/hari/Desktop/sandbox/deepagent-sandbox-poc/backend/app/api/routes/files.py)
- [backend/app/api/routes/chat.py](/Users/hari/Desktop/sandbox/deepagent-sandbox-poc/backend/app/api/routes/chat.py)
- [backend/app/services/stream_service.py](/Users/hari/Desktop/sandbox/deepagent-sandbox-poc/backend/app/services/stream_service.py)
- [backend/app/api/auth.py](/Users/hari/Desktop/sandbox/deepagent-sandbox-poc/backend/app/api/auth.py)
