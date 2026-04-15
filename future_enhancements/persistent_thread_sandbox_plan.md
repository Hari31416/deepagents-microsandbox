# Persistent Thread Sandbox Plan

This document outlines how to move the executor from a per-job sandbox model to a long-lived per-thread sandbox model that starts lazily, stays warm across tool calls, and is cleaned up on explicit delete or idle TTL expiry.

## Why This Is Needed

Today, the backend already treats the executor session as thread-scoped:

- `MicrosandboxBackend` derives a deterministic executor session id from `thread_id` and reuses it across calls (`backend/app/agent/backend.py:49-52`, `backend/app/agent/backend.py:80-88`).
- The backend calls `POST /v1/sessions` before each sandbox operation and accepts `201` or `409`, so the logical session is already long-lived (`backend/app/agent/backend.py:182-187`).

The actual runtime is still short-lived:

- Every execute call creates a fresh job workspace, stages files from storage, boots a new microVM, diffs files back to storage, then deletes the workspace (`microsandbox-executor/service/src/jobs/executor.ts:102-197`).
- `MicrosandboxRuntime` always creates a new sandbox and always destroys it in `finally` (`microsandbox-executor/service/src/runtime/microsandbox_runtime.ts:7-90`).

That means the system already has persistent session identity, but not persistent runtime state.

## Current Constraints

The long-lived design has to respect the current control-plane behavior:

- Session metadata has only TTL, active job count, and file metadata. It does not track runtime leases or live sandbox state (`microsandbox-executor/service/src/metadata/types.ts:3-55`).
- File storage is backed by MinIO and is currently the durable source of truth for uploads, downloads, and rehydration (`microsandbox-executor/service/src/storage/minio.ts:34-126`).
- Cleanup currently deletes storage and metadata only. It does not know about live sandboxes or persistent workspaces (`microsandbox-executor/service/src/sessions/cleanup.ts:31-48`).
- Network policy, image, CPU, and memory are selected per execution request today (`microsandbox-executor/service/src/jobs/models.ts:5-83`, `microsandbox-executor/service/src/policy/network.ts:1-36`). A reused sandbox cannot safely change all of those in place.
- Thread deletion in the backend removes the mapping row, but it does not call the executor to terminate a live session, so "conversation ended" cleanup is not currently wired end to end (`backend/app/db/repositories.py:385-406`).

## Recommended Approach

Use a hybrid design:

1. Keep the executor session as the durable thread-level identity.
2. Add a persistent host workspace per session under `SCRATCH_ROOT`.
3. Add a resident sandbox lease per session that is created on first execute and reused.
4. Keep MinIO as the durable source of truth, but stop re-downloading the full workspace for every job.
5. Persist only deltas back to MinIO after each execute and on shutdown/cleanup.

This keeps latency low without making the live sandbox the only copy of user data.

## Target Behavior

For a single thread:

1. First execute:
   - create or hydrate the session workspace on disk
   - create the sandbox
   - run the command
   - flush changed files back to MinIO
2. Later executes in the same thread:
   - reuse the same workspace
   - reuse the same sandbox if its runtime spec still matches
   - run the command directly
   - flush only changed files
3. Session end:
   - explicit `DELETE /v1/sessions/:sessionId`, thread deletion, executor shutdown, or TTL expiry should terminate the sandbox, remove the workspace, delete storage if requested, and clear metadata

## Proposed Design

### 1. Add a Session Runtime Manager

Create a new executor-side component, for example `SessionRuntimeManager`, responsible for:

- lazy sandbox creation
- session workspace lifecycle
- lease tracking
- spec compatibility checks
- idle cleanup
- shutdown cleanup

Suggested in-memory record:

```ts
interface SessionRuntimeLease {
  sessionId: string;
  sandboxName: string;
  workspacePath: string;
  image: string;
  cpuLimit: number;
  memoryMb: number;
  networkMode: "none" | "allowlist" | "public";
  allowedHostsKey: string;
  lastUsedAt: string;
  dirty: boolean;
  hydrated: boolean;
}
```

This manager should sit between `JobExecutor` and `MicrosandboxRuntime`.

### 2. Make the Workspace Session-Scoped

Replace the per-job workspace:

- current: `${SCRATCH_ROOT}/${sessionId}/${jobId}/workspace` (`microsandbox-executor/service/src/storage/workspace.ts:10-19`)
- proposed: `${SCRATCH_ROOT}/sessions/${sessionId}/workspace`

Behavior:

- hydrate from MinIO only once, on first execution or after recycle
- keep the directory mounted into the sandbox for the life of the lease
- remove it only on session delete, TTL expiry, or runtime recycle

This removes the repeated MinIO `stageFiles()` path for normal tool calls.

### 3. Extend the Runtime API for Reuse

The current runtime contract only supports `executeJob()` (`microsandbox-executor/service/src/runtime/types.ts:1-24`). It should be expanded to support:

- `ensureSandbox(sessionSpec): Promise<LeaseHandle>`
- `execInSandbox(leaseHandle, commandSpec): Promise<RuntimeJobResult>`
- `destroySandbox(sessionId): Promise<void>`
- `destroyAllSandboxes(): Promise<void>`

`MicrosandboxRuntime` should keep sandbox handles alive instead of always cleaning them in `finally`.

### 4. Keep MinIO Durable, But Use Write-Through Sync

Recommended sync rules:

- On first sandbox creation:
  - hydrate the host workspace from MinIO once
- On file upload API:
  - continue writing to MinIO
  - if the session workspace is active, also write the file into the live workspace immediately
