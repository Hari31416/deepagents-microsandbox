from __future__ import annotations

import base64
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
import hashlib
import hmac
import json
import secrets
from typing import Any

ROLE_SUPER_ADMIN = "super_admin"
ROLE_ADMIN = "admin"
ROLE_USER = "user"
ALL_ROLES = {ROLE_SUPER_ADMIN, ROLE_ADMIN, ROLE_USER}

STATUS_ACTIVE = "active"
STATUS_DISABLED = "disabled"
ALL_STATUSES = {STATUS_ACTIVE, STATUS_DISABLED}

TOKEN_TYPE_ACCESS = "access"
TOKEN_TYPE_REFRESH = "refresh"


def normalize_email(value: str) -> str:
    return value.strip().lower()


def is_privileged_role(role: str) -> bool:
    return role in {ROLE_SUPER_ADMIN, ROLE_ADMIN}


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=2**14,
        r=8,
        p=1,
        dklen=64,
    )
    return "scrypt$16384$8$1$%s$%s" % (
        base64.urlsafe_b64encode(salt).decode("ascii"),
        base64.urlsafe_b64encode(digest).decode("ascii"),
    )


def verify_password(password: str, password_hash: str) -> bool:
    try:
        algorithm, n_value, r_value, p_value, salt_value, digest_value = (
            password_hash.split("$", 5)
        )
    except ValueError:
        return False
    if algorithm != "scrypt":
        return False
    salt = base64.urlsafe_b64decode(salt_value.encode("ascii"))
    expected_digest = base64.urlsafe_b64decode(digest_value.encode("ascii"))
    computed_digest = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=int(n_value),
        r=int(r_value),
        p=int(p_value),
        dklen=len(expected_digest),
    )
    return hmac.compare_digest(expected_digest, computed_digest)


def create_signed_token(
    *,
    secret_key: str,
    subject: str,
    token_type: str,
    expires_in: timedelta,
    additional_claims: Mapping[str, Any] | None = None,
) -> str:
    now = datetime.now(UTC)
    payload: dict[str, Any] = {
        "sub": subject,
        "typ": token_type,
        "iat": int(now.timestamp()),
        "exp": int((now + expires_in).timestamp()),
    }
    if additional_claims:
        payload.update(dict(additional_claims))
    encoded_payload = _urlsafe_b64encode(
        json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    )
    signature = hmac.new(
        secret_key.encode("utf-8"), encoded_payload.encode("ascii"), hashlib.sha256
    ).digest()
    return f"{encoded_payload}.{_urlsafe_b64encode(signature)}"


def parse_signed_token(
    *, secret_key: str, token: str, expected_type: str
) -> dict[str, Any]:
    try:
        encoded_payload, encoded_signature = token.split(".", 1)
    except ValueError as exc:
        raise ValueError("Invalid token format") from exc

    expected_signature = hmac.new(
        secret_key.encode("utf-8"),
        encoded_payload.encode("ascii"),
        hashlib.sha256,
    ).digest()
    actual_signature = _urlsafe_b64decode(encoded_signature)
    if not hmac.compare_digest(expected_signature, actual_signature):
        raise ValueError("Invalid token signature")

    payload_raw = _urlsafe_b64decode(encoded_payload)
    payload = json.loads(payload_raw.decode("utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("Invalid token payload")
    if payload.get("typ") != expected_type:
        raise ValueError("Invalid token type")
    expires_at = int(payload.get("exp", 0))
    if expires_at <= int(datetime.now(UTC).timestamp()):
        raise ValueError("Token expired")
    return payload


def create_refresh_token() -> str:
    return secrets.token_urlsafe(48)


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _urlsafe_b64encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _urlsafe_b64decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode((value + padding).encode("ascii"))
