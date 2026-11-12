from fastapi import APIRouter

from app.api.v1 import session

api_router = APIRouter()
api_router.include_router(session.router)