- On execute completion:
  - diff the live workspace against the last persisted manifest
  - upload only changed files to MinIO
  - record updated file metadata
- On file delete support:
  - delete from both live workspace and MinIO
  - update metadata accordingly

This is important because the current diff logic only uploads changed files and does not model deletions (`microsandbox-executor/service/src/jobs/manifests.ts:19-39`).

### 5. Introduce a Runtime Spec Compatibility Rule

A warm sandbox should only be reused when these inputs match:

- runtime image
- CPU limit
- memory limit
- network mode
- allowlist hosts

If a new execution request changes any of those, the executor should:

1. flush dirty files
2. destroy the existing sandbox
3. create a new sandbox on the same session workspace, or rebuild the workspace if required

Do not silently widen privileges in a reused sandbox.

### 6. Cleanup Must Become Runtime-Aware

Update cleanup flows so they terminate live sandboxes in addition to deleting storage:

- session TTL cleanup in the executor
- explicit session delete API
- process shutdown
- backend thread deletion

The current cleanup service only deletes storage and metadata (`microsandbox-executor/service/src/sessions/cleanup.ts:31-48`), so long-lived sandboxes would otherwise leak.

## Implementation Plan

### Phase 1: MVP

Goal: keep one sandbox and one workspace alive per session inside a single executor process.

Changes:

- add `SessionRuntimeManager`
- make workspace session-scoped instead of job-scoped
- change `MicrosandboxRuntime` to create, reuse, and destroy sandboxes on demand
- update `JobExecutor` to:
  - resolve or create the session lease
  - hydrate once
  - run commands in the resident sandbox
  - persist changed files after each run
- update upload route so active sessions receive uploaded files in their live workspace as well as MinIO
- update session delete and TTL cleanup to terminate the lease and remove the session workspace

Effort:

- 3 to 5 engineering days

Risk:

- medium

Notes:

- This version can keep lease state in memory.
- If the executor restarts, it can simply reap any leftover sandbox names on boot and rebuild from MinIO on demand.

### Phase 2: Production Hardening

Goal: make the design resilient to restarts, failures, and operational edge cases.

Changes:

- add persistent runtime bookkeeping, either by extending session metadata or adding a new runtime lease table
- add startup reconciliation:
  - detect orphaned workspaces
  - detect orphaned microsandboxes
  - remove or recover them deterministically
- add explicit dirty-state handling when MinIO flush fails
- add deletion tracking in manifests and metadata
- add metrics and structured logs for:
  - sandbox create time
  - sandbox reuse hit rate
  - flush duration
  - lease count
  - idle reaper events

Effort:

- 2 to 4 engineering days after Phase 1

Risk:

- medium

### Phase 3: Backend Lifecycle Integration

Goal: align sandbox cleanup with thread lifecycle instead of relying only on TTL.

Changes:

- when a thread is deleted, call executor session delete before dropping the thread record
- optionally add a backend-side "thread idle" policy if "conversation ends" should mean "no runs for N minutes"
- make the backend surface sandbox reuse metrics in admin views if needed

Effort:

- 1 to 2 engineering days

Risk:

- low to medium

## Estimated Total Effort

Recommended scope:

- MVP: 3 to 5 days
- production-ready version: 6 to 9 days

If restart recovery and deletion semantics are treated as mandatory from day one, plan for the upper half of that range.

## Security Concerns

### 1. Privilege Drift

Risk:

- a sandbox created with broader network access, larger memory, or a different image could be accidentally reused for a later request with stricter requirements

Mitigation:

- compute a runtime spec hash from image, CPU, memory, network mode, and allowlist
- recycle the sandbox whenever the spec changes

### 2. Cross-Thread Contamination

Risk:

- a bookkeeping bug could attach the wrong live workspace or sandbox to the wrong session

Mitigation:

- key all runtime leases by executor session id
- keep the existing `SessionLockManager` serialization per session (`microsandbox-executor/service/src/sessions/locks.ts:1-21`)
- include session id and sandbox name in every log line

### 3. Orphaned Sandboxes After Crash

Risk:

- if the executor dies, microVMs may remain alive with mounted workspaces

Mitigation:

- enforce a sandbox naming convention tied to session id
- on boot, list known sandboxes and remove any orphaned or stale entries
- do the same for persistent workspace directories

### 4. Dirty Workspace Not Persisted

Risk:

- a command may succeed in the sandbox, but MinIO flush may fail, leaving the live workspace ahead of durable storage

Mitigation:

- track a `dirty` flag per lease
- block lease destruction until a final flush is attempted
- on restart, prefer the durable copy unless an explicit recovery policy is implemented

### 5. Session Delete Semantics

Risk:

- deleting the backend thread record without calling the executor can leave the sandbox running until TTL cleanup

Mitigation:

- add explicit executor session deletion to thread teardown
- treat executor cleanup failure as a warning with retry or deferred cleanup

## Bookkeeping Requirements

At minimum, the executor needs to track:

- session id
- sandbox name
- workspace path
- runtime spec hash
- last used timestamp
- last flush timestamp
- dirty flag
- hydrated flag

Optional but useful:

- sandbox creation time
- total executions on the lease
- total bytes flushed
- last flush error

## Recommendation

Build this in two steps:

1. ship the executor-only MVP with in-memory leases, persistent workspaces, sandbox reuse, and TTL cleanup
2. then harden restart recovery, deletion semantics, and metrics

That gets most of the latency benefit quickly without making the durability model fragile.
