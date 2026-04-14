# API Schemas

We use **Pydantic v2** for data validation, serialization, and automatic OpenAPI documentation.

## Schema Organization

Schemas are defined in `app/api/routes` corresponding to their routers, or in the service layer if shared across multiple components.

## Common Schemas

### Thread Schemas
- `ThreadCreate`: Input for creating a new thread (e.g., optional `title`).
- `ThreadResponse`: Output metadata for a thread.

### Message Schemas
- `ThreadMessageResponse`: Structured output for a chat message.

### File Schemas
- `PresignUploadRequest`: Parameters needed to generate an upload URL.
- `CompleteUploadRequest`: Payload to register an upload as complete.
- `PresignedUrlResponse`: Contains the generated URL and required headers.

### Chat Schemas
- `ChatStreamRequest`: Input for starting a new streaming agent run. This includes the `thread_id`, user `message`, and `selected_file_ids`.

## Validation Logic

Pydantic validates incoming request bodies before they reach the route handlers. This ensures that all data entering the system conforms to the expected types and constraints (e.g., string lengths, enum values).

## Serialization

We use Pydantic models to define the shape of API responses. This allows us to easily exclude internal fields (like database primary keys or sensitive data) and rename fields for the frontend.
