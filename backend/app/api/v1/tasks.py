"""Task CRUD endpoints.

HTTP layer only: validate input, call the service, map results to status
codes. Session scoping and CSRF enforcement come from dependencies, so a
handler can never see a task from another session.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session as DbSession

from app.api.deps import get_current_session, require_csrf
from app.core.rate_limit import task_create_rate_limit, task_mutation_rate_limit
from app.db.session import get_db
from app.models.session import Session
from app.schemas.task import (
    TaskCreate,
    TaskList,
    TaskOrder,
    TaskRead,
    TaskSort,
    TaskStatus,
    TaskUpdate,
)
from app.services import tasks as task_service

router = APIRouter(prefix="/tasks", tags=["tasks"])

TASK_NOT_FOUND = "Task not found"


def _not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=TASK_NOT_FOUND)


@router.get("", response_model=TaskList)
def list_tasks(
    current_session: Session = Depends(get_current_session),
    db: DbSession = Depends(get_db),
    task_status: TaskStatus = Query(TaskStatus.ALL, alias="status"),
    sort: TaskSort = Query(TaskSort.CREATED_AT),
    order: TaskOrder = Query(TaskOrder.DESC),
    limit: int = Query(5, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> TaskList:
    # `sort` is validated for the API contract; created_at is the only
    # supported field, so the service ordering is fixed.
    items, total = task_service.list_tasks(
        db,
        current_session.id,
        status=task_status,
        order=order,
        limit=limit,
        offset=offset,
    )
    return TaskList(
        items=[TaskRead.model_validate(item) for item in items],
        total=total,
        limit=limit,
        offset=offset,
        has_more=offset + len(items) < total,
    )


@router.post(
    "",
    response_model=TaskRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(task_create_rate_limit), Depends(require_csrf)],
)
def create_task(
    payload: TaskCreate,
    current_session: Session = Depends(get_current_session),
    db: DbSession = Depends(get_db),
) -> TaskRead:
    task = task_service.create_task(db, current_session.id, payload)
    return TaskRead.model_validate(task)


@router.get("/{task_id}", response_model=TaskRead)
def get_task(
    task_id: int,
    current_session: Session = Depends(get_current_session),
    db: DbSession = Depends(get_db),
) -> TaskRead:
    task = task_service.get_task(db, current_session.id, task_id)
    if task is None:
        raise _not_found()
    return TaskRead.model_validate(task)


@router.patch(
    "/{task_id}",
    response_model=TaskRead,
    dependencies=[Depends(task_mutation_rate_limit), Depends(require_csrf)],
)
def update_task(
    task_id: int,
    payload: TaskUpdate,
    current_session: Session = Depends(get_current_session),
    db: DbSession = Depends(get_db),
) -> TaskRead:
    task = task_service.update_task(db, current_session.id, task_id, payload)
    if task is None:
        raise _not_found()
    return TaskRead.model_validate(task)


@router.delete(
    "/{task_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(task_mutation_rate_limit), Depends(require_csrf)],
)
def delete_task(
    task_id: int,
    current_session: Session = Depends(get_current_session),
    db: DbSession = Depends(get_db),
) -> None:
    if not task_service.delete_task(db, current_session.id, task_id):
        raise _not_found()
