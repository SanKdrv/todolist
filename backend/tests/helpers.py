"""Shared helpers for task API tests."""

from dataclasses import dataclass

from fastapi.testclient import TestClient

SESSION_URL = "/api/v1/session"
TASKS_URL = "/api/v1/tasks"


@dataclass(frozen=True)
class AuthedSession:
    """A TestClient with its cookie jar plus the session's CSRF token."""

    client: TestClient
    id: str
    csrf_token: str

    @property
    def headers(self) -> dict[str, str]:
        return {"X-CSRF-Token": self.csrf_token}


def bootstrap(client: TestClient) -> AuthedSession:
    response = client.get(SESSION_URL)
    assert response.status_code == 200, response.text
    data = response.json()
    return AuthedSession(
        client=client,
        id=data["id"],
        csrf_token=data["csrf_token"],
    )


def create_task(session: AuthedSession, **overrides: object) -> dict:
    payload: dict[str, object] = {"title": "Task"}
    payload.update(overrides)
    response = session.client.post(TASKS_URL, json=payload, headers=session.headers)
    assert response.status_code == 201, response.text
    return response.json()
