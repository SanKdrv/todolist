from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.api.deps import SessionContext, get_session_context, require_csrf
from app.core.security import generate_csrf_token, verify_csrf_token


def test_verify_csrf_token() -> None:
    token = generate_csrf_token()

    assert len(token) >= 32
    assert verify_csrf_token(token, token) is True
    assert verify_csrf_token(token, token[:-1] + "x") is False
    assert verify_csrf_token(token, "") is False
    assert verify_csrf_token(token, None) is False


def test_require_csrf_dependency(db_session) -> None:
    """The dependency is ready for CRUD routes but is not attached to any yet."""
    from app.services.sessions import create_session

    session = create_session(db_session)

    app = FastAPI()

    @app.get("/protected")
    def protected(_: None = Depends(require_csrf)) -> dict[str, bool]:
        return {"ok": True}

    app.dependency_overrides[get_session_context] = lambda: SessionContext(
        session=session,
        is_new=False,
    )

    with TestClient(app) as client:
        assert client.get("/protected").status_code == 403
        assert client.get("/protected", headers={"X-CSRF-Token": "wrong"}).status_code == 403
        assert (
            client.get("/protected", headers={"X-CSRF-Token": session.csrf_token}).status_code
            == 200
        )
