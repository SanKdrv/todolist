"""Test fixtures: dedicated PostgreSQL database + transactional isolation."""

import os
import re
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session as DbSession

import app.models  # registers mappers on Base.metadata
from app.db.base import Base
from app.db.session import get_db
from app.main import app

TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql+psycopg://taskflow:taskflow@localhost:5432/taskflow_test",
)


def _ensure_database(url: str) -> None:
    server_url, _, database = url.rpartition("/")
    if not re.fullmatch(r"[A-Za-z0-9_]+", database):
        raise ValueError(f"Unsafe test database name: {database!r}")

    admin_engine = create_engine(f"{server_url}/postgres", isolation_level="AUTOCOMMIT")
    with admin_engine.connect() as connection:
        exists = connection.execute(
            text("SELECT 1 FROM pg_database WHERE datname = :name"),
            {"name": database},
        ).scalar()
        if not exists:
            connection.execute(text(f'CREATE DATABASE "{database}"'))
    admin_engine.dispose()


@pytest.fixture(scope="session")
def engine() -> Iterator[Engine]:
    _ensure_database(TEST_DATABASE_URL)
    engine = create_engine(TEST_DATABASE_URL, pool_pre_ping=True)

    # Tests build the schema from metadata (fast, no Alembic round trip);
    # migrations themselves are verified separately by `alembic check` in CI.
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)

    yield engine

    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture()
def db_session(engine: Engine) -> Iterator[DbSession]:
    """Session bound to an outer transaction that is rolled back per test.

    ``create_savepoint`` keeps service-level ``commit()`` calls from ending the
    outer transaction, so tests never leak rows into each other.
    """
    connection = engine.connect()
    transaction = connection.begin()
    session = DbSession(
        bind=connection,
        join_transaction_mode="create_savepoint",
        expire_on_commit=False,
    )
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()


@pytest.fixture()
def client(db_session: DbSession) -> Iterator[TestClient]:
    def override_get_db() -> Iterator[DbSession]:
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.clear()
