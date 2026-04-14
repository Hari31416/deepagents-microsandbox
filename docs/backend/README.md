# Backend Documentation

The backend is built with **Python 3.12+** using the **FastAPI** framework. It serves as the orchestration layer for the DeepAgent Sandbox project.

## Core Responsibilities

- **Agent Orchestration**: Managing the lifecycle of AI agents using LangGraph and DeepAgents.
- **Session Management**: Handling authenticated users, cookies, refresh tokens, user threads, messages, and runs.
- **File Management**: Orchestrating file uploads, downloads, and artifact generation in conjunction with MinIO and the Sandbox Executor.
- **Security**: Enforcing RBAC, thread ownership rules, and isolated execution of agent-generated code.

## Key Technologies

- **FastAPI**: Main web framework.
- **SQLAlchemy (Async)**: ORM for PostgreSQL.
- **Pydantic v2**: Data validation and settings management.
- **LangGraph**: Orchestration of agent state and tool calls.
- **DeepAgents**: High-level agent abstraction.
- **MinIO Python SDK**: Interaction with object storage.
- **UV**: Fast Python package manager.

## Directory Structure

```text
backend/
├── app/
│   ├── agent/       # Agent logic and tools
│   ├── api/         # API routes and dependencies
│   ├── db/          # Database models and repositories
│   ├── services/    # Business logic
│   ├── storage/     # MinIO integration
│   ├── config.py    # Configuration management
│   └── main.py      # Entry point
```
