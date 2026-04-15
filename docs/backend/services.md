# Service Layer

The service layer contains the core business logic of the application. It orchestrates interactions between repositories, external services, and the agent framework.

## Key Services

Defined in `app/services/`.

### ThreadService

**Location**: `app/services/thread_service.py`

Responsible for the lifecycle of conversations and enforcing role-based visibility rules.

- **`create_thread`**: Initializes a new conversation with an optional title.
- **`list_threads`**: Dynamically filters threads. Super Admins receive every thread, Admins receive their own plus regular-user threads, and Users are restricted to threads where they are the `owner_id`.
- **`get_thread_for_actor`**: A security-conscious getter that verifies permissions before returning thread metadata.
- **`update_thread_title`**: Allows owners (and admins) to rename conversations.
- **`delete_thread`**: Handles soft-deletion and triggers cleanup of associated files in MinIO storage.

### `MessageService`
- **Responsibility**: Handling message persistence and retrieval.
- **Key Methods**: `get_thread_messages`, `create_message`, `update_message`.

### `FileService`
- **Responsibility**: File lifecycle management, presigned URL generation, and artifact handling.
- **Key Methods**: `get_presigned_upload`, `complete_upload`, `get_presigned_download`, `get_thread_files`.
- **Security Model**: Standard frontend uploads terminate at the backend, which streams them into MinIO and returns a DB-backed file record. Download access resolves files strictly from DB-backed `file_id` records.

### `RunService`
- **Responsibility**: Management of `ThreadRun` and `ThreadRunEvent` records.
- **Key Methods**: `create_run`, `update_run_status`, `save_run_event`.

### `RuntimeService`
- **Responsibility**: Direct communication with the `microsandbox-executor`.
- **Key Methods**: `run_code`, `list_session_files`, `get_session_id`.

### `StreamService`
- **Responsibility**: Orchestrating the streaming agent logic and yielding events to the API layer.
- **Key Methods**: `start_chat_stream`.

## Design Patterns

- **Transaction Management**: Services are responsible for managing database transactions, often using an `async with` block on the repository or session.
- **Separation of Concerns**: Services do not know about HTTP requests or SSE formatting; they operate on data models and return domain objects or generators.
- **Error Handling**: Custom domain exceptions are raised here and caught by the API layer to return appropriate HTTP status codes.
