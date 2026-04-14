# Dependency Injection

FastAPI's dependency injection system is used to handle cross-cutting concerns like database sessions, authentication, and service instantiation.

## Core Dependencies

Defined in `app/api/dependencies.py`.

### Identity & Authentication

- `get_user_id`: Extracts the `X-User-Id` header from the request. This is used to scope all database queries and storage operations to the specific user.

### Database Integration

- `get_db_session`: Yields an asynchronous SQLAlchemy session. It handles the lifecycle of the connection, ensuring it's properly closed after each request.

### Service Layer Injection

Each service has a dedicated dependency function that handles its instantiation, often injecting the required repositories or other services.

- `get_thread_service`
- `get_message_service`
- `get_file_service`
- `get_run_service`
- `get_runtime_service`
- `get_stream_service`

## Example Usage

```python
@router.get("/threads")
async def list_threads(
    user_id: str = Depends(get_user_id),
    thread_service: ThreadService = Depends(get_thread_service)
):
    return await thread_service.get_user_threads(user_id)
```

## Scoped vs. Global

Most dependencies are **request-scoped**. However, some objects like the `get_settings` are cached application-wide.
