from fastapi import APIRouter

from app.api.v1 import session, tasks

api_router = APIRouter()
api_router.include_router(session.router)
api_router.include_router(tasks.router)
