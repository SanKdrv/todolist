"""Task business logic.

Transaction boundary: write functions in this module own ``commit`` (via
``_commit``) and roll back on failure. Read functions never commit.
A request uses one SQLAlchemy session, so its reads and writes share a single
transaction; ``get_db`` closes the session, which discards anything uncommitted.

Every query is scoped by ``session_id`` taken from the verified cookie.
A task that does not belong to the session is indistinguishable from a
missing one.
"""

import uuid

from sqlalchemy import Select, delete, func, select
from sqlalchemy.orm import Session as DbSession

from app.models.task import Task
from app.schemas.task import TaskCreate, TaskOrder, TaskStatus, TaskUpdate


def _commit(db: DbSession) -> None:
    """Commit, rolling back first on failure so the session stays usable."""
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise


def _filtered(statement: Select, session_id: uuid.UUID, status: TaskStatus) -> Select:
    statement = statement.where(Task.session_id == session_id)
    if status is TaskStatus.ACTIVE:
        statement = statement.where(Task.is_completed.is_(False))
    elif status is TaskStatus.COMPLETED:
        statement = statement.where(Task.is_completed.is_(True))
    return statement


def list_tasks(
    db: DbSession,
    session_id: uuid.UUID,
    *,
    status: TaskStatus,
    order: TaskOrder,
    limit: int,
    offset: int,
) -> tuple[list[Task], int]:
    """Return one page plus the total count before limit/offset.

    Sorting is stable: ``created_at`` first, ``id`` as a tie-breaker, with the
    same direction applied to both columns.
    """
    total = db.scalar(_filtered(select(func.count()).select_from(Task), session_id, status))

    statement = _filtered(select(Task), session_id, status)
    if order is TaskOrder.ASC:
        statement = statement.order_by(Task.created_at.asc(), Task.id.asc())
    else:
        statement = statement.order_by(Task.created_at.desc(), Task.id.desc())

    items = list(db.scalars(statement.limit(limit).offset(offset)).all())
    return items, total or 0


def create_task(
    db: DbSession,
    session_id: uuid.UUID,
    payload: TaskCreate,
) -> Task:
    task = Task(
        session_id=session_id,
        title=payload.title,
        description=payload.description,
        is_completed=payload.is_completed,
    )
    db.add(task)
    _commit(db)
    db.refresh(task)
    return task


def get_task(db: DbSession, session_id: uuid.UUID, task_id: int) -> Task | None:
    """Fetch by id *and* session, so a foreign id behaves like a missing one."""
    statement = select(Task).where(
        Task.id == task_id,
        Task.session_id == session_id,
    )
    return db.execute(statement).scalar_one_or_none()


def update_task(
    db: DbSession,
    session_id: uuid.UUID,
    task_id: int,
    payload: TaskUpdate,
) -> Task | None:
    task = get_task(db, session_id, task_id)
    if task is None:
        return None

    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        return task

    for field, value in changes.items():
        setattr(task, field, value)

    _commit(db)
    db.refresh(task)
    return task


def delete_task(db: DbSession, session_id: uuid.UUID, task_id: int) -> bool:
    """Delete in one statement scoped by session; False when nothing matched."""
    result = db.execute(
        delete(Task).where(
            Task.id == task_id,
            Task.session_id == session_id,
        )
    )
    if result.rowcount == 0:
        return False

    _commit(db)
    return True
