# DeepAgent Sandbox PoC

PoC for an authenticated data analyst agent that uses LLMs to analyze uploaded data, write code, execute that code in an isolated sandbox, and return artifacts such as transformed datasets, charts, and reports.

The system is being built around:

- [DeepAgents](https://github.com/langchain-ai/deepagents) for the agent harness
- [microsandbox](https://github.com/superradcompany/microsandbox) for isolated code execution
- LangGraph deployment for streaming, resumability, and checkpointed agent execution
- Postgres for product metadata and LangGraph checkpoints
- MinIO for uploads and generated artifact storage
- Redis only where it is actually needed

## Status

This repository is in active PoC design and implementation.

Current direction:

- `backend/` will host the product-facing API and LangGraph agent app
- `microsandbox-executor/` is the execution control plane
- `frontend/` will be built later from scratch after the backend and agent flow are stable

The authoritative build plan is in [implementation_plan.md](/Users/hari/Desktop/sandbox/deepagent-sandbox-poc/implementation_plan.md).

## Product Goal

The intended user flow is:

1. user signs in
2. user uploads one or more files
3. user asks for a transformation, analysis, or visualization
4. the agent writes code
5. the code executes in an isolated sandbox
6. generated artifacts are persisted and shown back to the user
7. the thread can be resumed later

## Architecture

At a high level:

```text
Browser
  -> Backend API
  -> LangGraph deployment
  -> Microsandbox executor
  -> Postgres
  -> MinIO

LangGraph runtime
  -> DeepAgent
  -> custom MicrosandboxBackend
  -> microsandbox-executor

microsandbox-executor
  -> microsandbox runtime
  -> Postgres metadata
  -> MinIO object storage
```

## Core Components

### DeepAgents

DeepAgents is the agent harness. It provides:

- planning and multi-step tool use
- filesystem tools
- execution support through sandbox backends
- subagent support when needed

The plan for this PoC is to integrate with DeepAgents through a custom backend rather than through a one-off execution tool. That keeps the agent on the standard DeepAgents model for file operations and command execution.

### microsandbox

[`microsandbox`](https://github.com/superradcompany/microsandbox) is the isolation layer that executes agent-generated code inside microVM-backed environments.

This repo does not modify `microsandbox` directly. Instead, it uses a dedicated execution service in [`microsandbox-executor/`](/Users/hari/Desktop/sandbox/deepagent-sandbox-poc/microsandbox-executor) as the control plane that:

- stages files into a workspace
- runs code inside isolated sandboxes
- captures stdout/stderr/exit data
- persists generated files back to object storage

### LangGraph Deployment

LangGraph deployment will be used as the runtime for the agent graph because it gives us:

- streaming
- resumable thread execution
- durable checkpoints
- a better fit for long-running agent workflows than a stateless API

## Repository Layout

```text
.
├── implementation_plan.md
├── microsandbox-executor/
│   └── service/
├── reference_modules/
│   ├── deepagents/
│   └── microsandbox-executor/
└── AGENTS.md
```

Notes:

- `microsandbox-executor/` is the working execution service in this repo
- `reference_modules/deepagents/` is a local reference checkout used during design and integration work
- `reference_modules/microsandbox-executor/` is retained as historical reference material

## Planned Backend Responsibilities

The backend will be the public API surface for the product.

It will handle:

- authentication and user context
- thread creation and ownership checks
- presigned MinIO upload/download URLs
- file metadata registration
- streaming proxy to LangGraph deployment
- mapping `thread_id -> sandbox_session_id`

The browser should not talk directly to MinIO or to the sandbox executor.

## Storage Model

### Postgres

Postgres will store:

- users
- threads
- file and artifact metadata
- sandbox session mappings
- LangGraph checkpoints

### MinIO

MinIO will store:

- uploaded user files
- generated artifacts such as CSVs, PNGs, SVGs, HTML reports, and logs

The backend will mint short-lived presigned URLs for uploads and downloads after validating user and thread ownership.

## Frontend Direction

The frontend is not the current focus and will be built later from scratch.

The intended product UI is:

- chat-first
- artifact-forward
- file upload aware
- streaming aware

The primary interaction is not a manual code editor. The primary interaction is conversation plus artifact preview.

## References

- DeepAgents: [https://github.com/langchain-ai/deepagents](https://github.com/langchain-ai/deepagents)
- microsandbox: [https://github.com/superradcompany/microsandbox](https://github.com/superradcompany/microsandbox)
- Project plan: [implementation_plan.md](/Users/hari/Desktop/sandbox/deepagent-sandbox-poc/implementation_plan.md)

## Next Steps

1. Scaffold `backend/`
2. Move `microsandbox-executor` to Postgres and MinIO-backed persistence
3. Implement the custom DeepAgents sandbox backend
4. Wire the agent into LangGraph deployment
5. Build the new frontend after the backend path is stable
