# Self-Hosted Runtime Migration

## Decision

This project will move away from the licensed LangGraph Agent Server path (`langgraph up`, standalone Agent Server, and related deployment/runtime glue) and toward a self-hosted backend-owned runtime.

In practice, that means:

- keep using open-source LangGraph and DeepAgents in-process
- keep the existing FastAPI backend as the public API surface
- keep the existing frontend talking only to the backend
- move streaming, persistence, and runtime orchestration into the backend instead of relying on the hosted/licensed Agent Server product

## Why

The current Docker-based Agent Server path requires LangSmith or LangGraph Cloud-backed license validation even for self-hosted deployment flows.

That is the wrong fit for this repo because:

- we want an on-prem friendly deployment story
- we do not want the backend runtime blocked on LangSmith or LangGraph Cloud access
- we already own thread, file, auth, and sandbox orchestration in the backend
- the frontend already consumes backend SSE rather than talking to LangGraph directly

## What Changes

### Keep

- FastAPI backend routes
- frontend chat UI and SSE consumption
- Postgres for product metadata
- MinIO for uploads and artifacts
- microsandbox executor integration
- DeepAgents agent graph

### Remove or Replace

- Docker-backed LangGraph Agent Server startup
- external `/threads/.../runs/stream` calls from the backend to a separate LangGraph server
- licensed runtime assumptions
- LangGraph server-specific deployment glue

## Target Architecture

```text
Browser
  -> FastAPI backend
  -> in-process LangGraph / DeepAgents runtime
  -> microsandbox executor
  -> Postgres
  -> MinIO

FastAPI backend
  -> owns SSE streaming
  -> owns thread/run lifecycle
  -> owns persistence wiring
  -> stages workspace files into sandbox
```

## Scope Estimate

### Small local-dev bypass

- call the graph directly from the backend
- keep the current frontend API unchanged
- emit backend SSE without going through the Agent Server

This is enough for local development, but it is not the desired final architecture.

### Proper self-hosted migration

- replace external LangGraph HTTP calls with in-process graph execution
- keep the current frontend SSE contract stable
- add backend-owned persistence for graph execution state
- remove Agent Server-specific runtime dependencies from the hot path
- add tests and documentation

This is the recommended target for this repo.

### Production-grade hardening

- improve recovery and resumability semantics
- harden run metadata and error handling
- expand integration coverage
- remove leftover deployment/runtime glue that only existed for the licensed server path

## Migration Plan

1. Replace the outbound LangGraph API call in the backend stream service with direct in-process graph execution.
2. Keep streaming responses normalized as SSE from FastAPI so the frontend does not need a protocol rewrite.
3. Reintroduce persistence in the backend-owned runtime using PostgreSQL-backed LangGraph primitives where appropriate.
4. Preserve the current workspace file staging behavior so files continue to appear under `/workspace` inside the sandbox.
5. Remove the Docker-backed Agent Server startup flow after the self-hosted path is verified.
6. Update local development commands and documentation to reflect the new runtime model.

## Expected Frontend Impact

Frontend impact should be low because the frontend already talks to `/api/chat/stream` on the backend.

The goal is to preserve:

- the current request shape
- the current SSE event handling model
- the current live trace UI

If the backend continues emitting the same event categories, the frontend should need only minor or no changes.

## Expected Backend Impact

Backend impact is moderate and centered on the chat streaming path.

Primary implementation areas:

- `backend/app/services/stream_service.py`
- `backend/app/api/routes/chat.py`
- graph persistence wiring
- tests for streaming and failure handling

## Risks

- reproducing enough run metadata for the existing live trace UI
- deciding the right persistence model for resumability
- avoiding partial parity assumptions from the licensed Agent Server API

These risks are manageable because this repo already centralizes the product-facing API in the backend.

## Non-Goals

- full parity with every LangGraph Agent Server feature
- direct frontend communication with LangGraph
- dependency on LangSmith for runtime validation

## Recommendation

Proceed with the proper self-hosted migration, not the temporary local-dev-only bypass.

That gives this project:

- a deployment model aligned with on-prem requirements
- no license-gated runtime dependency
- minimal frontend churn
- clearer ownership of streaming, persistence, and sandbox orchestration
