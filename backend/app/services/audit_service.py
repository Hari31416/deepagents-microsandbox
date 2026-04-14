from __future__ import annotations

from app.db.repositories import AuditLogRepository


class AuditService:
    def __init__(self, repository: AuditLogRepository) -> None:
        self._repository = repository

    def log(
        self,
        *,
        action: str,
        actor_id: str | None,
        actor_role: str | None,
        target_type: str | None = None,
        target_id: str | None = None,
        payload: dict[str, object] | None = None,
    ) -> None:
        self._repository.create_log(
            actor_id=actor_id,
            actor_role=actor_role,
            action=action,
            target_type=target_type,
            target_id=target_id,
            payload=payload or {},
        )
