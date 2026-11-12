"""Strict session dependency used by future CRUD endpoints.

These tests exercise the real dependency against the test PostgreSQL database
instead of mocking it: no-session requests must not create rows.
"""

from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func, select, update

from app.api.deps import SESSION_REQUIRED_DETAIL, get_current_session
from app.db.session import get_db
from app.models.session import Session

SESSION_URL = "/api/v1/session"


def session_count(db) -> int:
    return db.scalar(select(func.count()).select_from(Session))


def build_protected_app(db_session) -> FastAPI:
    protected_app = FastAPI()

    @protected_app.get("/protected")
    def protected(session: Session = Depends(get_current_session)) -> dict[str, str]:
        return {"session_id": str(session.id)}

    def override_get_db():
        yield db_session

    protected_app.dependency_overrides[get_db] = override_get_db
    return protected_app


def test_protected_endpoint_rejects_missing_cookie(client: TestClient, db_session) -> None:
    before = session_count(db_session)

    with TestClient(build_protected_app(db_session)) as protected:
        response = protected.get("/protected")

    assert response.status_code == 401
    assert response.json()["detail"] == SESSION_REQUIRED_DETAIL
    # A rejected request must not bootstrap a session as a side effect.
    assert session_count(db_session) == before


def test_protected_endpoint_rejects_expired_session(client: TestClient, db_session) -> None:
    created = client.get(SESSION_URL).json()

    db_session.execute(
        update(Session)
        .where(Session.id == UUID(created["id"]))
        .values(expires_at=datetime.now(UTC) - timedelta(seconds=1))
    )
    db_session.commit()
    before = session_count(db_session)

    with TestClient(build_protected_app(db_session)) as protected:
        protected.cookies.set("tf_session", created["id"])
        response = protected.get("/protected")

    assert response.status_code == 401
    assert session_count(db_session) == before


def test_protected_endpoint_rejects_malformed_cookie(client: TestClient, db_session) -> None:
    before = session_count(db_session)

    with TestClient(build_protected_app(db_session)) as protected:
        protected.cookies.set("tf_session", "not-a-uuid")
        response = protected.get("/protected")

    assert response.status_code == 401
    assert session_count(db_session) == before


def test_protected_endpoint_accepts_active_session(client: TestClient, db_session) -> None:
    created = client.get(SESSION_URL).json()
    before = session_count(db_session)

    with TestClient(build_protected_app(db_session)) as protected:
        protected.cookies.set("tf_session", created["id"])
        response = protected.get("/protected")

    assert response.status_code == 200
    assert response.json()["session_id"] == created["id"]
    assert session_count(db_session) == before


def test_protected_endpoint_extends_ttl(client: TestClient, db_session) -> None:
    created = client.get(SESSION_URL).json()
    session_id = UUID(created["id"])

    db_session.execute(
        update(Session)
        .where(Session.id == session_id)
        .values(
            last_activity_at=datetime.now(UTC) - timedelta(hours=2),
            expires_at=datetime.now(UTC) + timedelta(days=10),
        )
    )
    db_session.commit()

    with TestClient(build_protected_app(db_session)) as protected:
        protected.cookies.set("tf_session", created["id"])
        response = protected.get("/protected")

    assert response.status_code == 200
    assert "max-age=2592000" in response.headers["set-cookie"].lower()

    db_session.expire_all()
    stored = db_session.get(Session, session_id)
    assert stored is not None
    assert stored.expires_at > datetime.now(UTC) + timedelta(days=29)
