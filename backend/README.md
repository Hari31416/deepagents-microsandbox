# Backend

FastAPI and LangGraph application code for the DeepAgent Sandbox PoC.

This backend currently includes:

- the product-facing API routes
- Postgres-backed thread and file metadata
- MinIO presign integration
- the custom DeepAgent sandbox backend
- the LangGraph graph entrypoint and runtime-backed persistence wiring
- automatic staging of completed thread uploads into the sandbox before each chat run
- Docker-backed LangGraph startup that persists runtime state in PostgreSQL instead of `.langgraph_api`
- LangGraph startup expects either `LANGSMITH_API_KEY` for local development or `LANGGRAPH_CLOUD_LICENSE_KEY` for licensed deployments

The remaining work is deployment proxy wiring, frontend integration, and hardening.
