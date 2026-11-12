from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy import func, select, update

from app.core.config import settings
from app.main import app
from app.models.session import Session

SESSION_URL = "/api/v1/session"


def session_count(db) -> int:
    return db.scalar(select(func.count()).select_from(Session))


def parse_set_cookie(response) -> dict[str, str]:
    raw = response.headers["set-cookie"]
    name, _, value = raw.split(";", 1)[0].partition("=")
    return {"name": name, "value": value, "raw": raw}


def seconds_until(expires_at: str) -> float:
    moment = datetime.fromisoformat(expires_at)
    return (moment - datetime.now(UTC)).total_seconds()


def test_creates_new_session(client: TestClient, db_session) -> None:
    response = client.get(SESSION_URL)

    assert response.status_code == 200
    body = response.json()
    assert body["is_new"] is True
    assert len(body["csrf_token"]) >= 32
    assert timedelta(days=29, hours=23) < timedelta(seconds=seconds_until(body["expires_at"]))

    cookie = parse_set_cookie(response)
    assert cookie["name"] == "tf_session"
    assert cookie["value"] == body["id"]
    assert session_count(db_session) == 1

    stored = db_session.get(Session, UUID(body["id"]))
    assert stored is not None
    assert stored.expires_at == datetime.fromisoformat(body["expires_at"])
    assert stored.csrf_token == body["csrf_token"]


def test_reuses_existing_session(client: TestClient, db_session) -> None:
    first = client.get(SESSION_URL).json()
    second_response = client.get(SESSION_URL)
    second = second_response.json()

    assert second["is_new"] is False
    assert second["id"] == first["id"]
    assert second["csrf_token"] == first["csrf_token"]
    assert session_count(db_session) == 1
    # No extension was due, so the cookie must not be re-issued.
    assert "set-cookie" not in second_response.headers


def test_creates_new_session_after_expiry(client: TestClient, db_session) -> None:
    first = client.get(SESSION_URL).json()

    db_session.execute(
        update(Session)
        .where(Session.id == UUID(first["id"]))
        .values(expires_at=datetime.now(UTC) - timedelta(seconds=1))
    )
    db_session.commit()

    second = client.get(SESSION_URL).json()

    assert second["is_new"] is True
    assert second["id"] != first["id"]
    assert second["csrf_token"] != first["csrf_token"]
    # The expired row stays until the cleanup job removes it (stage 4).
    assert session_count(db_session) == 2


def test_missing_or_unknown_cookie_never_exposes_existing_session(
    client: TestClient,
    db_session,
) -> None:
    first = client.get(SESSION_URL).json()

    with TestClient(app) as fresh_client:
        second = fresh_client.get(SESSION_URL).json()

    assert second["id"] != first["id"]

    client.cookies.set("tf_session", str(uuid4()))
    third = client.get(SESSION_URL).json()

    assert third["is_new"] is True
    assert third["id"] not in {first["id"], second["id"]}
    assert session_count(db_session) == 3


def test_malformed_cookie_is_ignored(client: TestClient) -> None:
    client.cookies.set("tf_session", "not-a-uuid")

    response = client.get(SESSION_URL)

    assert response.status_code == 200
    assert response.json()["is_new"] is True


def test_cookie_attributes_in_development(client: TestClient) -> None:
    response = client.get(SESSION_URL)
    raw = response.headers["set-cookie"].lower()

    assert raw.startswith("tf_session=")
    assert "httponly" in raw
    assert "samesite=lax" in raw
    assert "path=/" in raw
    assert "max-age=2592000" in raw
    assert "domain=" not in raw
    assert "secure" not in raw


def test_cookie_attributes_in_production(monkeypatch, client: TestClient) -> None:
    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(settings, "session_cookie_name", None)
    monkeypatch.setattr(settings, "session_cookie_secure", None)

    response = client.get(SESSION_URL)
    raw = response.headers["set-cookie"].lower()

    assert raw.startswith("__host-tf_session=")
    assert "secure" in raw
    assert "; path=/" in raw
    assert "domain=" not in raw
    assert "httponly" in raw
    assert "samesite=lax" in raw
    assert "max-age=2592000" in raw


def test_response_is_not_cacheable(client: TestClient) -> None:
    response = client.get(SESSION_URL)

    assert response.headers["cache-control"] == "no-store"


def test_activity_extends_ttl_and_cookie(client: TestClient, db_session) -> None:
    first = client.get(SESSION_URL).json()
    session_id = UUID(first["id"])

    stale_moment = datetime.now(UTC) - timedelta(hours=2)
    db_session.execute(
        update(Session)
        .where(Session.id == session_id)
        .values(
            last_activity_at=stale_moment,
            expires_at=datetime.now(UTC) + timedelta(days=10),
        )
    )
    db_session.commit()

    response = client.get(SESSION_URL)
    body = response.json()

    assert body["is_new"] is False
    assert body["id"] == first["id"]
    assert timedelta(days=29, hours=23) < timedelta(seconds=seconds_until(body["expires_at"]))
    assert "max-age=2592000" in response.headers["set-cookie"].lower()

    db_session.expire_all()
    stored = db_session.get(Session, session_id)
    assert stored is not None
    assert stored.last_activity_at > stale_moment


def test_cookie_is_not_reissued_within_touch_interval(client: TestClient, db_session) -> None:
    first = client.get(SESSION_URL).json()
    before = db_session.get(Session, UUID(first["id"])).expires_at

    response = client.get(SESSION_URL)

    db_session.expire_all()
    after = db_session.get(Session, UUID(first["id"])).expires_at
    assert "set-cookie" not in response.headers
    assert after == before
