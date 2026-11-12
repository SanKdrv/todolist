from fastapi import FastAPI

from app.api.v1.router import api_router
from app.core.middleware import NoStoreMiddleware

app = FastAPI(title="TaskFlow API", version="0.1.0")
app.add_middleware(NoStoreMiddleware)
app.include_router(api_router, prefix="/api/v1")


@app.get("/health", tags=["health"])
async def health() -> dict[str, str]:
    return {"status": "ok"}
