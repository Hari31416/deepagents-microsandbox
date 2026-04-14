# Granular RBAC Implementation Proposal

This document outlines the technical changes required to implement a more secure and granular Role-Based Access Control (RBAC) system for conversation threads in the DeepAgent Sandbox.

## Current State
- **Admins & Super Admins**: Both use `is_privileged_role` which grants total visibility into every thread in the database.
- **Users**: Restricted to only their own threads.

## Proposed Improvement
To align with security best practices, we will refine the visibility hierarchy as follows:

| Role | Visibility |
| :--- | :--- |
| **Super Admin** | Can view **all** threads (Admin, User, and Super Admin). |
| **Admin** | Can view **own** threads and **regular user** threads only. |
| **User** | Can view **only own** threads. |

---

## Implementation Plan

### 1. Backend: Data Layer Changes
We need a more specific query in the `ThreadRepository`.

**File**: `backend/app/db/repositories/thread_repository.py`
- **Add**: `list_admin_visible_threads(admin_id: str)`
- **Logic**: `SELECT * FROM threads WHERE owner_id = :admin_id OR owner_id IN (SELECT id FROM users WHERE role = 'user')`

### 2. Backend: Service Layer Changes
Update the `ThreadService` to distinguish between `admin` and `super_admin`.

**File**: `backend/app/services/thread_service.py`
```python
def list_threads(self, actor_user_id: str, actor_role: str) -> list[dict]:
    if actor_role == ROLE_SUPER_ADMIN:
        # Super admin sees everything
        records = self._repository.list_all_threads()
    elif actor_role == ROLE_ADMIN:
        # Admin sees own + regular users
        records = self._repository.list_threads_for_admin_view(actor_user_id)
    else:
        # Regular user sees only own
        records = self._repository.list_threads(owner_id=actor_user_id)
    
    return [asdict(self._to_record(r)) for r in records]
```

### 3. Backend: Access Check Refinement
Update individual thread retrieval and deletion to ensure an `admin` cannot bypass listing and access a `super_admin` thread directly by ID.

**File**: `backend/app/services/thread_service.py`
- Modify `get_thread_for_actor` to use the same hierarchy logic.

---

## Benefits
- **Privacy for Leadership**: Super Admins can perform sensitive system-wide analysis without regular admins seeing the data.
- **Audit Integrity**: Admins maintain the ability to support and review regular user queries without over-privileging their own accounts.
- **Escalation Prevention**: Limits the "blast radius" if an individual `admin` account is compromised.
