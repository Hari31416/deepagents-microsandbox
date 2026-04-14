# Application Initialization

The backend application uses the factory pattern to initialize the FastAPI instance.

## Entry Point

The main entry point is `app/api/main.py`.

```python
def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        docs_url="/docs",
        redoc_url="/redoc",
    )

    # Router registration
    app.include_router(health.router, prefix=settings.api_prefix)
    app.include_router(threads.router, prefix=settings.api_prefix)
    app.include_router(files.router, prefix=settings.api_prefix)
    app.include_router(chat.router, prefix=settings.api_prefix)

    return app
```

## Lifespan Events

*Note: As of the current implementation, explicit lifespan events for database initialization or cleanup are being handled within dependencies or via the `init_database` call in the agent graph builder.*

## Middleware

The application uses standard FastAPI middleware. CORS is typically handled at the infrastructure level (e.g., Nginx or Docker Compose) but can be added in `create_app` if needed.

## Configuration Loading

Configuration is managed using `pydantic-settings` in `app/config.py`.

1. **Environment Variables**: Loaded from the environment or a `.env` file.
2. **Settings Object**: The `Settings` class defines defaults and validation logic.
3. **Caching**: The `get_settings()` function is decorated with `@lru_cache` to ensure the configuration is only parsed once.
