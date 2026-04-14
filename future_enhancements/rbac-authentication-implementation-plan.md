# RBAC Authentication Implementation Plan

## Goal

Add first-class authentication and role-based access control to the application with three roles:

- `super_admin`: full system access, can create `admin` and `user` accounts, seeded automatically on app startup
- `admin`: full product access except creating other `admin` accounts
- `user`: standard access to the system and only their own resources

This plan assumes the current app shape remains intact:

- FastAPI remains the product API
- PostgreSQL remains the source of truth for users, threads, runs, and messages
- MinIO remains the single object bucket
- DeepAgents remains the agent harness
- `microsandbox-executor` remains the isolated execution layer

## Current State Summary

The app already has ownership-based scoping for product data:

- `threads.owner_id`
- `thread_runs.owner_id`
- `thread_messages.owner_id`
- `thread_run_events.owner_id`
- thread lookup is enforced through `get_thread_for_owner(...)`

The current gap is identity and authorization:

- backend auth is only `X-User-Id` with a fallback `default_user_id`
- frontend injects a static `VITE_DEFAULT_USER_ID`
- users are auto-created implicitly when a thread is created
- there is no password, session, token, or role model
- sandbox calls also forward only `X-User-Id`

So the system has per-user data partitioning, but not real authentication or RBAC.

## Recommended Auth Model

Use application-managed auth with secure password login plus signed access tokens.

### Why this approach

- It fits the current FastAPI architecture without introducing external auth infrastructure.
- It keeps role enforcement in the same backend that already owns threads/files/runs.
- It is enough for local/dev and can later be swapped behind the same dependency boundary if SSO is needed.

### Recommended mechanics

- Store users in PostgreSQL with password hashes only, never plaintext passwords.
- Use `argon2id` or `bcrypt` through `pwdlib`/`passlib`; prefer `argon2id` if the team is comfortable adding a small dependency.
- Issue short-lived access tokens and longer-lived refresh tokens.
- Keep refresh tokens server-side as hashed records so they can be revoked.
- Deliver tokens via `HttpOnly`, `Secure`, `SameSite=Lax` cookies for the web UI.
- Keep bearer token support available for future API clients and tests.

## Roles And Permissions

### Role definitions

#### `super_admin`

- Create `admin` users
- Create `user` users
- View all users
- Deactivate or reactivate accounts
- Reset passwords
- View all threads, runs, messages, and artifacts for support/audit workflows
- Delete any thread if product policy allows it
- Access all `admin` and `user` capabilities

#### `admin`

- Create `user` users
- View users they are allowed to manage
- Reset passwords for `user` accounts if policy allows it
- Access all application functionality needed to operate the system
- View all non-privileged operational data if product policy allows it
- Cannot create or elevate another `admin`
- Cannot promote anyone to `super_admin`

#### `user`

- Sign in and manage their own session
- Create, read, update, and delete only their own threads
- Access only their own files, runs, messages, events, and artifacts
- Use the DeepAgents-powered system within their own thread scope

### Permission enforcement strategy

Implement authorization at two layers:

1. Route-level role checks
2. Resource-level ownership checks

Role checks decide whether an operation category is allowed.
Ownership checks decide whether the caller can touch a specific resource.

Do not treat role checks as a replacement for ownership checks.

## Data Model Changes

Add explicit auth tables instead of relying on implicit `User(id)` creation.

### `users`

Extend the current table with:

- `email` or `username` with a unique index
- `password_hash`
- `role` as enum or constrained string: `super_admin`, `admin`, `user`
- `status`: `active`, `disabled`, `invited`, `password_reset_required`
- `created_by`
- `last_login_at`
- `is_seeded`
- `updated_at`

Recommendation:

- Keep `id` as the stable internal identifier used by threads/runs/messages.
- Use email for login, not for foreign keys.

### `refresh_tokens`

- `id`
- `user_id`
- `token_hash`
- `expires_at`
- `revoked_at`
- `created_at`
- optional audit metadata such as IP/user-agent

### optional `audit_logs`

Strongly recommended for auth and admin actions:

- actor id
- actor role
- action
- target type
- target id
- metadata
- created_at

This should cover:

- login success/failure
- logout
- password reset
- role change
- user creation
- user deactivation
- privileged thread access by admins/super admins

## Bootstrap And Seeding

Create the default `super_admin` during startup or migration-driven bootstrap.

### Required env vars

- `SUPER_ADMIN_EMAIL`
- `SUPER_ADMIN_PASSWORD`
- optional `SUPER_ADMIN_NAME`

### Startup behavior

