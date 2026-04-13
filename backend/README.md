# Backend

FastAPI and LangGraph application code for the DeepAgent Sandbox PoC.

This backend currently includes:

- the product-facing API routes
- Postgres-backed thread and file metadata
- MinIO presign integration
- the custom DeepAgent sandbox backend
- the LangGraph graph entrypoint and checkpointer wiring
- automatic staging of completed thread uploads into the sandbox before each chat run

The remaining work is deployment proxy wiring, frontend integration, and hardening.
