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

## Sessions

Each browser gets an anonymous session; there is no auth. `GET /api/v1/session`
returns the current session or creates a new one, and is the only place that
issues the cookie.

```
cookie ──► parse uuid ──► SELECT ... WHERE expires_at > now()
                              │ hit                    │ miss / expired / malformed
                              ▼                        ▼
                      touch if older than 1h     INSERT new session
                              │                        │
                              └────► Set-Cookie (only when new or touched)
```

- TTL is a sliding 30 days: `last_activity_at` and `expires_at` move forward at
  most once per hour (`SESSION_TOUCH_INTERVAL_MINUTES`).
- Cookie `Max-Age` is computed from `expires_at`, so server expiry and browser
  expiry cannot drift.
- Cookie: `HttpOnly`, `SameSite=Lax`, `Path=/`, no `Domain`; `Secure` and the
  name (`tf_session` / `__Host-tf_session`) follow `APP_ENV`.
- Expired sessions are rejected on every lookup; deletion is the cleanup job's
  job (next stage), so an expired row can briefly outlive its usefulness.
- `X-CSRF-Token` must match `sessions.csrf_token` on unsafe methods; the
  dependency exists but is not attached until CRUD lands.

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
