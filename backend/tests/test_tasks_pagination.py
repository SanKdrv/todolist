"""Filtering, sorting and offset pagination."""

from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import update

from app.models.task import Task
from tests.helpers import TASKS_URL, AuthedSession, bootstrap, create_task


def seed(session: AuthedSession, total: int, completed: int) -> list[dict]:
    assert completed <= total
    return [
        create_task(session, title=f"task-{index:02d}", is_completed=index < completed)
        for index in range(total)
    ]


def task_ids(session: AuthedSession, query: str = "") -> list[int]:
    suffix = f"?{query}" if query else ""
    body = session.client.get(f"{TASKS_URL}{suffix}").json()
    return [item["id"] for item in body["items"]]


def set_created_at(db_session, task_id: int, moment: datetime) -> None:
    db_session.execute(update(Task).where(Task.id == task_id).values(created_at=moment))
    db_session.commit()
    db_session.expire_all()


def test_status_all(client: TestClient) -> None:
    session = bootstrap(client)
    seed(session, total=5, completed=2)

    body = session.client.get(f"{TASKS_URL}?status=all").json()

    assert body["total"] == 5
    assert len(body["items"]) == 5


def test_default_status_returns_all_tasks(client: TestClient) -> None:
    session = bootstrap(client)
    seed(session, total=5, completed=2)

    body = session.client.get(TASKS_URL).json()

    assert body["total"] == 5
    assert len(body["items"]) == 5
    assert {item["is_completed"] for item in body["items"]} == {True, False}


def test_status_active(client: TestClient) -> None:
    session = bootstrap(client)
    seed(session, total=5, completed=2)

    body = session.client.get(f"{TASKS_URL}?status=active").json()

    assert body["total"] == 3
    assert len(body["items"]) == 3
    assert all(item["is_completed"] is False for item in body["items"])


def test_status_completed(client: TestClient) -> None:
    session = bootstrap(client)
    seed(session, total=5, completed=2)

    body = session.client.get(f"{TASKS_URL}?status=completed").json()

    assert body["total"] == 2
    assert len(body["items"]) == 2
    assert all(item["is_completed"] is True for item in body["items"])


def test_default_order_is_desc(client: TestClient) -> None:
    session = bootstrap(client)
    created = seed(session, total=3, completed=0)

    assert task_ids(session) == [task["id"] for task in reversed(created)]


def test_order_asc(client: TestClient) -> None:
    session = bootstrap(client)
    created = seed(session, total=3, completed=0)

    assert task_ids(session, "order=asc") == [task["id"] for task in created]


def test_order_desc(client: TestClient) -> None:
    session = bootstrap(client)
    created = seed(session, total=3, completed=0)

    assert task_ids(session, "order=desc") == [task["id"] for task in reversed(created)]


def test_limit_and_offset(client: TestClient) -> None:
    session = bootstrap(client)
    created = seed(session, total=5, completed=0)
    ids = [task["id"] for task in created]

    first_page = session.client.get(f"{TASKS_URL}?order=asc&limit=2&offset=0").json()
    second_page = session.client.get(f"{TASKS_URL}?order=asc&limit=2&offset=2").json()

    assert [item["id"] for item in first_page["items"]] == ids[0:2]
    assert [item["id"] for item in second_page["items"]] == ids[2:4]


def test_has_more_first_middle_last_page(client: TestClient) -> None:
    session = bootstrap(client)
    seed(session, total=5, completed=0)

    first = session.client.get(f"{TASKS_URL}?order=asc&limit=2&offset=0").json()
    middle = session.client.get(f"{TASKS_URL}?order=asc&limit=2&offset=2").json()
    last = session.client.get(f"{TASKS_URL}?order=asc&limit=2&offset=4").json()
    beyond = session.client.get(f"{TASKS_URL}?order=asc&limit=2&offset=10").json()

    assert (len(first["items"]), first["has_more"]) == (2, True)
    assert (len(middle["items"]), middle["has_more"]) == (2, True)
    assert (len(last["items"]), last["has_more"]) == (1, False)
    assert (len(beyond["items"]), beyond["has_more"]) == (0, False)
    # total never depends on the page window.
    assert {first["total"], middle["total"], last["total"], beyond["total"]} == {5}


def test_total_respects_filter_but_not_pagination(client: TestClient) -> None:
    session = bootstrap(client)
    seed(session, total=6, completed=4)

    body = session.client.get(f"{TASKS_URL}?status=completed&limit=1&offset=0").json()
    assert body["total"] == 4
    assert len(body["items"]) == 1
    assert body["has_more"] is True

    tail = session.client.get(f"{TASKS_URL}?status=completed&limit=1&offset=3").json()
    assert tail["total"] == 4
    assert len(tail["items"]) == 1
    assert tail["has_more"] is False


def test_sorting_is_stable_for_equal_created_at(client: TestClient, db_session) -> None:
    session = bootstrap(client)
    created = seed(session, total=5, completed=0)
    same_moment = datetime.now(UTC) - timedelta(days=1)
    for task in created:
        set_created_at(db_session, task["id"], same_moment)

    ascending = []
    for offset in (0, 2, 4):
        ascending.extend(task_ids(session, f"order=asc&limit=2&offset={offset}"))

    descending = []
    for offset in (0, 2, 4):
        descending.extend(task_ids(session, f"order=desc&limit=2&offset={offset}"))

    assert ascending == sorted(task["id"] for task in created)
    assert descending == sorted((task["id"] for task in created), reverse=True)
    assert len(set(ascending)) == len(ascending) == 5
    assert set(ascending) == set(descending)


def test_created_at_is_the_primary_sort_field(client: TestClient, db_session) -> None:
    session = bootstrap(client)
    created = seed(session, total=3, completed=0)
    # Assign timestamps in reverse insertion order.
    base = datetime.now(UTC) - timedelta(days=3)
    for index, task in enumerate(created):
        set_created_at(db_session, task["id"], base + timedelta(days=index))

    assert task_ids(session, "order=asc") == [task["id"] for task in created]
    assert task_ids(session, "order=desc") == [task["id"] for task in reversed(created)]
