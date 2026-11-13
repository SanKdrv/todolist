from fastapi import APIRouter, Depends

from app.api.deps import SessionContext, get_session_context
from app.core.rate_limit import session_rate_limit
from app.schemas.session import SessionRead

router = APIRouter(tags=["session"])


@router.get(
    "/session",
    response_model=SessionRead,
    summary="Get or create the anonymous browser session",
    dependencies=[Depends(session_rate_limit)],
)
def read_session(
    context: SessionContext = Depends(get_session_context),
) -> SessionRead:
    """Return the caller's session, creating one when absent or expired.

    This is the only endpoint that bootstraps a session. Caching is disabled
    globally by ``NoStoreMiddleware``.
    """
    session = context.session
    return SessionRead(
        id=session.id,
        csrf_token=session.csrf_token,
        expires_at=session.expires_at,
        is_new=context.is_new,
    )
