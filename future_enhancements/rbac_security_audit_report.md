# RBAC Security Audit Report

## Scope

Audit target: backend and frontend RBAC/authentication authorization flow in `backend/app/**`, `backend/tests/**`, and `frontend/src/**`.

Assessed areas:

- Authentication/session controls
- Role enforcement and privilege boundaries
- Object-level access checks (threads/files/runs/events)
- Trust boundaries between frontend and backend
- Configuration hardening and secure defaults

## Executive Summary

The RBAC model is mostly server-enforced and consistent for role-based admin operations (`super_admin`, `admin`, `user`). However, there is a **high-severity object-authorization gap in file download presigning** that can allow cross-thread/cross-tenant data access if object keys are known/guessable. There are also meaningful hardening gaps (unsafe defaults, no auth rate limiting, no session revocation on password reset).

## Current RBAC Model (Observed)

- Roles defined centrally: `super_admin`, `admin`, `user` (`backend/app/security.py:12-15`).
- Request auth derives user context from bearer token or access cookie (`backend/app/api/auth.py:26-43`).
- Admin route gate: `require_admin` (`backend/app/api/auth.py:45-48`) used by `/admin/users*` routes (`backend/app/api/routes/admin.py:30-97`).
- Fine-grained role constraints for user lifecycle are enforced in service layer (`backend/app/services/user_service.py:185-200`).
- Thread-level authorization is performed server-side via actor+role checks (`backend/app/services/thread_service.py:42-57`), and reused across thread/file/chat routes.

## Findings

| ID   | Severity   | Finding                                                                                                                                         | Evidence                                                                                                                                 |
| ---- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| F-01 | **High**   | `presign-download` accepts arbitrary `object_key` without ownership/prefix validation, enabling potential unauthorized object access in bucket. | `backend/app/services/file_service.py:100-137`                                                                                           |
| F-02 | **Medium** | Insecure production-risk defaults for auth secret, super-admin password, and insecure cookies.                                                  | `backend/app/config.py:25,30,31-33`; `.env.example:30-33`                                                                                |
| F-03 | **Medium** | No authentication brute-force/rate-limit controls on login endpoint.                                                                            | `backend/app/api/routes/auth.py:17-27`; `backend/app/services/auth_service.py:49-62`                                                     |
| F-04 | **Medium** | Password reset does not revoke existing active refresh tokens for target user (session persistence after credential rotation).                  | `backend/app/services/user_service.py:135-158`; `backend/app/services/auth_service.py:145-153`; `backend/app/db/repositories.py:247-254` |
| F-05 | **Low**    | Upload completion trusts client-provided `object_key` and metadata; no binding between presign ticket and completion record.                    | `backend/app/services/file_service.py:69-99`                                                                                             |

---

### F-01: Arbitrary object key download presigning (High)

**What happens**

- `/files/presign-download` allows caller to provide `thread_id` plus either `file_id` or `object_key`.
- When `object_key` is provided directly, service does **not** verify it belongs to the thread, DB record, or caller scope.
- It still generates a valid MinIO presigned GET URL for that key.

**Why it matters**

- Any authenticated user with access to _any_ thread can request presigned download URLs for arbitrary bucket objects if they can discover/guess keys.
- This is a direct object-level authorization bypass against tenant/file isolation.

**Exploit sketch**

1. User authenticates normally.
2. Calls `/files/presign-download` with owned `thread_id` + foreign `object_key`.
3. Receives presigned URL and downloads unauthorized object.

**Fix**

- Disallow raw `object_key` input for non-privileged internal paths.
- Resolve download target strictly by `file_id` + `thread_id` from DB.
- Enforce `record.thread_id == thread_id` and key prefix policy (for defense-in-depth).
- If keeping `object_key` input, validate prefix `f"{thread_id}/"` and existence in `thread_files`.

---

### F-02: Weak/insecure default auth settings (Medium)

**What happens**

