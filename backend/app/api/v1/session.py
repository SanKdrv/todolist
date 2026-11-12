from fastapi import APIRouter, Depends, Response

from app.api.deps import SessionContext, get_session_context
from app.schemas.session import SessionRead

router = APIRouter(tags=["session"])


@router.get(
    "/session",
    response_model=SessionRead,
    summary="Get or create the anonymous browser session",
)
def read_session(
    response: Response,
    context: SessionContext = Depends(get_session_context),
) -> SessionRead:
    """Return the caller's session, creating one when absent or expired.

    The response must never be cached: it carries a CSRF token and may
    silently create a new session.
    """
    response.headers["Cache-Control"] = "no-store"
    session = context.session
    return SessionRead(
        id=session.id,
        csrf_token=session.csrf_token,
        expires_at=session.expires_at,
        is_new=context.is_new,
    )
