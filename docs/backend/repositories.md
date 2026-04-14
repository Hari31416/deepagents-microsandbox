# Data Access & Repositories

We use the repository pattern to abstract the data access logic and provide a clean interface for the service layer.

## Repository Structure

Defined in `app/db/repositories.py`.

### `UserRepository`
Handles finding or creating user profiles.

### `ThreadRepository`
Manages queries for chat threads, including filtering by user ID and owner validation.

### `MessageRepository`
Encapsulates operations on `ThreadMessage`, ensuring messages are correctly associated with threads and user IDs.

### `RunRepository` & `RunEventRepository`
Handle high-throughput persistence of execution runs and their constituent events.

### `ThreadFileRepository`
Manages metadata for files, including purpose-based filtering (upload vs. artifact).

### `SandboxSessionRepository`
Stores mappings between chat threads and remote sandbox session IDs.

## Query Style

- **Asyncio**: All repository methods are `async` and use `await session.execute()`.
- **SQLAlchemy Selects**: We use the SQLAlchemy 2.0 `select()` and `insert()` constructs.
- **Error Handling**: Databases-specific errors (like unique constraint violations) are handled within the repository or re-raised as domain-specific exceptions.

## Example Repository Pattern

```python
class ThreadRepository:
    def __init__(self, session_factory):
        self._session_factory = session_factory

    async def get_by_id(self, thread_id: str) -> Thread | None:
        async with self._session_factory() as session:
            result = await session.execute(
                select(Thread).where(Thread.id == thread_id)
            )
            return result.scalar_one_or_none()
```
