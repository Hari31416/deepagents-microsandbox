# DeepAgent Data Analyst PoC Implementation Plan

## Goal

Build a small but production-shaped PoC for an authenticated data analyst agent that:

- uses DeepAgent as the agent harness
- executes generated code inside `microsandbox-executor`
- persists LangGraph checkpoints in Postgres
- stores uploads and generated artifacts in MinIO
- uses Redis only where it materially helps
- supports streaming and resumability through LangGraph deployment

The initial user flow is:

1. user signs in
2. user uploads one or more files
3. user asks for transformation, analysis, or visualization
4. agent writes code and executes it in the sandbox
5. generated artifacts are persisted and shown in the UI
6. the conversation can resume later from the same thread

## Core Decisions

### 1. Use LangGraph deployment for the agent runtime

This is the right fit for:

- streaming runs
- resumable stateful threads
- long-running agent execution
- checkpoint-backed recovery

We should treat LangGraph deployment as the agent runtime, not as the full product backend.

### 2. Keep `microsandbox-executor` as a separate execution control plane

Do not fold sandbox execution into the LangGraph app itself.

Keep this boundary:

- LangGraph app: reasoning, orchestration, agent state
- sandbox executor: isolated code execution, workspace staging, artifact persistence

This matches the current shape of `microsandbox-executor/service` and avoids coupling the agent runtime to sandbox implementation details.

### 3. Build a custom DeepAgent backend, not a custom execute tool

The clean integration point is a Python backend that implements DeepAgent's sandbox backend contract.

Implementation direction:

- create `MicrosandboxBackend` in Python
- extend DeepAgent `BaseSandbox`
- implement `execute()` and file upload/download methods by calling the executor HTTP API

This allows the agent to keep using DeepAgent's built-in:

- `read_file`
- `write_file`
- `edit_file`
- `ls`
- `glob`
- `grep`
- `execute`

Do not model sandbox execution as a separate ad hoc tool unless we hit a hard backend limitation.

### 4. Use Postgres for both product metadata and LangGraph checkpoints

Postgres will hold:

- application data such as users, threads, file metadata, artifact metadata, sandbox session mappings
- LangGraph checkpointer tables via `langgraph-checkpoint-postgres`

This keeps the PoC simple and consistent.

### 5. Use one MinIO bucket

Keep all objects in a single bucket and separate concerns by key prefix.

Recommended prefixes:

- `threads/{thread_id}/uploads/...`
- `threads/{thread_id}/artifacts/...`
- `threads/{thread_id}/workspace-seed/...` if needed later

### 6. Put presigned upload/download behind the backend

The browser must never receive MinIO credentials.

The backend should expose endpoints that mint short-lived presigned URLs after checking:

- authenticated user identity
- thread ownership
- allowed operation
- size/content-type constraints for uploads

## Target Architecture

```text
Browser
  -> Backend API (auth, threads, presign, stream proxy, metadata)
  -> LangGraph Deployment API (via backend proxy or internal call path)
  -> Microsandbox Executor API
  -> Postgres
  -> MinIO
  -> Redis (optional)

LangGraph Runtime
  -> DeepAgent
  -> MicrosandboxBackend
  -> Microsandbox Executor

Microsandbox Executor
  -> microsandbox runtime
  -> Postgres metadata
  -> MinIO object storage
```

## Proposed Repository Shape

Keep the current executor subtree and add an application backend around it.

```text
.
├── implementation_plan.md
├── backend/
│   ├── pyproject.toml
│   ├── langgraph.json
│   ├── app/
│   │   ├── api/
│   │   │   ├── main.py
│   │   │   ├── auth.py
│   │   │   ├── routes/
│   │   │   │   ├── files.py
│   │   │   │   ├── threads.py
│   │   │   │   ├── chat.py
│   │   │   │   └── health.py
│   │   ├── agent/
│   │   │   ├── graph.py
│   │   │   ├── prompts.py
│   │   │   ├── backend.py
│   │   │   ├── models.py
│   │   │   └── tools.py
│   │   ├── db/
│   │   │   ├── models.py
│   │   │   ├── queries.py
│   │   │   └── migrations/
│   │   ├── storage/
│   │   │   └── minio.py
│   │   └── services/
│   │       ├── thread_service.py
│   │       ├── file_service.py
│   │       └── stream_service.py
│   └── tests/
├── microsandbox-executor/
│   ├── service/
│   └── ...
└── frontend/
```

