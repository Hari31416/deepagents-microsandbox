# Backend Authorization (RBAC)

The DeepAgent Sandbox implements a robust Role-Based Access Control (RBAC) system defined in the `app/security.py` module and enforced throughout the service layer.

## Roles Hierarchy

The system defines three distinct roles, each with increasing levels of authority.

| Role Const | Value | Description |
| :--- | :--- | :--- |
| `ROLE_SUPER_ADMIN` | `super_admin` | Absolute control; management of all users and resources. |
| `ROLE_ADMIN` | `admin` | Elevated visibility; can view all threads/messages but cannot manage Super Admins. |
| `ROLE_USER` | `user` | Standard access; limited strictly to their own data. |

## Permission Enforcement Pattern

Permissions are checked at the **Service Layer** to ensure that even if an API endpoint is exposed, the underlying data access is protected.

### 1. The "Privileged Role" Concept
A core utility function `is_privileged_role(role)` determines if an actor is an Admin or Super Admin.

```python
def is_privileged_role(role: str) -> bool:
    return role in {ROLE_SUPER_ADMIN, ROLE_ADMIN}
```

### 2. Thread Visibility Logic
In the `ThreadService`, listing threads uses this check to decide whether to apply an `owner_id` filter.

```python
def list_threads(self, actor_user_id: str, actor_role: str):
    if is_privileged_role(actor_role):
        return self._repository.list_all_threads()
    return self._repository.list_threads(owner_id=actor_user_id)
```

### 3. Resource-Level Checks
For specific actions (Update, Delete, View Message), the system uses `get_thread_for_actor` which follows the same privileged logic but also ensures that standard `user` roles can only retrieve threads they own.

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
| List ALL Threads | ❌ | ✅ | ✅ |
| Delete Own Thread | ✅ | ✅ | ✅ |
| Delete Any Thread | ❌ | ✅ | ✅ |
| Manage Users | ❌ | ✅ | ✅ |
| Create Super Admin | ❌ | ❌ | ✅ |
