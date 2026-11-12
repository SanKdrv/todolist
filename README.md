# TaskFlow

Task management service: FastAPI backend + frontend, PostgreSQL, Docker Compose.

## Structure

```
taskflow/
├── backend/
│   ├── app/
│   │   ├── api/        # HTTP routers and endpoints
│   │   ├── core/       # config, security, shared utilities
│   │   ├── db/         # engine, session factory, declarative Base
│   │   ├── models/     # SQLAlchemy ORM models
│   │   ├── schemas/    # Pydantic schemas
│   │   ├── services/   # business logic / data access
│   │   └── main.py     # FastAPI app entrypoint
│   ├── tests/
│   ├── alembic/        # database migrations
│   ├── alembic.ini
│   └── pyproject.toml
├── frontend/
├── docker-compose.yml
├── .env.example
├── .gitignore
└── README.md
```

## Requirements

- Python 3.12+
- Docker (for PostgreSQL)
- Node.js 20+ (for the frontend)

## Backend

```bash
cp .env.example .env
docker compose up -d db

cd backend
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # Linux / macOS
pip install -e ".[dev]"

uvicorn app.main:app --reload
```

- API: http://localhost:8000
- Docs: http://localhost:8000/docs
- Health: http://localhost:8000/health

## Tests

```bash
cd backend
pytest
```

## Database

Two tables:

- `sessions` — anonymous browser session: `id` (uuid), `csrf_token`,
  `created_at`, `last_activity_at`, `expires_at` (sliding TTL, indexed).
- `tasks` — `id` (identity), `session_id` (FK, `ON DELETE CASCADE`), `title`,
  `description`, `is_completed`, `created_at`, `updated_at`.

`ix_tasks_session_created (session_id, created_at, id)` serves list queries,
pagination counts and the cascade lookup. A plain ASC index also covers
`ORDER BY created_at DESC, id DESC` via a backward index scan.

## Migrations

Schema changes go through Alembic only — `create_all` is never used outside tests.

```bash
cd backend
alembic upgrade head                                   # apply
alembic revision --autogenerate -m "add something"     # generate
alembic check                                          # metadata vs migrations
alembic downgrade -1                                   # roll back one step
ruff format alembic/versions                            # keep generated files formatted
```

`env.py` takes the URL from `app.core.config.settings` (`DATABASE_URL`), so
`alembic.ini` contains no credentials.

## Frontend

```bash
cd frontend
npm create vite@latest . -- --template vue-ts
npm install
npm run dev
```
