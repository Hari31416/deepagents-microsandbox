# API Reference

All API endpoints are prefixed with `/api` (configurable via `API_PREFIX`).

## Authentication
All endpoints (except `/health`) require `X-User-Id` header.

---

## Threads

### `GET /threads`
List all threads for the current user.

### `POST /threads`
Create a new thread.
- **Body**: `{ "title": "optional title" }`

### `GET /threads/{id}`
Get thread metadata.

### `PATCH /threads/{id}`
Update thread metadata.
- **Body**: `{ "title": "optional title" }`

### `DELETE /threads/{id}`
Delete a thread and its related messages, runs, events, file metadata, sandbox mapping metadata, and stored thread objects.

### `GET /threads/{id}/messages`
Retrieve message history.

### `GET /threads/{id}/events`
Retrieve run events.
- **Query Params**: `run_id` (optional).

### `GET /threads/{id}/files`
List all files for the thread.

---

## Files

### `POST /files/presign-upload`
Generate a presigned URL for MinIO upload.
- **Body**:
    ```json
    {
      "thread_id": "uuid",
      "filename": "data.csv",
      "content_type": "text/csv",
      "size": 1024,
      "purpose": "upload"
    }
    ```

### `POST /files/complete-upload`
Register a file after successful binary upload.
- **Body**: Metadata returned from presign + `object_key`.

### `POST /files/presign-download`
Generate a URL for file download.
- **Body**: `{ "thread_id": "uuid", "file_id": "uuid" }` or `{ "object_key": "key" }`.

---

## Chat

### `POST /chat/stream`
Start a streaming agent run.
- **Body**:
    ```json
    {
      "thread_id": "uuid",
      "message": "analyze this data",
      "selected_file_ids": ["uuid"]
    }
    ```
- **Response**: `text/event-stream`.
