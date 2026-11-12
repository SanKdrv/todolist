# TaskFlow

Task management service: FastAPI backend + frontend, PostgreSQL, Docker Compose.

## Structure

```
taskflow/
├── backend/
│   ├── app/
│   │   ├── api/        # HTTP routers and endpoints
│   │   ├── core/       # config, security, shared utilities
│   │   ├── models/     # SQLAlchemy ORM models
│   │   ├── schemas/    # Pydantic schemas
│   │   ├── services/   # business logic / data access
│   │   └── main.py     # FastAPI app entrypoint
│   ├── tests/
│   ├── alembic/        # database migrations
│   └── pyproject.toml
├── frontend/
├── docker-compose.yml
├── .env.example
├── .gitignore
└── README.md
```

## Requirements

- Python 3.11+
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

## Migrations

Alembic lives in `backend/alembic`. Initialize its config once (creates `alembic.ini`):

```bash
cd backend
alembic init alembic   # only if alembic.ini is missing
alembic revision --autogenerate -m "init"
alembic upgrade head
```

## Frontend

```bash
cd frontend
npm create vite@latest . -- --template react-ts
npm install
npm run dev
```
