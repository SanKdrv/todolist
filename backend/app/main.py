from fastapi import FastAPI, HTTPException

from app.api.v1.router import api_router
from app.core.middleware import NoStoreMiddleware
from app.db.session import check_db_connection

app = FastAPI(title="TaskFlow API", version="0.1.0")
app.add_middleware(NoStoreMiddleware)
app.include_router(api_router, prefix="/api/v1")


@app.get("/health", tags=["health"])
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health/ready", tags=["health"])
def health_ready() -> dict[str, str]:
    """Readiness probe: PostgreSQL must answer."""
    if not check_db_connection():
        raise HTTPException(status_code=503, detail="Database is unavailable")
    return {"status": "ready"}