## System Responsibilities

### Backend API

This is the product-facing backend.

Responsibilities:

- auth and user context
- thread creation and ownership checks
- presigned upload/download endpoints
- file metadata registration
- stream proxy to LangGraph deployment
- thread/run lookup for the frontend
- mapping `thread_id -> sandbox_session_id`

This backend should be the only public API the frontend talks to.

### LangGraph runtime

Responsibilities:

- run the DeepAgent graph
- stream updates
- persist checkpoints
- resume from thread state
- call the sandbox backend for file operations and execution

### Microsandbox executor

Responsibilities:

- create and destroy isolated execution environments
- stage selected files from MinIO into a local workspace
- execute Python or shell inside the sandbox
- diff the workspace after execution
- persist changed/generated files back to MinIO
- report stdout/stderr/exit metadata

## DeepAgent Integration

## `MicrosandboxBackend`

Implement a Python backend in `backend/app/agent/backend.py`.

Design:

- subclass `deepagents.backends.sandbox.BaseSandbox`
- bind one backend instance to one logical thread/session
- use the executor API under the hood

Minimum responsibilities:

- `id`: stable backend identifier for the thread
- `execute(command, timeout=...)`
- `upload_files(...)`
- `download_files(...)`

Behavior:

- every LangGraph thread gets one logical sandbox session
- the backend lazily creates or reuses the executor session
- file operations are relative to the thread workspace root
- `execute()` writes the command into the session and calls executor `/v1/execute` or `/v1/execute/bash`

Important constraint:

- the backend must not hold only in-memory session mapping
- `thread_id -> sandbox_session_id` must be stored in Postgres so resumability survives process restarts

## Agent Graph

The graph should use:

- `create_deep_agent(...)`
- a Postgres checkpointer
- the custom backend factory
- a system prompt focused on safe data analysis

PoC behavior:

- prefer Python for transformations and visualization
- save user-facing outputs under `/artifacts`
- mention generated file names in the final response
- avoid external network unless the request explicitly needs it and policy allows it

Recommended first version:

- no remote subagents
- no Redis-backed work queue
- one main data analyst agent with a small set of skills or prompt sections

## LangGraph Deployment Plan

Use LangGraph deployment for the graph runtime.

Implementation notes:

- configure the graph in `backend/langgraph.json`
- configure the checkpointer with `langgraph-checkpoint-postgres`
- pass user context into the graph via configurable headers or request config

Suggested headers passed from backend to the deployed graph:

- `x-user-id`
- `x-thread-id`
- `x-org-id` if multi-tenant later

These headers are used only as runtime context. Authentication remains enforced in the product backend.

### Streaming path

The frontend should not call the LangGraph deployment directly in the PoC.

Preferred flow:

1. frontend calls backend `POST /api/chat/stream`
2. backend validates auth and thread ownership
3. backend forwards the request to LangGraph deployment
4. backend relays the LangGraph stream back to the browser as SSE

Why proxy streaming through the backend:

- one auth boundary
- easier enrichment with file/artifact metadata
- easier migration between managed and self-hosted deployment later

### Resumability path

Resumability relies on three independent stores:

- LangGraph checkpoint state in Postgres
- thread-to-sandbox session mapping in Postgres
- uploaded/generated objects in MinIO

If the backend or deployment restarts, the next run should:

- recover the thread state from the checkpointer
- recover the sandbox session mapping from Postgres
- recover files from MinIO via the executor

## Backend API Design

### Authenticated thread endpoints

