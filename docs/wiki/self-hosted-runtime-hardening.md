# Self-Hosted Runtime Hardening

Date: 2026-04-14

## Summary

The backend now owns agent execution directly instead of proxying to an external LangGraph Agent Server.

## What Changed

- `/api/chat/stream` now runs the LangGraph app in-process and emits backend-owned SSE.
- PostgreSQL-backed LangGraph checkpoints are enabled automatically whenever the backend is configured against Postgres.
- Thread runs are stored in `thread_runs` with lifecycle status, selected files, staged workspace files, timestamps, output text, and failure detail.
- The root `just` workflow no longer starts or stops a separate LangGraph container/runtime process.

## Operational Notes

- Local development now requires infrastructure, the backend, the executor, and the frontend. It does not require `LANGSMITH_API_KEY` or `LANGGRAPH_CLOUD_LICENSE_KEY`.
- To get durable checkpoints in development, point `DATABASE_URL` at Postgres. SQLite remains supported for tests and lightweight local fallback, but it skips LangGraph checkpoint persistence.
- The frontend continues to consume `/api/chat/stream` and does not need to talk to LangGraph directly.

## Verification

- Backend tests cover runtime setup, graph compilation, API routes, and backend-owned streaming behavior.
- Frontend verification continues to rely on `pnpm build`.
