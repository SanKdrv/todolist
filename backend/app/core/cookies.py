"""Session cookie policy.

Every cookie attribute lives here; routes and dependencies never build
cookie options themselves. This keeps the dev/production difference
(name and Secure flag) in a single place.
"""

from datetime import UTC, datetime
from math import ceil

from fastapi import Response

from app.core.config import settings
from app.models.session import Session

COOKIE_PATH = "/"
COOKIE_SAMESITE = "lax"
COOKIE_HTTPONLY = True


def cookie_max_age(session: Session, now: datetime | None = None) -> int:
    """Seconds until the server-side expiry, rounded up.

    The cookie lifetime is derived from ``expires_at`` itself, so Max-Age and
    the database expiry can never drift apart.
    """
    now = now or datetime.now(UTC)
    return max(0, ceil((session.expires_at - now).total_seconds()))


def set_session_cookie(
    response: Response,
    session: Session,
    now: datetime | None = None,
) -> None:
    response.set_cookie(
        key=settings.cookie_name,
        value=str(session.id),
        max_age=cookie_max_age(session, now),
        path=COOKIE_PATH,
        domain=None,  # required by the __Host- prefix
        secure=settings.cookie_secure,
        httponly=COOKIE_HTTPONLY,
        samesite=COOKIE_SAMESITE,
    )
