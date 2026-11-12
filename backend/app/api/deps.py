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
from app.services.sessions import ensure_session, touch_session_if_due

CSRF_HEADER = "X-CSRF-Token"


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


def get_session_context(
    request: Request,
    response: Response,
    db: DbSession = Depends(get_db),
) -> SessionContext:
    """Resolve the current anonymous session for every request.

    Order of operations:
    1. read the session id from the cookie (malformed -> treated as absent);
    2. look it up with the TTL check (expired -> absent);
    3. create a new session when needed;
    4. extend the sliding TTL when the touch interval has passed;
    5. (re)issue the cookie whenever the session is new or was extended.
    """
    session_id = parse_session_id(request.cookies.get(settings.cookie_name))
    session, is_new = ensure_session(db, session_id)
    touched = touch_session_if_due(db, session)

    if is_new or touched:
        set_session_cookie(response, session)

    request.state.session = session
    return SessionContext(session=session, is_new=is_new)


def get_current_session(
    context: SessionContext = Depends(get_session_context),
) -> Session:
    """The session itself, for handlers that do not need ``is_new``."""
    return context.session


def require_csrf(
    request: Request,
    context: SessionContext = Depends(get_session_context),
) -> None:
    """Reject unsafe requests without a valid session-bound CSRF token.

    Not attached to any route yet - CRUD endpoints will depend on it.
    """
    provided = request.headers.get(CSRF_HEADER)
    if not verify_csrf_token(context.session.csrf_token, provided):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="CSRF token missing or invalid",
        )
