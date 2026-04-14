# API Reference

All API endpoints are prefixed with `/api` (configurable via `API_PREFIX`).

## Authentication & Session

The system uses a mixed approach with support for both Bearer tokens and Secure Cookies (`deepagent_access_token`).

### `POST /auth/login`
Authenticates a user and sets session cookies.
- **Role Required**: Public
- **Body**: `{ "email": "...", "password": "..." }`

### `POST /auth/refresh`
Refreshes the access token using the refresh cookie.
- **Role Required**: Public (Valid Refresh Cookie)

### `POST /auth/logout`
Invalidates the current session and clears cookies.
- **Role Required**: Public

### `GET /auth/me`
Returns current user profile information.
- **Role Required**: Authenticated

---

## Threads (Conversations)

### `GET /threads`
List threads. Visibility is role-dependent.
- **Role Required**: Authenticated
- **Visibility**: 
    - `user`: Own threads only.
    - `admin` / `super_admin`: All system threads.

### `POST /threads`
Create a new thread.
- **Role Required**: Authenticated
- **Body**: `{ "title": "optional title" }`

### `GET /threads/{id}`
Get thread metadata.
- **Role Required**: Authenticated (Owner or Admin)

### `PATCH /threads/{id}`
Update thread metadata.
- **Role Required**: Authenticated (Owner or Admin)

### `DELETE /threads/{id}`
Delete a thread and all linked resources (messages, files, sandbox).
- **Role Required**: Authenticated (Owner or Admin)

### `GET /threads/{id}/messages`
Retrieve message history for a thread.
- **Role Required**: Authenticated (Owner or Admin)

### `GET /threads/{id}/events`
Retrieve run events/logs for a thread.
- **Role Required**: Authenticated (Owner or Admin)

### `GET /threads/{id}/files`
List all files uploaded or generated in a thread.
- **Role Required**: Authenticated (Owner or Admin)

---

## Admin & User Management

### `GET /admin/users`
List all registered users.
- **Role Required**: Admin / Super Admin

### `POST /admin/users`
Create a new user.
- **Role Required**: Admin / Super Admin
- **Body**: email, password, display_name, role.

### `PATCH /admin/users/{user_id}`
Update user profile, role, or status.
- **Role Required**: Admin / Super Admin

### `POST /admin/users/{user_id}/reset-password`
Force reset a user's password.
- **Role Required**: Admin / Super Admin

---

## Files & Storage

### `POST /files/presign-upload`
Generate a presigned MinIO URL for uploading files.
- **Role Required**: Authenticated (Owner or Admin)

### `POST /files/complete-upload`
Finalize file registration after binary transport.
- **Role Required**: Authenticated (Owner or Admin)

### `POST /files/presign-download`
Generate a temporary download link.
- **Role Required**: Authenticated (Owner or Admin)

---

## Chat & Agent Execution

### `POST /chat/stream`
Start a streaming agent run via SSE.
- **Role Required**: Authenticated (Owner or Admin)
- **Response**: `text/event-stream`.