- `POST /api/threads`
  - create a product thread
  - create or associate a LangGraph thread id
- `GET /api/threads/:thread_id`
  - fetch thread metadata
- `GET /api/threads/:thread_id/files`
  - list uploads and artifacts
- `GET /api/threads/:thread_id/runs`
  - fetch past runs if needed

### Streaming endpoint

- `POST /api/chat/stream`
  - input: `thread_id`, user message, optional selected file ids
  - output: SSE stream forwarding LangGraph updates plus backend-enriched artifact events

### Presigned upload endpoint

- `POST /api/files/presign-upload`
  - input: `thread_id`, `filename`, `content_type`, `size`, `purpose`
  - validate:
    - user owns thread
    - file size within limit
    - content type allowed
  - output:
    - object key
    - presigned PUT URL
    - required headers
    - expiry timestamp

- `POST /api/files/complete-upload`
  - input: `thread_id`, `object_key`, original metadata
  - writes file metadata row in Postgres

### Presigned download endpoint

- `POST /api/files/presign-download`
  - input: `thread_id`, `file_id` or `object_key`
  - validate:
    - user owns thread
    - object belongs to thread
  - output:
    - presigned GET URL
    - expiry timestamp

This is the endpoint the user asked for. It piggybacks MinIO presigned URLs through the backend while keeping MinIO private.

### Why this endpoint belongs in the backend

Put this in the product backend, not the executor, because:

- authorization is user/thread-aware
- presign policy is an application concern
- frontend already needs the backend for threads and chat
- executor should remain an internal execution plane

## MinIO Object Model

Use one bucket.

Suggested key scheme:

- `threads/{thread_id}/uploads/{upload_id}/{filename}`
- `threads/{thread_id}/artifacts/{artifact_id}/{filename}`
- `threads/{thread_id}/artifacts/{artifact_id}/preview.html`

Store metadata in Postgres:

- file id
- thread id
- object key
- kind: `upload` or `artifact`
- original filename
- size
- content type
- created by user or agent
- source run id if agent-generated

## Postgres Schema

Application tables:

- `users`
- `threads`
- `thread_participants` if needed later
- `thread_sandbox_sessions`
- `thread_files`
- `agent_runs`
- `agent_run_artifacts`

LangGraph tables:

- created by `langgraph-checkpoint-postgres`

Recommended thread mapping table:

- `thread_sandbox_sessions`
  - `thread_id`
  - `sandbox_session_id`
  - `executor_base_url`
  - `created_at`
  - `updated_at`

## Microsandbox Executor Changes

The current executor already has the right shape, but two core pieces need to change.

### 1. Replace local session storage with MinIO-backed storage

Current code to replace or abstract further:

- `microsandbox-executor/service/src/storage/local.ts`
- `microsandbox-executor/service/src/storage/sync.ts`

Target:

- add `MinioSessionStorage`
- keep the same storage interface used by `WorkspaceSync`
- support:
  - session root existence
  - stage files into a workspace
  - persist files back to object storage
  - open file download stream
  - delete session objects

### 2. Replace SQLite metadata with Postgres

Current code to replace:

- `microsandbox-executor/service/src/metadata/store.ts`

Target:

- `PostgresMetadataStore`
- keep the same service-level semantics where practical
- preserve session/job/file metadata behavior

### 3. Keep current runtime adapter shape

Keep and extend:

- `microsandbox-executor/service/src/runtime/types.ts`
- `microsandbox-executor/service/src/jobs/executor.ts`

This part of the current executor is already a good abstraction boundary.

### 4. Keep presigned URL logic out of the executor

The executor may use MinIO SDK internally with service credentials, but public presigned URL minting should live in the backend API.

## Frontend Plan

The frontend will be built from scratch after the backend, executor, and agent integration are stable enough to support the real product flow.

The frontend should be chat-first, artifact-forward.

### Primary layout

- left rail: files and artifacts
- center: conversation and streaming run status
- right pane: selected preview

### Supported previews for PoC

