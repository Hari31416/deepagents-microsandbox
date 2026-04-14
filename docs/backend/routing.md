# API Routing

API routes are organized by feature in the `app/api/routes` directory.

## Current Routers

### 1. Health (`health.py`)
- **Prefix**: `/api`
- **Endpoints**:
    - `GET /health`: Basic health check returning service status.

### 2. Threads (`threads.py`)
- **Prefix**: `/api/threads`
- **Responsibilities**: CRUD operations for chat threads and message retrieval.
- **Endpoints**:
    - `GET /`: List all threads for the current user.
    - `POST /`: Create a new thread.
    - `GET /{thread_id}`: Get details for a specific thread.
    - `GET /{thread_id}/messages`: Retrieve the message history for a thread.
    - `GET /{thread_id}/events`: Retrieve execution events for a specific thread/run.
    - `GET /{thread_id}/files`: List all files (uploads and artifacts) associated with a thread.

### 3. Files (`files.py`)
- **Prefix**: `/api/files`
- **Responsibilities**: Secure file handling via presigned URLs.
- **Endpoints**:
    - `POST /presign-upload`: Generate a URL for direct upload to MinIO.
    - `POST /complete-upload`: Register an uploaded file in the database.
    - `POST /presign-download`: Generate a URL for downloading a file.

### 4. Chat (`chat.py`)
- **Prefix**: `/api/chat`
- **Responsibilities**: Real-time agent interaction.
- **Endpoints**:
    - `POST /stream`: Starts an agent run and streams events back to the client using Server-Sent Events (SSE).

## Route Protection

Routes are typically protected by a `X-User-Id` header, which is extracted and validated via dependencies defined in `app/api/dependencies.py`.
