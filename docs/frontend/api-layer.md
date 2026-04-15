# API Layer & Streaming

The frontend communicates with the backend via a structured API layer located in `src/lib/api-client.ts`.

## 1. Axios Client

A centralized Axios instance is configured with:
- `baseURL`: Loaded from environment variables as an absolute backend URL.
- `Headers`: Includes `Content-Type: application/json` and the `X-User-Id` header for authentication.

## 2. API Modules

API calls are grouped into objects for clarity:
- **`threadsApi`**: Methods for `list`, `create`, `getMessages`, etc.
- **`filesApi`**: Methods for backend-owned upload, view, download, and compatibility download links.
- File upload, preview, and download all go through the backend API, so the browser never needs a MinIO URL.

## 3. SSE Streaming Implementation

The `streamChat` function handles the real-time interaction with the agent. It uses the `fetch` API directly (rather than Axios) because of better support for readable streams.

### Key Logic
- **Reader**: Obtains a lock on the stream via `response.body.getReader()`.
- **Buffer**: Accumulates data chunks and splits them by newlines to extract SSE fields (`event:`, `data:`, `id:`).
- **Yield**: Uses a generator (`async function*`) to yield parsed events back to the calling hook.

## 4. `useChatMessages` Hook

This custom hook (`src/hooks/use-chat-messages.ts`) encapsulates the streaming logic and UI updates.

- **Optimistic Updates**: Adds the user message to the UI immediately.
- **State Patching**: As chunks of data arrive, it patches the assistant's message in real-time.
- **Error Recovery**: Handles network failures and aborts the stream if the component unmounts.