- Default values include:
  - `auth_secret_key = "deepagent-dev-secret"`
  - `super_admin_password = "ChangeMe123!"`
  - `auth_cookie_secure = False`

**Why it matters**

- Misconfigured deployments may run with predictable credentials/secrets and non-secure cookie transport.
- This materially weakens RBAC integrity by making account/session compromise easier.

**Fix**

- Fail startup in non-dev env when defaults are unchanged.
- Require strong random `AUTH_SECRET_KEY`.
- Require `AUTH_COOKIE_SECURE=true` outside local development.
- Enforce super-admin password bootstrap rotation flow.

---

### F-03: Missing login anti-automation controls (Medium)

**What happens**

- Login endpoint validates credentials but has no rate limiting, temporary lockout, or IP/user throttling.

**Why it matters**

- Password brute-force and credential-stuffing resistance is weak.

**Fix**

- Add per-IP and per-account sliding-window limits (Redis-backed).
- Add progressive delay/temporary lockout after repeated failures.
- Keep audit logs and add alerting thresholds.

---

### F-04: Password reset does not terminate existing sessions (Medium)

**What happens**

- Admin password reset updates hash but does not revoke user refresh tokens.
- Existing sessions continue until token expiry/rotation boundaries.

**Why it matters**

- If account was compromised, password reset alone may not fully evict attacker sessions.

**Fix**

- Add repository method to revoke all active refresh tokens by `user_id`.
- Invoke on password reset and sensitive role/status transitions.
- Optionally introduce token versioning claim to invalidate old access tokens immediately.

---

### F-05: Upload completion trust gap (Low)

**What happens**

- `complete_upload` accepts client-supplied `object_key`, `size`, `content_type`, `filename` without verifying they match previously issued upload ticket.

**Why it matters**

- Can poison metadata and register unintended objects, complicating auditability and file integrity.

**Fix**

- Persist short-lived upload intents/tickets server-side.
- Require completion by `file_id` + ticket verification.
- Validate object key prefix and fetch object metadata from storage before persisting DB record.

## Positive Security Controls

- Strong password hashing with scrypt and constant-time compare (`backend/app/security.py:33-68`).
- Role checks are server-side (not frontend-trusted), including assignment/management constraints (`backend/app/services/user_service.py:185-200`).
- Disabled users are blocked from auth/profile resolution (`backend/app/services/auth_service.py:62-64,114-117`).
- Refresh token storage is hashed and rotated on refresh (`backend/app/services/auth_service.py:79-87,130-137`).
- Thread-level object access checks are consistently reused by chat/files/thread routes (`backend/app/services/thread_service.py:42-57`, `backend/app/api/routes/threads.py:42-47`, `backend/app/api/routes/files.py:41-89`).

## Prioritized Remediation Plan

1. **Patch F-01 immediately**: remove arbitrary `object_key` presigning path for user-facing API and require DB-backed file lookup.
2. **Harden defaults (F-02)**: enforce secure startup guards for secret/password/cookie settings.
3. **Add auth throttling (F-03)**: implement Redis-backed login rate limiting + lockout policy.
4. **Session revocation on reset (F-04)**: revoke all refresh tokens for affected user on password reset/status critical changes.
5. **Bind upload lifecycle (F-05)**: add upload ticket persistence and completion verification.

## Quick Wins (Low effort / high impact)

- Disable `object_key` parameter in `/files/presign-download` API for external clients.
- Add startup validation that rejects default `AUTH_SECRET_KEY` / `SUPER_ADMIN_PASSWORD` in non-dev.
- Set `AUTH_COOKIE_SECURE=true` by default in production deployment configs.
- Add basic per-IP/per-email login rate limit middleware.
- Revoke all refresh tokens in `reset_password`.

## Overall Risk Rating

**Moderate-High** until F-01 is remediated.  
After F-01 + F-02 fixes, residual risk trends to **Moderate** with remaining hardening work.
