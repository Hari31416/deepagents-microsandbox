# Database Management

The project uses **PostgreSQL** as the primary relational database.

## Engine Configuration

The database connection is managed in `app/db/session.py`.

- **Driver**: `postgresql+psycopg` (asynchronous driver).
- **Pooling**: We use SQLAlchemy's built-in connection pooling for efficiency.
- **Async Session Factory**: `async_sessionmaker` is used to create sessions for each request.

## Initialization

Database initialization (creating tables) is handled via the `init_database` function, normally called during application startup or within the agent graph initialization.

```python
def init_database():
    settings = get_settings()
    engine = create_async_engine(settings.database_url)
    # ... logic to create all metadata ...
```

## Migrations

*Note: The current implementation relies on direct table creation via metadata. For production environments, the use of **Alembic** is highly recommended.*

## Environment Variables

Database connectivity is controlled by:
- `DATABASE_URL`: Full SQLAlchemy connection string.
- `POSTGRES_URI`: Alternative URI used specifically by some LangGraph components for checkpointer integration.

## Checkpointing

We use a PostgreSQL-backed checkpointer for LangGraph to ensure agent sessions are persistent across restarts. This is configured in the agent builder using the `PostgresSaver` class.
