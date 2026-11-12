"""Session lifecycle: create, read, extend."""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.core.config import settings
from app.core.security import generate_csrf_token
from app.models.session import Session


def utcnow() -> datetime:
    return datetime.now(UTC)


def create_session(db: DbSession, now: datetime | None = None) -> Session:
    """Insert a brand-new anonymous session and return it.

    ``uuid4`` is backed by ``os.urandom``; the CSRF token comes from
    ``secrets.token_urlsafe``. Both are cryptographically secure.
    """
    now = now or utcnow()
    session = Session(
        id=uuid4(),
        csrf_token=generate_csrf_token(),
        created_at=now,
        last_activity_at=now,
        expires_at=now + settings.session_ttl,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def get_active_session(
    db: DbSession,
    session_id: UUID,
    now: datetime | None = None,
) -> Session | None:
    """Return the session only while it has not expired.

    The TTL check runs on every lookup, independently of the cleanup job.
    """
    now = now or utcnow()
    stmt = select(Session).where(
        Session.id == session_id,
        Session.expires_at > now,
    )
    return db.execute(stmt).scalar_one_or_none()


def touch_session_if_due(
    db: DbSession,
    session: Session,
    now: datetime | None = None,
) -> bool:
    """Extend the sliding TTL, at most once per touch interval.

    Returns True when the session was extended, so the caller can re-issue
    the cookie with a matching Max-Age.
    """
    now = now or utcnow()
    if now - session.last_activity_at < settings.session_touch_interval:
        return False

    session.last_activity_at = now
    session.expires_at = now + settings.session_ttl
    db.commit()
    db.refresh(session)
    return True


def ensure_session(
    db: DbSession,
    session_id: UUID | None,
    now: datetime | None = None,
) -> tuple[Session, bool]:
    """Resolve a live session or create a new one.

    Returns ``(session, is_new)``. A missing cookie, a malformed one and an
    expired session all lead to a fresh session - anonymous users should not
    be bounced to an error page.
    """
    now = now or utcnow()
    if session_id is not None:
        existing = get_active_session(db, session_id, now)
        if existing is not None:
            return existing, False

    return create_session(db, now), True
