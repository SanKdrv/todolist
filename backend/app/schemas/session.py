from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class SessionRead(BaseModel):
    id: UUID
    csrf_token: str
    expires_at: datetime
    is_new: bool
