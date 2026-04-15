from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from threading import Lock

from app.config import Settings
from app.security import normalize_email


class LoginRateLimitError(Exception):
    pass


@dataclass
class AttemptBucket:
    failures: deque[datetime] = field(default_factory=deque)
    locked_until: datetime | None = None


class LoginThrottleService:
    def __init__(self, settings: Settings) -> None:
        self._max_attempts = settings.auth_login_max_attempts
        self._window = timedelta(seconds=settings.auth_login_window_seconds)
        self._lockout = timedelta(seconds=settings.auth_login_lockout_seconds)
        self._buckets: dict[str, AttemptBucket] = {}
        self._lock = Lock()

    def check_allowed(self, *, email: str, client_ip: str | None) -> None:
        now = datetime.now(UTC)
        keys = self._build_keys(email=email, client_ip=client_ip)
        with self._lock:
            for key in keys:
                bucket = self._get_bucket(key)
                self._prune(bucket, now)
                if bucket.locked_until is not None and bucket.locked_until > now:
                    raise LoginRateLimitError(
                        "Too many login attempts. Try again later."
                    )

    def record_failure(self, *, email: str, client_ip: str | None) -> None:
        now = datetime.now(UTC)
        keys = self._build_keys(email=email, client_ip=client_ip)
        with self._lock:
            for key in keys:
                bucket = self._get_bucket(key)
                self._prune(bucket, now)
                bucket.failures.append(now)
                if len(bucket.failures) >= self._max_attempts:
                    bucket.locked_until = now + self._lockout

    def record_success(self, *, email: str, client_ip: str | None) -> None:
        keys = self._build_keys(email=email, client_ip=client_ip)
        with self._lock:
            for key in keys:
                self._buckets.pop(key, None)

    def _build_keys(self, *, email: str, client_ip: str | None) -> list[str]:
        keys = [f"email:{normalize_email(email)}"]
        if client_ip:
            keys.append(f"ip:{client_ip.strip()}")
        return keys

    def _get_bucket(self, key: str) -> AttemptBucket:
        bucket = self._buckets.get(key)
        if bucket is None:
            bucket = AttemptBucket()
            self._buckets[key] = bucket
        return bucket

    def _prune(self, bucket: AttemptBucket, now: datetime) -> None:
        window_start = now - self._window
        while bucket.failures and bucket.failures[0] < window_start:
            bucket.failures.popleft()
        if bucket.locked_until is not None and bucket.locked_until <= now:
            bucket.locked_until = None