- On startup, check whether any `super_admin` exists.
- If none exists, create one using the configured credentials.
- Mark the row as `is_seeded = true`.
- Fail startup if required seed credentials are missing in non-development environments.

### Safety rules

- Never log the seeded password.
- Keep `.env.example` updated with these variables but without real values.
- Document rotation steps for the initial seeded account.

## Backend Implementation Plan

### Phase 1: Auth domain and persistence

- Add SQLAlchemy models and migration(s) for user auth fields, refresh tokens, and audit logs.
- Replace implicit user creation in `ThreadRepository._ensure_user(...)` with explicit user existence validation.
- Add repositories/services for:
  - user lookup and creation
  - password hashing and verification
  - refresh token issuing and revocation
  - audit logging

### Phase 2: Authentication API

Add routes such as:

- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `POST /api/admin/users`
- `GET /api/admin/users`
- `PATCH /api/admin/users/{user_id}`
- `POST /api/admin/users/{user_id}/reset-password`

Behavior:

- `login` verifies credentials and sets cookies
- `refresh` rotates refresh tokens
- `logout` revokes the current refresh token and clears cookies
- `me` returns user identity plus role and status

### Phase 3: Replace `X-User-Id` auth dependency

Replace the current `get_current_user()` with a real auth dependency that:

- validates access token or session cookie
- loads the user from the database
- rejects disabled users
- returns a richer `UserContext`

Recommended `UserContext` fields:

- `user_id`
- `email`
- `role`
- `status`
- `is_super_admin`
- `is_admin`

### Phase 4: Authorization utilities

Add reusable dependencies/helpers such as:

- `require_authenticated_user`
- `require_role("admin")`
- `require_role("super_admin")`
- `can_manage_user(actor, target_user)`
- `can_access_thread(actor, thread)`

Role logic should live in one module so route code stays thin.

## Resource Access Rules

### Threads, runs, messages, events, artifacts

For `user`:

- only own records

For `admin` and `super_admin`:

- decide explicitly whether they can inspect all records or only records they created
- if support access is allowed, keep it read-only by default unless a specific write action is needed

Recommended default:

- `admin` and `super_admin` may read all thread data for support/audit
- destructive actions against another user’s thread require an explicit policy decision and audit log

### MinIO object keys

Current keys are thread-scoped, for example:

- `{thread_id}/{file_id}/{filename}`
- `{thread_id}/artifacts/{relative_path}`

That is acceptable only if thread ownership checks remain mandatory before presigning or reading.

Recommended hardening:

- move to `users/{user_id}/threads/{thread_id}/...`

Benefits:

- clearer storage-level tenancy boundaries
- easier forensic inspection
- easier future lifecycle cleanup by user

Migration note:

- support both old and new key formats temporarily if backward compatibility matters

## DeepAgents And Thread Security

This is the most important design area for safe multi-user operation.

### 1. Keep conversation state thread-scoped

DeepAgents runs on LangGraph, and LangGraph persistence is keyed by `thread_id`. The current implementation already sends:

- `config.configurable.thread_id = thread_id`
- runtime `context.user_id = owner_id`

Keep this pattern. Do not reuse a LangGraph `thread_id` across users.

Requirements:

- thread IDs must remain globally unique
- thread lookup must verify ownership or privileged access before a run starts
- if admins can inspect another user’s thread, the action must be deliberate and audited

### 2. Keep sandbox sessions thread-scoped, not assistant-scoped

For this product, use one sandbox session per thread.

Reasoning:

- thread-scoped sandboxes match DeepAgents guidance for chat/data-analysis use cases
- they reduce cross-thread contamination
- they avoid one user inheriting another user’s installed packages, files, or shell history

Do not switch to assistant-scoped sandboxes for a shared multi-user deployment.

### 3. Pass both authenticated `user_id` and `thread_id` into runtime context

Continue sending both identifiers into:

- LangGraph runtime context
- sandbox executor headers
- run/message/event persistence

Extend this by ensuring:

- the authenticated identity comes from the validated session, not request headers
- executor APIs never trust caller-supplied `user_id` without backend verification

### 4. Treat long-term memory as scoped data, not shared global state

If long-term memory is added later, do not use one shared writable memory file for all users.

Recommended policy:

- user preferences or personal context: user-scoped memory namespace
- organization-wide instructions and safety policies: read-only shared memory
- per-thread transient reasoning: keep in LangGraph thread state, not long-term memory

Avoid:

- writable shared memory files across users
- letting user conversations write into global prompt/policy memory
- storing secrets, credentials, or regulated data in agent-editable memory

### 5. Keep secrets outside the sandbox

