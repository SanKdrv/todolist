"""In-process fixed-window rate limiting.

The limiter is intentionally process-local: the current production deployment
uses one uvicorn worker. If the app is scaled to multiple workers/replicas,
this state must move to a shared backend (for example Redis).
"""

from __future__ import annotations

import math
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass

from fastapi import HTTPException, Request


@dataclass(frozen=True)
class Limit:
    requests: int
    window_seconds: int


# Starting policy. Tune after observing real traffic, especially behind NAT.
LIMITS: dict[str, Limit] = {
    "session": Limit(requests=20, window_seconds=60),
    "task_create": Limit(requests=30, window_seconds=60),
    "task_mutation": Limit(requests=120, window_seconds=60),
}


@dataclass
class _Bucket:
    window_start: float
    count: int
    window_seconds: int


class InMemoryFixedWindowLimiter:
    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._lock = threading.Lock()
        self._buckets: dict[tuple[str, str], _Bucket] = {}

    def reset(self) -> None:
        with self._lock:
            self._buckets.clear()

    def check(self, category: str, key: str, limit: Limit) -> tuple[bool, int]:
        now = self._clock()
        bucket_key = (category, key)

        with self._lock:
            self._cleanup(now)
            bucket = self._buckets.get(bucket_key)

            if bucket is None or now - bucket.window_start >= bucket.window_seconds:
                self._buckets[bucket_key] = _Bucket(
                    window_start=now,
                    count=1,
                    window_seconds=limit.window_seconds,
                )
                return True, 0

            if bucket.count >= limit.requests:
                retry_after = max(
                    1,
                    math.ceil(bucket.window_start + bucket.window_seconds - now),
                )
                return False, retry_after

            bucket.count += 1
            return True, 0

    def _cleanup(self, now: float) -> None:
        """Lazily drop windows that can no longer affect a decision."""
        stale = [
            key
            for key, bucket in self._buckets.items()
            if now - bucket.window_start >= bucket.window_seconds
        ]
        for key in stale:
            del self._buckets[key]


limiter = InMemoryFixedWindowLimiter()


def _enforce(category: str, request: Request) -> None:
    policy = LIMITS[category]
    client_host = request.client.host if request.client else "unknown"
    allowed, retry_after = limiter.check(category, client_host, policy)

    if not allowed:
        raise HTTPException(
            status_code=429,
            detail="Rate limit exceeded",
            headers={"Retry-After": str(retry_after)},
        )


def session_rate_limit(request: Request) -> None:
    _enforce("session", request)


def task_create_rate_limit(request: Request) -> None:
    _enforce("task_create", request)


def task_mutation_rate_limit(request: Request) -> None:
    _enforce("task_mutation", request)
