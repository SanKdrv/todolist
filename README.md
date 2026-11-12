# TaskFlow

Сервис управления задачами: backend на FastAPI + frontend, PostgreSQL, Docker Compose.

## Структура

```
taskflow/
├── backend/
│   ├── app/
│   │   ├── api/        # HTTP-роутеры и зависимости
│   │   ├── core/       # конфигурация, безопасность, общие утилиты
│   │   ├── db/         # engine, фабрика сессий, декларативный Base
│   │   ├── models/     # ORM-модели SQLAlchemy
│   │   ├── schemas/    # Pydantic-схемы
│   │   ├── services/   # бизнес-логика и работа с БД
│   │   └── main.py     # точка входа FastAPI
│   ├── tests/
│   ├── alembic/        # миграции базы данных
│   ├── alembic.ini
│   └── pyproject.toml
├── frontend/
├── docker-compose.yml
├── .env.example
├── .gitignore
└── README.md
```

## Требования

- Python 3.12+
- Docker (для PostgreSQL)
- Node.js 20+ (для frontend)

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

## Тесты

```bash
cd backend
pytest
```

## База данных

Две таблицы:

- `sessions` — анонимная браузерная сессия: `id` (uuid), `csrf_token`,
  `created_at`, `last_activity_at`, `expires_at` (скользящий TTL, индекс).
- `tasks` — `id` (identity), `session_id` (FK, `ON DELETE CASCADE`), `title`,
  `description`, `is_completed`, `created_at`, `updated_at`.

Индекс `ix_tasks_session_created (session_id, created_at, id)` обслуживает
списки задач, подсчёт для пагинации и поиск по FK при каскадном удалении.
Обычный ASC-индекс также покрывает `ORDER BY created_at DESC, id DESC`
за счёт обратного сканирования индекса.

## Сессии

У каждого браузера своя анонимная сессия, авторизации нет. `GET /api/v1/session`
возвращает текущую сессию или создаёт новую и является единственным местом,
где выставляется cookie.

```
cookie ──► разбор uuid ──► SELECT ... WHERE expires_at > now()
                                  │ найдена                │ нет / истёк / битая
                                  ▼                        ▼
                        продление, если прошло > 1 часа   INSERT новой сессии
                                  │                        │
                                  └────► Set-Cookie (только при создании или продлении)
```

- TTL скользящий, 30 дней: `last_activity_at` и `expires_at` сдвигаются вперёд
  не чаще раза в час (`SESSION_TOUCH_INTERVAL_MINUTES`).
- `Max-Age` cookie вычисляется из `expires_at`, поэтому срок жизни на сервере
  и в браузере не может разойтись.
- Cookie: `HttpOnly`, `SameSite=Lax`, `Path=/`, без `Domain`; `Secure` и имя
  (`tf_session` / `__Host-tf_session`) определяются `APP_ENV`.
- Просроченные сессии отсекаются при каждом обращении; удаление — задача
  фоновой очистки (следующий этап), поэтому истёкшая запись может ненадолго
  пережить свою полезность.
- `X-CSRF-Token` должен совпадать с `sessions.csrf_token` для небезопасных
  методов; зависимость подключена к `POST`, `PATCH` и `DELETE`.

Обе зависимости используют один резолвер (`_resolve_session`), поэтому проверка
TTL не дублируется:

| Зависимость | Где используется | Нет cookie / битая / истекла |
|---|---|---|
| `get_session_context` | `GET /api/v1/session` (bootstrap) | создаёт новую сессию, `is_new: true` |
| `get_current_session` | эндпоинты задач | `401 {"detail": "Active session required"}` |

Отклонённый защищённый запрос никогда не создаёт строку сессии.

## Pre-commit (Windows / PowerShell)

Хуки работают в режиме проверки: `ruff check` и `ruff format --check`. Они
никогда не переписывают файлы, поэтому неудачный commit всегда требует
явного исправления и повторного `git add`.

```powershell
# из корня репозитория
cd backend
.venv\Scripts\python.exe -m pip install -e ".[dev]"
cd ..

backend\.venv\Scripts\pre-commit.exe install        # создаёт .git/hooks/pre-commit
backend\.venv\Scripts\pre-commit.exe run --all-files  # необязательный полный прогон
```

Linux / macOS:

```bash
pip install -e "backend[dev]"
pre-commit install
pre-commit run --all-files
```

`pre-commit install` выполняется один раз на клон. Чтобы обновить версии хуков:

```powershell
backend\.venv\Scripts\pre-commit.exe autoupdate
```

## Миграции

Изменения схемы выполняются только через Alembic — `create_all` не используется
вне тестов.

```bash
cd backend
alembic upgrade head                                   # apply
alembic revision --autogenerate -m "add something"     # generate
alembic check                                          # metadata vs migrations
alembic downgrade -1                                   # roll back one step
ruff format alembic/versions                           # keep generated files formatted
```

`env.py` берёт URL из `app.core.config.settings` (`DATABASE_URL`), поэтому
в `alembic.ini` нет учётных данных.

## Frontend

```bash
cd frontend
npm create vite@latest . -- --template vue-ts
npm install
npm run dev
```

## Технический долг

| Приоритет | Технический долг | Когда закрыть |
|---|---|---|
| Средний | `Cache-Control: no-store` для необработанных HTTP 500 | Перед финальной сдачей |
| Низкий | Предупреждение Starlette TestClient о httpx / httpx2 | При настройке CI |
| Средний | Очистка просроченных сессий | Этап фоновой очистки |
| Низкий | Параллельное создание сессий может оставлять лишние записи | Можно оставить для MVP |
| Низкий | Часы приложения вместо времени PostgreSQL при проверке TTL | При масштабировании |
| Средний | Тесты создают схему через `metadata.create_all`, а не через Alembic | При настройке CI |
| Средний | Offset-пагинация деградирует на больших объёмах, cursor pagination не реализована | Этап оптимизации после MVP |
| Низкий | `PATCH` с пустым телом — no-op; поведение не описано в ТЗ | Уточнить на этапе frontend |
| Низкий | `updated_at` использует `now()` (время транзакции), а не `clock_timestamp()` | При необходимости точных меток |
| Низкий | 401 не сбрасывает устаревшую cookie — браузер шлёт её до истечения `Max-Age` | Полировка перед сдачей |
| Средний | Нет rate limiting для анонимных сессий | После frontend, перед публикацией |

- Проверить планы запросов PostgreSQL (EXPLAIN ANALYZE) на выборке задач.
- Проверить, что все CRUD-ответы и ошибки не раскрывают данные чужих сессий.
