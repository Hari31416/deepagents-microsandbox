# Architectural Decisions (ADR)

This document tracks major technical decisions made during the project.

## 001: Use of LangGraph for Agent Orchestration
- **Status**: Accepted
- **Context**: We need a way to manage complex, multi-step agent interactions with branching logic and state persistence.
- **Decision**: Use LangGraph.
- **Consequences**: Provides high-granularity control over the agent's reasoning cycle, built-in checkpointing, and easy integration with the LangChain ecosystem. Increases complexity compared to a simple linear chain.

## 002: Sandbox Isolation via Discrete Service
- **Status**: Accepted
- **Context**: Running agent-generated code directly on the backend server is a security risk.
- **Decision**: Outsource code execution to a dedicated `microsandbox-executor` service.
- **Consequences**: Ensures that even if the agent generates malicious code, it cannot escalate privileges or access sensitive backend data. Requires a network step and synchronization of workspace files.

## 003: MinIO for Binary Data Storage
- **Status**: Accepted
- **Context**: We need to store high volumes of training data, uploaded CSVs, and generated charts.
- **Decision**: Use MinIO (S3 compatible).
- **Consequences**: Enables horizontally scalable object storage, supports presigned URLs for direct-to-client transfers, and allows the sandbox executor to access the same data pool.

## 004: Server-Sent Events (SSE) for Real-Time UI
- **Status**: Accepted
- **Context**: Users expect real-time feedback as the agent thinking and executing code can take several seconds to minutes.
- **Decision**: Use SSE over standard REST or WebSockets.
- **Consequences**: Perfect for one-way streams (Agent -> User). Lower overhead than WebSockets and easier to implement with standard FastAPI/Browser APIs. Doesn't support bidirectional communication as natively as WebSockets.
