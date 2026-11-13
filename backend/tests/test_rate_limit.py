"""Rate limiting tests."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.core import rate_limit
from app.core.rate_limit import InMemoryFixedWindowLimiter, Limit
from app.models.session import Session
from app.models.task import Task
from tests.helpers import SESSION_URL, TASKS_URL, bootstrap, create_task


class FakeClock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


@pytest.fixture()
def fake_limiter(monkeypatch, fake_clock: FakeClock) -> InMemoryFixedWindowLimiter:
    limiter = InMemoryFixedWindowLimiter(clock=fake_clock)
    monkeypatch.setattr(rate_limit, "limiter", limiter)
    return limiter


@pytest.fixture()
def fake_clock() -> FakeClock:
    return FakeClock()


def test_limiter_allows_n_requests_and_reports_retry_after() -> None:
    limiter = InMemoryFixedWindowLimiter(clock=FakeClock())
    policy = Limit(requests=2, window_seconds=60)

    assert limiter.check("session", "192.0.2.1", policy) == (True, 0)
    assert limiter.check("session", "192.0.2.1", policy) == (True, 0)

    allowed, retry_after = limiter.check("session", "192.0.2.1", policy)

    assert allowed is False
    assert retry_after == 60


def test_limiter_window_resets_without_sleeping() -> None:
    clock = FakeClock()
    limiter = InMemoryFixedWindowLimiter(clock=clock)
    policy = Limit(requests=1, window_seconds=60)

    assert limiter.check("session", "192.0.2.1", policy) == (True, 0)
    assert limiter.check("session", "192.0.2.1", policy)[0] is False

    clock.now = 60

    assert limiter.check("session", "192.0.2.1", policy) == (True, 0)


def test_limiter_uses_independent_ip_and_category_buckets() -> None:
    limiter = InMemoryFixedWindowLimiter(clock=FakeClock())
    policy = Limit(requests=1, window_seconds=60)

    assert limiter.check("session", "192.0.2.1", policy)[0] is True
    assert limiter.check("task_create", "192.0.2.1", policy)[0] is True
    assert limiter.check("session", "192.0.2.2", policy)[0] is True

    assert limiter.check("session", "192.0.2.1", policy)[0] is False
    assert limiter.check("task_create", "192.0.2.1", policy)[0] is False
    assert limiter.check("session", "192.0.2.2", policy)[0] is False


def test_limiter_cleanup_removes_expired_windows() -> None:
    clock = FakeClock()
    limiter = InMemoryFixedWindowLimiter(clock=clock)
    policy = Limit(requests=1, window_seconds=60)

    limiter.check("session", "192.0.2.1", policy)
    clock.now = 120
    limiter.check("task_create", "192.0.2.2", policy)

    assert len(limiter._buckets) == 1


def test_session_rate_limit_does_not_create_new_session(
    client: TestClient,
    db_session,
    fake_limiter: InMemoryFixedWindowLimiter,
    monkeypatch,
) -> None:
    monkeypatch.setitem(rate_limit.LIMITS, "session", Limit(1, 60))

    first = client.get(SESSION_URL)
    second = client.get(SESSION_URL)

    assert first.status_code == 200
    assert second.status_code == 429
    assert second.json() == {"detail": "Rate limit exceeded"}
    assert second.headers["retry-after"] == "60"
    assert db_session.scalar(select(func.count()).select_from(Session)) == 1


def test_rate_limited_response_is_not_cacheable(
    client: TestClient,
    fake_limiter: InMemoryFixedWindowLimiter,
    monkeypatch,
) -> None:
    monkeypatch.setitem(rate_limit.LIMITS, "session", Limit(1, 60))

    assert client.get(SESSION_URL).status_code == 200
    rejected = client.get(SESSION_URL)

    assert rejected.status_code == 429
    assert rejected.headers["cache-control"] == "no-store"


def test_create_requires_csrf_and_rate_limit_does_not_create_task(
    client: TestClient,
    db_session,
    fake_limiter: InMemoryFixedWindowLimiter,
    monkeypatch,
) -> None:
    session = bootstrap(client)
    monkeypatch.setitem(rate_limit.LIMITS, "task_create", Limit(2, 60))

    without_csrf = client.post(TASKS_URL, json={"title": "no csrf"})
    created = client.post(
        TASKS_URL,
        json={"title": "created"},
        headers=session.headers,
    )
    rejected = client.post(
        TASKS_URL,
        json={"title": "too many"},
        headers=session.headers,
    )

    assert without_csrf.status_code == 403
    assert created.status_code == 201
    assert rejected.status_code == 429
    assert rejected.json() == {"detail": "Rate limit exceeded"}
    assert rejected.headers["retry-after"] == "60"
    assert db_session.scalar(select(func.count()).select_from(Task)) == 1


def test_patch_and_delete_share_mutation_limit(
    client: TestClient,
    fake_limiter: InMemoryFixedWindowLimiter,
    monkeypatch,
) -> None:
    session = bootstrap(client)
    task = create_task(session, title="original")
    monkeypatch.setitem(rate_limit.LIMITS, "task_mutation", Limit(1, 60))

    patched = client.patch(
        f"{TASKS_URL}/{task['id']}",
        json={"title": "changed"},
        headers=session.headers,
    )
    rejected_delete = client.delete(
        f"{TASKS_URL}/{task['id']}",
        headers=session.headers,
    )
    current = client.get(f"{TASKS_URL}/{task['id']}")

    assert patched.status_code == 200
    assert rejected_delete.status_code == 429
    assert rejected_delete.json() == {"detail": "Rate limit exceeded"}
    assert current.json()["title"] == "changed"


def test_health_and_task_gets_are_not_rate_limited(
    client: TestClient,
    fake_limiter: InMemoryFixedWindowLimiter,
    monkeypatch,
) -> None:
    session = bootstrap(client)
    create_task(session, title="one")
    monkeypatch.setitem(rate_limit.LIMITS, "session", Limit(1, 60))
    monkeypatch.setitem(rate_limit.LIMITS, "task_create", Limit(1, 60))
    monkeypatch.setitem(rate_limit.LIMITS, "task_mutation", Limit(1, 60))

    for _ in range(3):
        assert client.get("/health").status_code == 200
        assert client.get(TASKS_URL).status_code == 200
