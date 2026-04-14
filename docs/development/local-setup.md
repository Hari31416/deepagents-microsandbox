# Local Setup Guide

Follow these steps to get the DeepAgent Sandbox running on your local machine.

## Prerequisites

- **Python 3.12+** (managed with `uv` recommended)
- **Node.js 20+** (managed with `pnpm` recommended)
- **Docker & Docker Compose**
- **Just** (command runner)

## 1. Clone the Repository

```bash
git clone <repository-url>
cd deepagent-sandbox-poc
```

## 2. Infrastructure Setup

Start the core services (PostgreSQL, MinIO, Redis):

```bash
just up
```

## 3. Backend Setup

```bash
# Install dependencies
just backend-setup

# Start the backend server
just backend-start
```

The API will be available at `http://localhost:8000`. Documentation at `/docs`.

## 4. Frontend Setup

```bash
# Install dependencies
just frontend-setup

# Start the development server
just frontend-start
```

The UI will be available at `http://localhost:5173`.

## 5. Environment Variables

Ensure you have a `.env` file in the root directory. You can use `.env.example` as a template.

```bash
cp .env.example .env
```

## 6. Microsandbox Executor

The executor needs to be running for code execution tools to work.

```bash
cd microsandbox-executor
just start
```

## Summary of Commands

| Command | Description |
| --- | --- |
| `just up` | Start infrastructure only |
| `just start` | Start everything (infra + backend + frontend) |
| `just stop` | Stop everything |
| `just logs` | View unified logs |
