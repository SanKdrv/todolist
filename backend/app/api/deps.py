"""Reusable FastAPI dependencies."""

from dataclasses import dataclass
from uuid import UUID

from fastapi import Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session as DbSession

from app.core.config import settings
from app.core.cookies import set_session_cookie
from app.core.security import verify_csrf_token
from app.db.session import get_db
from app.models.session import Session
from app.services.sessions import (
    ensure_session,
    get_active_session,
    touch_session_if_due,
)

CSRF_HEADER = "X-CSRF-Token"
SESSION_REQUIRED_DETAIL = "Active session required"


@dataclass(frozen=True)
class SessionContext:
    session: Session
    is_new: bool


def parse_session_id(raw: str | None) -> UUID | None:
    """Never let a malformed cookie value reach the database."""
    if not raw:
        return None
    try:
        return UUID(raw)
    except ValueError:
        return None


def _resolve_session(
    db: DbSession,
    raw_cookie: str | None,
    *,
    create_missing: bool,
) -> tuple[Session, bool]:
    """Single place where the session is loaded and its TTL is validated.

    ``create_missing=True`` is the bootstrap flavour (GET /session):
    a missing, malformed or expired cookie yields a brand-new session.

    ``create_missing=False`` is the protected-API flavour: the session must
    already exist and be alive, otherwise the caller gets 401 and no row is
    created as a side effect of an unauthenticated request.
    """
    session_id = parse_session_id(raw_cookie)

    if create_missing:
        return ensure_session(db, session_id)

    session = get_active_session(db, session_id) if session_id is not None else None
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=SESSION_REQUIRED_DETAIL,
        )
    return session, False


def _apply_session(
    request: Request,
    response: Response,
    db: DbSession,
    session: Session,
    is_new: bool,
) -> SessionContext:
    """Extend the sliding TTL and keep the cookie in sync with it."""
    touched = touch_session_if_due(db, session)
    if is_new or touched:
        set_session_cookie(response, session)

    request.state.session = session
    return SessionContext(session=session, is_new=is_new)


def get_session_context(
    request: Request,
    response: Response,
    db: DbSession = Depends(get_db),
) -> SessionContext:
    """Bootstrap dependency for ``GET /api/v1/session``.

    Only this dependency may create a session. Protected endpoints must not
    use it, otherwise an unauthenticated request would silently get a session.
    """
    session, is_new = _resolve_session(
        db,
        request.cookies.get(settings.cookie_name),
        create_missing=True,
    )
    return _apply_session(request, response, db, session, is_new)


def get_current_session(
    request: Request,
    response: Response,
    db: DbSession = Depends(get_db),
) -> Session:
    """Strict dependency for protected endpoints.

    Requires an existing, non-expired session cookie; returns 401 otherwise.
    It still extends the sliding TTL and re-issues the cookie when due.
    """
    session, is_new = _resolve_session(
        db,
        request.cookies.get(settings.cookie_name),
        create_missing=False,
    )
    _apply_session(request, response, db, session, is_new)
    return session


def require_csrf(
    request: Request,
    session: Session = Depends(get_current_session),
) -> None:
    """Reject unsafe requests without a valid session-bound CSRF token.

    Not attached to any route yet - CRUD endpoints will depend on it.
    """
    provided = request.headers.get(CSRF_HEADER)
    if not verify_csrf_token(session.csrf_token, provided):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="CSRF token missing or invalid",
        )
