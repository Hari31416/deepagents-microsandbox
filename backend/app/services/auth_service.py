from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.config import Settings
from app.db.repositories import (
    RefreshTokenRecord,
    RefreshTokenRepository,
    UserRepository,
)
from app.security import (
    STATUS_ACTIVE,
    TOKEN_TYPE_ACCESS,
    create_refresh_token,
    create_signed_token,
    hash_password,
    hash_refresh_token,
    normalize_email,
    parse_signed_token,
    verify_password,
)
from app.services.audit_service import AuditService
from app.services.login_throttle_service import LoginThrottleService
from app.services.user_service import UserService


class AuthService:
    def __init__(
        self,
        *,
        settings: Settings,
        user_repository: UserRepository,
        refresh_token_repository: RefreshTokenRepository,
        user_service: UserService,
        audit_service: AuditService,
        login_throttle_service: LoginThrottleService,
    ) -> None:
        self._settings = settings
        self._user_repository = user_repository
        self._refresh_token_repository = refresh_token_repository
        self._user_service = user_service
        self._audit_service = audit_service
        self._login_throttle_service = login_throttle_service

    def ensure_seeded_super_admin(self) -> None:
        self._user_service.ensure_seeded_super_admin(
            email=self._settings.super_admin_email,
            display_name=self._settings.super_admin_name,
            password_hash=hash_password(self._settings.super_admin_password),
        )

    def authenticate(
        self,
        *,
        email: str,
        password: str,
        client_ip: str | None = None,
    ) -> dict[str, object]:
        normalized_email = normalize_email(email)
        self._login_throttle_service.check_allowed(
            email=normalized_email,
            client_ip=client_ip,
        )
        user = self._user_repository.get_by_email(normalized_email)
        if user is None or not verify_password(password, user.password_hash):
            self._login_throttle_service.record_failure(
                email=normalized_email,
                client_ip=client_ip,
            )
            self._audit_service.log(
                action="login_failed",
                actor_id=None,
                actor_role=None,
                target_type="user",
                target_id=user.user_id if user else None,
                payload={"email": normalized_email},
            )
            raise ValueError("Invalid email or password")
        if user.status != STATUS_ACTIVE:
            self._login_throttle_service.record_failure(
                email=normalized_email,
                client_ip=client_ip,
            )
            raise PermissionError("Your account is disabled")

        self._user_service.mark_last_login(user.user_id)
        session = self._issue_session(user_id=user.user_id)
        fresh_user = self._user_service.get_active_user_by_id(user.user_id)
        if fresh_user is None:
            raise PermissionError("Your account is disabled")
        self._login_throttle_service.record_success(
            email=normalized_email,
            client_ip=client_ip,
        )
        self._audit_service.log(
            action="login_succeeded",
            actor_id=user.user_id,
            actor_role=user.role,
            target_type="user",
            target_id=user.user_id,
        )
        return {"user": fresh_user, **session}

    def refresh_session(self, refresh_token: str) -> dict[str, object]:
        record = self._get_valid_refresh_token(refresh_token)
        self._refresh_token_repository.revoke_token(record.token_id)
        session = self._issue_session(user_id=record.user_id)
        user = self._user_service.get_active_user_by_id(record.user_id)
        if user is None:
            raise PermissionError("Your account is disabled")
        return {"user": user, **session}

    def logout(self, refresh_token: str | None) -> None:
        if not refresh_token:
            return
        token_hash = hash_refresh_token(refresh_token)
        record = self._refresh_token_repository.get_active_by_hash(token_hash)
        if record is None:
            return
        self._refresh_token_repository.revoke_token(record.token_id)
        user = self._user_repository.get_by_id(record.user_id)
        self._audit_service.log(
            action="logout",
            actor_id=record.user_id,
            actor_role=user.role if user else None,
            target_type="user",
            target_id=record.user_id,
        )

    def get_user_from_access_token(self, token: str) -> dict[str, object]:
        payload = parse_signed_token(
            secret_key=self._settings.auth_secret_key,
            token=token,
            expected_type=TOKEN_TYPE_ACCESS,
        )
        user_id = str(payload.get("sub") or "")
        if not user_id:
            raise ValueError("Invalid token subject")
        user = self._user_service.get_active_user_by_id(user_id)
        if user is None:
            raise PermissionError("Authentication required")
        return user

    def _issue_session(self, *, user_id: str) -> dict[str, object]:
        access_expires = timedelta(seconds=self._settings.auth_access_token_ttl_seconds)
        refresh_expires = timedelta(
            seconds=self._settings.auth_refresh_token_ttl_seconds
        )
        access_token = create_signed_token(
            secret_key=self._settings.auth_secret_key,
            subject=user_id,
            token_type=TOKEN_TYPE_ACCESS,
            expires_in=access_expires,
        )
        refresh_token = create_refresh_token()
        refresh_token_hash = hash_refresh_token(refresh_token)
        expires_at = datetime.now(UTC) + refresh_expires
        self._refresh_token_repository.create_token(
            user_id=user_id,
            token_hash=refresh_token_hash,
            expires_at=expires_at,
        )
        return {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "access_token_expires_in": int(access_expires.total_seconds()),
            "refresh_token_expires_in": int(refresh_expires.total_seconds()),
        }

    def _get_valid_refresh_token(self, refresh_token: str) -> RefreshTokenRecord:
        token_hash = hash_refresh_token(refresh_token)
        record = self._refresh_token_repository.get_active_by_hash(token_hash)
        if record is None:
            raise ValueError("Invalid refresh token")
        user = self._user_repository.get_by_id(record.user_id)
        if user is None or user.status != STATUS_ACTIVE:
            raise PermissionError("Your account is disabled")
        return record
