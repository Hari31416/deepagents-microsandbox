# Backend

FastAPI and the backend-owned LangGraph runtime for the DeepAgent Sandbox PoC.

This backend now includes:

- the product-facing API routes
- Postgres-backed thread, message, run-event, file, sandbox-session, and run metadata
- MinIO presign integration
- the custom DeepAgent sandbox backend
- in-process LangGraph execution with PostgreSQL checkpoints when Postgres is configured
- automatic staging of completed thread uploads into the sandbox before each chat run
- backend-emitted SSE for `metadata`, `updates`, `delta`, `error`, and `done`

The backend no longer depends on the Docker-backed LangGraph Agent Server path or LangSmith/license validation to serve chat runs.
Redis remains optional for future short-lived memory or caching layers, but chat history durability now lives in Postgres.