DeepAgents documentation is explicit here: do not inject secrets into the sandbox and rely on the model to behave.

For this app:

- MinIO credentials stay in backend/executor config, never in agent-editable files
- database credentials stay server-side
- future third-party API keys should be exposed through host-side tools or proxies, not raw env vars in sandbox sessions

### 6. Guard admin support workflows carefully

If admins or super admins can open another user’s thread:

- use explicit support-mode endpoints, not the normal self-service endpoints
- visually label the session in the UI as privileged access
- create audit records for every privileged read/write
- avoid running new agent steps in a user’s thread unless the product truly requires it

Recommended default:

- admins may inspect thread history and artifacts
- only the owning user initiates new DeepAgents runs in that thread unless there is a documented override workflow

## Frontend Implementation Plan

### Session and identity

- Remove the static `VITE_DEFAULT_USER_ID` request model.
- Add auth state bootstrapped from `GET /api/auth/me`.
- Add login screen and logout control.
- Surface current user identity and role in the UI.

### Admin UX

Add an admin area for:

- creating users
- creating admins only when actor is `super_admin`
- viewing status and role
- resetting passwords
- disabling accounts

### Thread UX

- normal users only see their own threads
- admin/super_admin support views should be separate from the normal sidebar to avoid accidental cross-tenant access

## Testing Plan

### Backend tests

Add tests for:

- password hashing and login
- access token validation
- refresh token rotation and revocation
- seeded super admin creation
- `super_admin` can create `admin` and `user`
- `admin` can create `user` but not `admin`
- `user` cannot create accounts
- disabled users cannot authenticate

### Authorization tests

Add matrix tests covering:

- user cannot read another user’s thread
- user cannot access another user’s files or presigned URLs
- user cannot read another user’s runs/messages/events
- admin restrictions around creating admins
- privileged support endpoints require admin or super admin
- privileged actions generate audit logs

### DeepAgents/runtime tests

Add tests confirming:

- graph invocations always receive authenticated `user_id` and `thread_id`
- one thread maps to one sandbox session
- a user cannot trigger a run against another user’s thread
- artifact import and workspace staging remain thread-bound
- thread-scoped sandboxes do not leak files between users

### Frontend tests

- login/logout flow
- role-aware route guarding
- admin UI visibility rules
- graceful handling of `401` and `403`

## Rollout Sequence

### Step 1

Add schema changes, seed logic, password hashing, and auth services.

### Step 2

Ship login/logout/me endpoints and replace static user identity in the frontend.

### Step 3

Add RBAC enforcement for admin management routes.

### Step 4

Harden thread/file/run access paths and remove all fallback behavior based on `default_user_id`.

### Step 5

Add audit logging and privileged support workflows.

### Step 6

Optionally migrate MinIO keys to `users/{user_id}/threads/{thread_id}/...`.

## Open Decisions

These should be resolved before implementation starts:

1. Should `admin` be able to read all user threads, or only manage accounts?
2. Should `admin` be allowed to reset passwords for other `admin` users?
3. Should privileged roles be allowed to trigger new agent runs inside another user’s thread?
4. Do we want cookie-based browser auth only, or cookie plus bearer token support?
5. Is adding `argon2` acceptable, or should hashing stay dependency-light with `bcrypt`?
6. Do we want email login, username login, or both?

## Recommendation Summary

- Implement app-managed auth in FastAPI with hashed passwords and rotating refresh tokens.
- Seed exactly one `super_admin` from environment on startup if none exists.
- Keep all normal product data ownership-based.
- Keep DeepAgents persistence and sandbox sessions strictly thread-scoped.
- Pass authenticated `user_id` and `thread_id` into runtime context on every run.
- If long-term memory is introduced, make user memory user-scoped and policy memory read-only shared.
- Keep secrets outside the sandbox and out of agent-editable memory.
- Add audit logs for all privileged actions and any cross-user support access.

## References Used For This Plan

- Local project code:
  - `backend/app/api/auth.py`
  - `backend/app/services/stream_service.py`
  - `backend/app/agent/graph.py`
  - `backend/app/agent/backend.py`
  - `backend/app/db/models.py`
  - `backend/app/db/repositories.py`
  - `frontend/src/lib/api-client.ts`
- DeepAgents references:
  - `reference_modules/deepagents/README.md`
  - `reference_modules/deepagents/deepagents-deploy.md`
- Official docs:
  - https://docs.langchain.com/oss/python/deepagents/memory
  - https://docs.langchain.com/oss/python/deepagents/sandboxes
  - https://docs.langchain.com/oss/python/langgraph/persistence
