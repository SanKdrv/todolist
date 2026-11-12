"""Task API contracts and query-parameter enums."""

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, field_validator

TITLE_MAX_LENGTH = 200


class TaskStatus(StrEnum):
    ALL = "all"
    ACTIVE = "active"
    COMPLETED = "completed"


class TaskSort(StrEnum):
    CREATED_AT = "created_at"


class TaskOrder(StrEnum):
    ASC = "asc"
    DESC = "desc"


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=TITLE_MAX_LENGTH)
    description: str | None = None
    is_completed: bool = False

    @field_validator("title", mode="before")
    @classmethod
    def _strip_title(cls, value: object) -> object:
        """Trim before length checks, so "   " is rejected as empty."""
        return value.strip() if isinstance(value, str) else value


class TaskUpdate(BaseModel):
    """Every field is optional; only explicitly sent fields are applied.

    ``title`` and ``is_completed`` are annotated with their real types, not
    ``| None``: ``None`` is only the "field omitted" marker and is never
    validated against (``validate_default`` stays off). An explicit JSON
    ``null`` therefore fails with 422, while omission is dropped by
    ``model_dump(exclude_unset=True)``. Runtime validation and the published
    JSON Schema stay in agreement: ``type: string`` / ``type: boolean``.
    """

    model_config = ConfigDict(extra="forbid")

    title: str = Field(default=None, min_length=1, max_length=TITLE_MAX_LENGTH)
    description: str | None = None
    is_completed: bool = Field(default=None)

    @field_validator("title", mode="before")
    @classmethod
    def _strip_title(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class TaskRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    description: str | None
    is_completed: bool
    created_at: datetime
    updated_at: datetime


class TaskList(BaseModel):
    items: list[TaskRead]
    total: int
    limit: int
    offset: int
    has_more: bool
