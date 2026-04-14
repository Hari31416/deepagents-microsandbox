# Service Layer

The service layer contains the core business logic of the application. It orchestrates interactions between repositories, external services, and the agent framework.

## Key Services

Defined in `app/services/`.

### `ThreadService`
- **Responsibility**: Management of user threads.
- **Key Methods**: `get_threads`, `create_thread`, `get_thread`.

### `MessageService`
- **Responsibility**: Handling message persistence and retrieval.
- **Key Methods**: `get_thread_messages`, `create_message`, `update_message`.

### `FileService`
- **Responsibility**: File lifecycle management, presigned URL generation, and artifact handling.
- **Key Methods**: `get_presigned_upload`, `complete_upload`, `get_presigned_download`, `get_thread_files`.

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
