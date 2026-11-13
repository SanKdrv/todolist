"""Task CRUD and payload validation."""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import update

from app.models.task import Task
from tests.helpers import TASKS_URL, bootstrap, create_task


def test_create_task(client: TestClient) -> None:
    session = bootstrap(client)

    response = session.client.post(
        TASKS_URL,
        json={"title": "  Write tests  ", "description": "cover CRUD"},
        headers=session.headers,
    )

    assert response.status_code == 201
    body = response.json()
    assert body["title"] == "Write tests"
    assert body["description"] == "cover CRUD"
    assert body["is_completed"] is False
    assert body["id"] > 0
    assert datetime.fromisoformat(body["created_at"]) <= datetime.fromisoformat(body["updated_at"])
    # Session ownership is server-side only and never serialized.
    assert "session_id" not in body


def test_list_returns_own_tasks(client: TestClient) -> None:
    session = bootstrap(client)
    create_task(session, title="first")
    create_task(session, title="second")

    body = session.client.get(TASKS_URL).json()

    assert body["total"] == 2
    assert len(body["items"]) == 2
    assert body["limit"] == 5
    assert body["offset"] == 0
    assert body["has_more"] is False


def test_get_single_task(client: TestClient) -> None:
    session = bootstrap(client)
    created = create_task(session, title="lookup me")

    response = session.client.get(f"{TASKS_URL}/{created['id']}")

    assert response.status_code == 200
    assert response.json() == created


def test_patch_changes_only_sent_fields(client: TestClient) -> None:
    session = bootstrap(client)
    created = create_task(session, title="original", description="keep me")

    body = session.client.patch(
        f"{TASKS_URL}/{created['id']}",
        json={"title": "renamed"},
        headers=session.headers,
    ).json()

    assert body["title"] == "renamed"
    assert body["description"] == "keep me"
    assert body["is_completed"] is False


def test_complete_and_reopen_task(client: TestClient) -> None:
    session = bootstrap(client)
    created = create_task(session)

    completed = session.client.patch(
        f"{TASKS_URL}/{created['id']}",
        json={"is_completed": True},
        headers=session.headers,
    ).json()
    assert completed["is_completed"] is True

    reopened = session.client.patch(
        f"{TASKS_URL}/{created['id']}",
        json={"is_completed": False},
        headers=session.headers,
    ).json()
    assert reopened["is_completed"] is False


def test_description_can_be_cleared_with_null(client: TestClient) -> None:
    session = bootstrap(client)
    created = create_task(session, description="temporary")

    body = session.client.patch(
        f"{TASKS_URL}/{created['id']}",
        json={"description": None},
        headers=session.headers,
    ).json()

    assert body["description"] is None


def test_patch_updates_updated_at(client: TestClient, db_session) -> None:
    session = bootstrap(client)
    created = create_task(session)

    past = datetime.now(UTC) - timedelta(hours=1)
    db_session.execute(
        update(Task).where(Task.id == created["id"]).values(created_at=past, updated_at=past)
    )
    db_session.commit()

    body = session.client.patch(
        f"{TASKS_URL}/{created['id']}",
        json={"title": "touched"},
        headers=session.headers,
    ).json()

    assert datetime.fromisoformat(body["created_at"]) == past
    assert datetime.fromisoformat(body["updated_at"]) > past


def test_empty_patch_is_a_noop(client: TestClient) -> None:
    session = bootstrap(client)
    created = create_task(session)

    response = session.client.patch(
        f"{TASKS_URL}/{created['id']}",
        json={},
        headers=session.headers,
    )

    assert response.status_code == 200
    assert response.json() == created


def test_delete_task_and_get_it_afterwards(client: TestClient) -> None:
    session = bootstrap(client)
    created = create_task(session)

    delete_response = session.client.delete(
        f"{TASKS_URL}/{created['id']}",
        headers=session.headers,
    )
    assert delete_response.status_code == 204
    assert delete_response.content == b""

    assert session.client.get(f"{TASKS_URL}/{created['id']}").status_code == 404
    assert session.client.get(TASKS_URL).json()["total"] == 0


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"title": ""},
        {"title": "     "},
        {"title": "x" * 201},
        {"title": None},
    ],
    ids=["missing", "empty", "whitespace", "too-long", "null"],
)
def test_create_rejects_invalid_title(client: TestClient, payload: dict) -> None:
    session = bootstrap(client)

    response = session.client.post(TASKS_URL, json=payload, headers=session.headers)

    assert response.status_code == 422
    assert "detail" in response.json()


def test_create_accepts_max_length_title(client: TestClient) -> None:
    session = bootstrap(client)

    response = session.client.post(
        TASKS_URL,
        json={"title": "x" * 200},
        headers=session.headers,
    )

    assert response.status_code == 201
    assert response.json()["title"] == "x" * 200


@pytest.mark.parametrize(
    "payload",
    [
        {"title": None},
        {"title": ""},
        {"title": "   "},
        {"title": "x" * 201},
        {"is_completed": None},
    ],
    ids=["null-title", "empty-title", "whitespace-title", "long-title", "null-completed"],
)
def test_patch_rejects_invalid_payload(client: TestClient, payload: dict) -> None:
    session = bootstrap(client)
    created = create_task(session)

    response = session.client.patch(
        f"{TASKS_URL}/{created['id']}",
        json=payload,
        headers=session.headers,
    )

    assert response.status_code == 422


@pytest.mark.parametrize(
    "query",
    [
        "status=done",
        "sort=title",
        "order=up",
        "limit=0",
        "limit=101",
        "offset=-1",
    ],
)
def test_invalid_query_parameters(client: TestClient, query: str) -> None:
    session = bootstrap(client)

    response = session.client.get(f"{TASKS_URL}?{query}")

    assert response.status_code == 422


@pytest.mark.parametrize("query", ["limit=1", "limit=100", "offset=0"])
def test_query_parameter_boundaries(client: TestClient, query: str) -> None:
    session = bootstrap(client)

    assert session.client.get(f"{TASKS_URL}?{query}").status_code == 200


@pytest.mark.parametrize(
    "payload",
    [
        {"created_at": "2020-01-01T00:00:00Z"},
        {"updated_at": "2020-01-01T00:00:00Z"},
        {"session_id": "00000000-0000-0000-0000-000000000000"},
        {"id": 999},
    ],
    ids=["created-at", "updated-at", "session-id", "id"],
)
def test_patch_rejects_unknown_fields(client: TestClient, payload: dict) -> None:
    session = bootstrap(client)
    created = create_task(session)

    response = session.client.patch(
        f"{TASKS_URL}/{created['id']}",
        json=payload,
        headers=session.headers,
    )

    assert response.status_code == 422
    assert "detail" in response.json()


def test_patch_leaves_unsent_optional_fields_untouched(client: TestClient) -> None:
    session = bootstrap(client)
    created = create_task(session, title="stay here", description="keep me")

    body = session.client.patch(
        f"{TASKS_URL}/{created['id']}",
        json={"is_completed": True},
        headers=session.headers,
    ).json()

    assert body["title"] == "stay here"
    assert body["description"] == "keep me"
    assert body["is_completed"] is True
