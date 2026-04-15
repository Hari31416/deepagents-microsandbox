# Data Flow

Understanding how data moves through the system is critical for debugging and extending the platform.

## 1. Chat Interaction Flow

When a user sends a message, the following sequence occurs:

1.  **Frontend**: The `ChatInput` component captures the user's message.
2.  **State Management**: `useChatMessages` hook is triggered.
3.  **API Call**: A `POST` request is sent to `/api/chat/stream`.
4.  **Backend (FastAPI)**:
    - Creates a new `ThreadRun` record.
    - Initializes the `LangGraph` agent.
    - Passes the message to the agent.
5.  **Agent (LangGraph)**:
    - Analyzes the input.
    - Calls tools (e.g., Python execution in the Sandbox).
    - Generates events (node start, tool call, tool result, node end).
6.  **Backend (SSE)**:
    - The `StreamService` captures these events.
    - Formats them as SSE data chunks.
    - Yields them to the FastAPI response stream.
7.  **Frontend (SSE Listener)**:
    - The `streamChat` utility parses the SSE chunks.
    - The `useChatMessages` hook updates the UI in real-time.
    - The message is marked as "completed" once the stream ends.

## 2. File Upload Flow

1.  **Frontend**: User selects a file in the workspace or chat.
2.  **Backend Upload**: Frontend calls `/api/files/upload` with the raw file body and upload metadata.
3.  **Storage Persist**: Backend streams the file into MinIO and records it in PostgreSQL.
4.  **State Refresh**: Frontend reloads thread files from `/api/threads/{thread_id}/files`.

## 3. Sandbox Code Execution

1.  **Agent Logic**: Agent decides to run code via the `PythonRunTool`.
2.  **Backend (Service)**: Calls `RuntimeService` to handle executor communication.
3.  **Executor Post**: Sends code and required files to the `microsandbox-executor` API.
4.  **Sandbox Runtime**:
    - Creates an isolated file system.
    - Stages input files.
    - Executes the code (e.g., `python script.py`).
    - Captures stdout/stderr.
    - Scans for generated artifacts (images, CSVs).
5.  **Result Return**: Returns execution status, output, and artifact metadata to the Backend.
6.  **Persistence**: Backend saves the results as `ThreadRunEvent` and `ThreadFile` (if artifacts were created).