- CSV and parquet summary table
- PNG and SVG image preview
- plain text and JSON
- HTML report in sandboxed iframe
- code view for generated scripts

### Recommended interaction model

1. user uploads via backend-provided presigned URL
2. frontend registers the upload with backend
3. user submits message
4. frontend opens SSE stream from backend
5. stream shows:
   - model text deltas
   - tool activity
   - run status
   - new artifacts
6. frontend refreshes file/artifact list when run completes

### First UI milestone

- authenticated file list
- chat composer
- streaming response panel
- artifact preview panel

Do not introduce a manual code editor as the main interaction surface.

## Redis Usage

Do not make Redis mandatory in the first cut.

Introduce Redis only if one of these becomes necessary:

- cross-instance rate limiting
- distributed locks
- pub/sub fanout for stream updates
- background job queue outside LangGraph runtime

For the PoC, Postgres plus LangGraph deployment is enough.

## Security Rules

- backend is the only public entry point
- MinIO credentials stay server-side only
- sandbox network mode defaults to `none`
- allowlist networking only for explicit, audited cases
- sandbox images are prebuilt, not dynamically mutated by the user
- executor validates CPU, memory, timeout, and file limits
- thread ownership is enforced on every file and stream endpoint

## Implementation Phases

## Phase 1: Infrastructure

- add top-level `docker-compose.yml` for Postgres, MinIO, Redis
- keep Redis optional in application startup
- add `.env.example` with all required variables
- define one MinIO bucket

Exit criteria:

- services boot locally
- backend and executor can connect to Postgres and MinIO

## Phase 2: Backend skeleton

- scaffold `backend/`
- add auth stub or simple local auth
- add DB models and migrations
- add MinIO client wrapper
- add thread CRUD
- add presigned upload/download endpoints

Exit criteria:

- authenticated upload/download flow works without the agent

## Phase 3: Executor migration

- add `MinioSessionStorage`
- add `PostgresMetadataStore`
- wire them into executor app setup
- keep current job execution behavior intact

Exit criteria:

- files stage from MinIO into sandbox workspace
- generated outputs persist back to MinIO
- executor tests pass with new stores

## Phase 4: DeepAgent integration

- implement `MicrosandboxBackend`
- build `create_deep_agent(...)` graph
- wire Postgres checkpointer
- persist `thread_id -> sandbox_session_id`

Exit criteria:

- agent can read uploaded files
- agent can write code and execute it
- artifacts survive restarts

## Phase 5: LangGraph deployment wiring

- add `langgraph.json`
- configure deployed graph entrypoint
- wire stream proxy from backend to LangGraph deployment
- pass runtime headers or config for user/thread context

Exit criteria:

- browser receives streaming agent output
- same thread resumes on follow-up requests

## Phase 6: Frontend

- build `frontend/`
- start from a clean product UI, not from `microsandbox-executor`
- add upload flow using presigned URLs
- add artifact rendering

Exit criteria:

- end-to-end user flow works from upload to chart preview

## Phase 7: Hardening

- add tests across backend, executor, and integration boundaries
- add rate limiting and quotas if needed
- add observability and structured logging
- add stricter content-type and file-size controls

## Initial Acceptance Criteria

The PoC is successful when all of the following are true:

- a signed-in user can create a thread
- the user can upload a CSV through a backend-issued presigned URL
- the upload is registered in Postgres and stored in MinIO
- the user can ask for a transformation or chart
- DeepAgent reads the file and executes generated Python in the sandbox
- generated files are persisted to MinIO as artifacts
- the UI can display the resulting artifact
- the conversation resumes correctly after a backend restart

## Immediate Next Steps

1. Create `backend/` with Postgres models, MinIO wrapper, and presigned file endpoints.
2. Migrate `microsandbox-executor` from local storage and SQLite to MinIO and Postgres.
3. Implement `MicrosandboxBackend` and the LangGraph-deployed DeepAgent graph.
4. Build the new `frontend/` only after the backend and agent execution flow are stable.
