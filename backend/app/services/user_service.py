from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import UTC, datetime

from app.db.repositories import RefreshTokenRepository, UserRecord, UserRepository
from app.security import (
    ALL_ROLES,
    ALL_STATUSES,
    ROLE_ADMIN,
    ROLE_SUPER_ADMIN,
    ROLE_USER,
    STATUS_ACTIVE,
    normalize_email,
)
from app.services.audit_service import AuditService


@dataclass
class UserSummary:
    user_id: str
    email: str
    display_name: str | None
    role: str
    status: str
    created_by: str | None
    is_seeded: bool
    created_at: str
    updated_at: str
    last_login_at: str | None


class UserService:
    def __init__(
        self,
        repository: UserRepository,
        audit_service: AuditService,
        refresh_token_repository: RefreshTokenRepository,
    ) -> None:
        self._repository = repository
        self._audit_service = audit_service
        self._refresh_token_repository = refresh_token_repository

    def list_users(self) -> list[dict[str, object]]:
        return [
            asdict(self._to_summary(record)) for record in self._repository.list_users()
        ]

    def get_user_by_id(self, user_id: str) -> dict[str, object] | None:
        record = self._repository.get_by_id(user_id)
        return None if record is None else asdict(self._to_summary(record))

    def get_active_user_by_id(self, user_id: str) -> dict[str, object] | None:
        record = self._repository.get_by_id(user_id)
        if record is None or record.status != STATUS_ACTIVE:
            return None
        return asdict(self._to_summary(record))

    def get_user_by_email(self, email: str) -> dict[str, object] | None:
        record = self._repository.get_by_email(normalize_email(email))
        return None if record is None else asdict(self._to_summary(record))

    def create_user(
        self,
        *,
        actor_id: str,
        actor_role: str,
        email: str,
        display_name: str | None,
        password_hash: str,
        role: str,
    ) -> dict[str, object]:
        self._assert_can_assign_role(actor_role=actor_role, role=role)
        normalized_email = normalize_email(email)
        if self._repository.get_by_email(normalized_email) is not None:
            raise ValueError("A user with that email already exists")
        record = self._repository.create_user(
            email=normalized_email,
            display_name=display_name.strip() if display_name else None,
            password_hash=password_hash,
            role=role,
            status=STATUS_ACTIVE,
            created_by=actor_id,
            is_seeded=False,
        )
        self._audit_service.log(
            action="user_created",
            actor_id=actor_id,
            actor_role=actor_role,
            target_type="user",
            target_id=record.user_id,
            payload={"email": record.email, "role": record.role},
        )
        return asdict(self._to_summary(record))

    def update_user(
        self,
        *,
        actor_id: str,
        actor_role: str,
        user_id: str,
        display_name: str | None = None,
        role: str | None = None,
        status: str | None = None,
    ) -> dict[str, object]:
        target = self._repository.get_by_id(user_id)
        if target is None:
            raise ValueError("User not found")
        self._assert_can_manage_target(actor_role=actor_role, target_role=target.role)
        if role is not None:
            if role not in ALL_ROLES:
                raise ValueError("Invalid role")
            self._assert_can_assign_role(actor_role=actor_role, role=role)
        if status is not None and status not in ALL_STATUSES:
            raise ValueError("Invalid status")

        record = self._repository.update_user(
            user_id=user_id,
            display_name=(
                display_name.strip()
                if isinstance(display_name, str) and display_name.strip()
                else display_name
            ),
            role=role,
            status=status,
        )
        sessions_revoked = 0
        if self._has_sensitive_session_change(target=target, role=role, status=status):
            sessions_revoked = self._refresh_token_repository.revoke_all_tokens_for_user(user_id)
        self._audit_service.log(
            action="user_updated",
            actor_id=actor_id,
            actor_role=actor_role,
            target_type="user",
            target_id=user_id,
            payload={"role": role, "status": status, "sessions_revoked": sessions_revoked},
        )
        return asdict(self._to_summary(record))

    def reset_password(
        self,
        *,
        actor_id: str,
        actor_role: str,
        user_id: str,
        password_hash: str,
    ) -> dict[str, object]:
        target = self._repository.get_by_id(user_id)
        if target is None:
            raise ValueError("User not found")
        self._assert_can_manage_target(actor_role=actor_role, target_role=target.role)
        record = self._repository.update_password(
            user_id=user_id,
            password_hash=password_hash,
        )
        sessions_revoked = self._refresh_token_repository.revoke_all_tokens_for_user(user_id)
        self._audit_service.log(
            action="password_reset",
            actor_id=actor_id,
            actor_role=actor_role,
            target_type="user",
            target_id=user_id,
            payload={"sessions_revoked": sessions_revoked},
        )
        return asdict(self._to_summary(record))

    def mark_last_login(self, user_id: str) -> None:
        self._repository.update_last_login(
            user_id=user_id, last_login_at=datetime.now(UTC)
        )

    def ensure_seeded_super_admin(
        self,
        *,
        email: str,
        display_name: str | None,
        password_hash: str,
    ) -> None:
        if self._repository.has_role(ROLE_SUPER_ADMIN):
            return
        self._repository.create_user(
            email=normalize_email(email),
            display_name=display_name.strip() if display_name else "Super Admin",
            password_hash=password_hash,
            role=ROLE_SUPER_ADMIN,
            status=STATUS_ACTIVE,
            created_by=None,
            is_seeded=True,
        )

    @staticmethod
    def _assert_can_assign_role(*, actor_role: str, role: str) -> None:
        if role not in ALL_ROLES:
            raise ValueError("Invalid role")
        if actor_role == ROLE_SUPER_ADMIN and role in {ROLE_ADMIN, ROLE_USER}:
            return
        if actor_role == ROLE_ADMIN and role == ROLE_USER:
            return
        raise PermissionError("You are not allowed to assign that role")

    @staticmethod
    def _assert_can_manage_target(*, actor_role: str, target_role: str) -> None:
        if actor_role == ROLE_SUPER_ADMIN and target_role in {ROLE_ADMIN, ROLE_USER}:
            return
        if actor_role == ROLE_ADMIN and target_role == ROLE_USER:
            return
        raise PermissionError("You are not allowed to manage that user")

    @staticmethod
    def _has_sensitive_session_change(
        *,
        target: UserRecord,
        role: str | None,
        status: str | None,
    ) -> bool:
        return (role is not None and role != target.role) or (
            status is not None and status != target.status
        )

    @staticmethod
    def _to_summary(record: UserRecord) -> UserSummary:
        return UserSummary(
            user_id=record.user_id,
            email=record.email,
            display_name=record.display_name,
            role=record.role,
            status=record.status,
            created_by=record.created_by,
            is_seeded=record.is_seeded,
            created_at=record.created_at.isoformat(),
            updated_at=record.updated_at.isoformat(),
            last_login_at=(
                record.last_login_at.isoformat() if record.last_login_at else None
            ),
        )
