# Backend Authorization (RBAC)

The DeepAgent Sandbox implements a robust Role-Based Access Control (RBAC) system defined in the `app/security.py` module and enforced throughout the service layer.

## Roles Hierarchy

The system defines three distinct roles, each with increasing levels of authority.

| Role Const | Value | Description |
| :--- | :--- | :--- |
| `ROLE_SUPER_ADMIN` | `super_admin` | Absolute control; management of all users and resources. |
| `ROLE_ADMIN` | `admin` | Elevated visibility; can view their own threads plus regular user threads, but cannot access Super Admin or peer Admin threads. |
| `ROLE_USER` | `user` | Standard access; limited strictly to their own data. |

## Permission Enforcement Pattern

Permissions are checked at the **Service Layer** to ensure that even if an API endpoint is exposed, the underlying data access is protected.

### 1. Thread Visibility Logic
In the `ThreadService`, access is role-specific rather than using a single "privileged" branch.

```python
def list_threads(self, actor_user_id: str, actor_role: str):
    if actor_role == ROLE_SUPER_ADMIN:
        return self._repository.list_all_threads()
    if actor_role == ROLE_ADMIN:
        return self._repository.list_admin_visible_threads(actor_user_id)
    return self._repository.list_threads(owner_id=actor_user_id)
```

### 2. Resource-Level Checks
For specific actions (Update, Delete, View Message), the system uses `get_thread_for_actor` with the same hierarchy. This prevents an `admin` from bypassing the list view and directly opening a `super_admin` or peer `admin` thread by ID.

## Audit Logging
All authorization decisions and subsequent data access are logged by the `AuditService`. Key fields logged include:
- `actor_id`: The ID of the person making the request.
- `actor_role`: The role used to authorize the request.
- `resource_id`: The ID of the thread, file, or user being accessed.
- `action`: The nature of the operation (e.g., `READ`, `WRITE`, `DELETE`).

## Data Access Matrix

| Feature | User | Admin | Super Admin |
| :--- | :---: | :---: | :---: |
| Create Thread | ✅ | ✅ | ✅ |
| List Own Threads | ✅ | ✅ | ✅ |
| List User Threads | ❌ | ✅ | ✅ |
| List Peer Admin Threads | ❌ | ❌ | ✅ |
| List Super Admin Threads | ❌ | ❌ | ✅ |
| Delete Own Thread | ✅ | ✅ | ✅ |
| Delete User Thread | ❌ | ✅ | ✅ |
| Delete Peer Admin / Super Admin Thread | ❌ | ❌ | ✅ |
| Manage Users | ❌ | ✅ | ✅ |
| Create Super Admin | ❌ | ❌ | ✅ |
