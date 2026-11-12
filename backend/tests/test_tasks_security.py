"""Session isolation, CSRF protection and authentication requirements."""

from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import update

from app.main import app
from app.models.session import Session
from tests.helpers import TASKS_URL, bootstrap, create_task


def test_sessions_are_isolated(client: TestClient) -> None:
    session_a = bootstrap(client)

    with TestClient(app) as second_client:
        session_b = bootstrap(second_client)

        task_a = create_task(session_a, title="A task")
        task_b = create_task(session_b, title="B task")

        list_a = session_a.client.get(TASKS_URL).json()
        list_b = session_b.client.get(TASKS_URL).json()

        assert [item["id"] for item in list_a["items"]] == [task_a["id"]]
        assert list_a["total"] == 1
        assert [item["id"] for item in list_b["items"]] == [task_b["id"]]
        assert list_b["total"] == 1


def test_foreign_task_is_invisible_but_intact(client: TestClient) -> None:
    session_a = bootstrap(client)

    with TestClient(app) as second_client:
        session_b = bootstrap(second_client)
        task_b = create_task(session_b, title="B only")

        read = session_a.client.get(f"{TASKS_URL}/{task_b['id']}")
        patched = session_a.client.patch(
            f"{TASKS_URL}/{task_b['id']}",
            json={"title": "hacked"},
            headers=session_a.headers,
        )
        deleted = session_a.client.delete(
            f"{TASKS_URL}/{task_b['id']}",
            headers=session_a.headers,
        )

        assert read.status_code == 404
        assert patched.status_code == 404
        assert deleted.status_code == 404

        # B still owns the unchanged task.
        assert session_b.client.get(f"{TASKS_URL}/{task_b['id']}").json() == task_b


def test_foreign_and_missing_tasks_are_indistinguishable(client: TestClient) -> None:
    session_a = bootstrap(client)

    with TestClient(app) as second_client:
        session_b = bootstrap(second_client)
        task_b = create_task(session_b)

        foreign = session_a.client.get(f"{TASKS_URL}/{task_b['id']}")
        missing = session_a.client.get(f"{TASKS_URL}/999999999")

        assert foreign.status_code == missing.status_code == 404
        assert foreign.json() == missing.json() == {"detail": "Task not found"}


def test_get_requests_do_not_require_csrf(client: TestClient) -> None:
    session = bootstrap(client)
    created = create_task(session)

    # No X-CSRF-Token header on either request.
    assert session.client.get(TASKS_URL).status_code == 200
    assert session.client.get(f"{TASKS_URL}/{created['id']}").status_code == 200


def test_post_requires_csrf(client: TestClient) -> None:
    session = bootstrap(client)

    missing = session.client.post(TASKS_URL, json={"title": "no token"})
    wrong = session.client.post(
        TASKS_URL,
        json={"title": "bad token"},
        headers={"X-CSRF-Token": "wrong"},
    )
    correct = session.client.post(
        TASKS_URL,
        json={"title": "good token"},
        headers=session.headers,
    )

    assert missing.status_code == 403
    assert wrong.status_code == 403
    assert missing.json() == {"detail": "CSRF token missing or invalid"}
    assert correct.status_code == 201


def test_patch_and_delete_require_csrf(client: TestClient) -> None:
    session = bootstrap(client)
    created = create_task(session)
    url = f"{TASKS_URL}/{created['id']}"

    assert session.client.patch(url, json={"title": "x"}).status_code == 403
    assert session.client.delete(url).status_code == 403
    assert (
        session.client.patch(
            url,
            json={"title": "x"},
            headers={"X-CSRF-Token": "wrong"},
        ).status_code
        == 403
    )
    assert (
        session.client.delete(
            url,
            headers={"X-CSRF-Token": "wrong"},
        ).status_code
        == 403
    )

    # A valid token still works.
    assert (
        session.client.patch(url, json={"title": "renamed"}, headers=session.headers).status_code
        == 200
    )
    assert session.client.delete(url, headers=session.headers).status_code == 204


def test_requests_without_session_return_401(client: TestClient) -> None:
    with TestClient(app) as anonymous:
        assert anonymous.get(TASKS_URL).status_code == 401
        assert anonymous.get(f"{TASKS_URL}/1").status_code == 401
        assert anonymous.post(TASKS_URL, json={"title": "x"}).status_code == 401
        assert anonymous.patch(f"{TASKS_URL}/1", json={"title": "x"}).status_code == 401
        assert anonymous.delete(f"{TASKS_URL}/1").status_code == 401

        assert anonymous.get(TASKS_URL).json() == {"detail": "Active session required"}


def test_expired_session_returns_401(client: TestClient, db_session) -> None:
    session = bootstrap(client)
    db_session.execute(
        update(Session)
        .where(Session.id == UUID(session.id))
        .values(expires_at=datetime.now(UTC) - timedelta(seconds=1))
    )
    db_session.commit()

    assert client.get(TASKS_URL).status_code == 401
    assert client.post(TASKS_URL, json={"title": "x"}, headers=session.headers).status_code == 401


def test_all_api_errors_keep_no_store(client: TestClient) -> None:
    session = bootstrap(client)

    responses = [
        session.client.get(TASKS_URL + "/999999999"),  # 404
        session.client.post(TASKS_URL, json={"title": "x"}),  # 403
        session.client.get(f"{TASKS_URL}?limit=0"),  # 422
    ]

    assert [response.status_code for response in responses] == [404, 403, 422]
    for response in responses:
        assert response.headers["cache-control"] == "no-store"
        assert "detail" in response.json()
