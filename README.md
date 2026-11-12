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
│   ├── Dockerfile
│   ├── .dockerignore
│   └── pyproject.toml
├── frontend/
│   ├── src/
│   ├── tests/
│   ├── Dockerfile
│   ├── .dockerignore
│   ├── vite.config.ts
│   └── package.json
├── docker-compose.yml
├── Makefile
├── .env.example
├── .gitignore
└── README.md
```

## Требования

**Для Docker-запуска (рекомендуется):**

- Docker Desktop (Windows/macOS) или Docker Engine с Docker Compose v2;
- свободные порты `5173`, `8000`, `5432`.

**Для запуска без Docker:**

- Python 3.12+;
- Node.js 24 (версия зафиксирована в `.nvmrc`, см. `engines` в `frontend/package.json`);
- PostgreSQL 16 — можно поднять только контейнером `db`.

## Docker Compose (dev)

Compose поднимает три сервиса:

| Сервис | Что делает | Порт на хосте |
|---|---|---|
| `db` | PostgreSQL 16, данные в named volume `postgres_data` | `5432` |
| `backend` | FastAPI + uvicorn `--reload` | `8000` |
| `frontend` | Vite dev server с HMR | `5173` |

Backend внутри сети Compose ходит в БД по hostname `db`; frontend проксирует `/api` на `backend:8000`. Браузер обращается только к `http://localhost:5173`, поэтому cookie сессии работают same-origin, CORS не нужен.

### Первый запуск

```bash
cp .env.example .env        # Windows PowerShell: Copy-Item .env.example .env
make up                     # docker compose up -d --build
```

`.env` не обязателен: при его отсутствии Compose использует значения по умолчанию (`taskflow/taskflow/taskflow`). Переменные `POSTGRES_*` используются сервисом `db`; `DATABASE_URL` из `.env` нужен для локального запуска без Docker — внутри Compose backend получает отдельный `DATABASE_URL` с hostname `db`.

Если `make` не установлен:

```powershell
docker compose up -d --build
```

Адреса:

- Frontend: http://localhost:5173
- Backend API: http://localhost:8000
- Swagger: http://localhost:8000/docs
- Health: http://localhost:8000/health

### Команды Makefile

| Команда | Что делает |
|---|---|
| `make up` | собирает образы и запускает `db`, `backend`, `frontend` в фоне |
| `make down` | останавливает и удаляет контейнеры/сеть, **сохраняя** `postgres_data` |
| `make build` | собирает образы без запуска |
| `make rebuild` | `build --no-cache` и пересоздание контейнеров с обновлением анонимного volume `node_modules`; named volume PostgreSQL не трогается |
| `make logs` | следует за логами всех сервисов (`Ctrl+C` — выход) |
| `make ps` | статус сервисов и портов |
| `make restart` | перезапускает контейнеры |
| `make test` | `pytest` в backend-контейнере и `npm test` в frontend-контейнере |
| `make lint` | Ruff в backend и ESLint во frontend |
| `make typecheck` | `vue-tsc` во frontend |
| `make migrate` | явно применяет `alembic upgrade head` в backend |

`make test`, `make lint`, `make typecheck` и `make migrate` используют `docker compose exec`, поэтому сначала должен быть выполнен `make up`.

### Миграции

Автоматически при старте контейнера миграции **не выполняются**. Применить их нужно явно:

```bash
make migrate
# или:
docker compose exec -T backend alembic upgrade head
```

### Данные PostgreSQL

Данные лежат в named volume `postgres_data`.

- `make down` и `make restart` данные сохраняют.
- Полное удаление данных (необратимо, вместе со всеми задачами и сессиями):

```bash
docker compose down -v
```

Используйте `down -v` только если действительно нужен чистый старт.

### Hot reload

- Backend: uvicorn с `--reload` и `--reload-dir app`; изменения в `backend/app` перезапускают сервер.
- Frontend: Vite HMR. В `docker-compose.yml` для frontend задан `CHOKIDAR_USEPOLLING=true`: Docker Desktop на Windows не передаёт inotify-события с bind mount, поэтому без polling изменения не подхватываются. На Linux/macOS эту переменную можно убрать (polling повышает нагрузку на CPU).
- Если менялись зависимости (`pyproject.toml`/`package-lock.json`) или Dockerfile, пересоберите окружение: `make rebuild`.

### Lint в контейнере и EXE002

`make lint` запускает backend Ruff с `--extend-ignore EXE002`:

```
ruff check --extend-ignore EXE002 app tests alembic
```

Причина: Docker Desktop на Windows показывает файлы в bind mount (и в build-контексте) как исполняемые (`777`), хотя в git они хранятся с режимом `100644`. Из-за этого Ruff считает, что файлу нужен shebang. Это среда, а не код: локальный `ruff check app tests alembic` на Windows проходит без исключений. Глобальная конфигурация Ruff не меняется; исключение действует только в Docker-команде.

## Backend (локальный запуск)

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

Локальный backend использует `DATABASE_URL` из `.env` (hostname `localhost`, порт `5432`). Контейнер `db` публикует порт на хост, поэтому отдельный PostgreSQL не обязателен.

## Frontend (локальный запуск)

Нужен Node.js 24 (`.nvmrc`).

```bash
nvm use                 # в nvm-windows: nvm use 24

cd frontend
npm ci
npm run dev
```

Dev-сервер: http://localhost:5173

Запросы к `/api` проксируются на `http://127.0.0.1:8000` (fallback в `vite.config.ts`), поэтому backend должен быть запущен отдельно. В Docker Compose proxy target задаётся через `VITE_PROXY_TARGET=http://backend:8000`. В обоих случаях браузер видит один origin, и HttpOnly cookie сессии работают без CORS.

Проверки и сборка:

```bash
npm run build      # typecheck + production-сборка в dist/
npm run typecheck  # vue-tsc
npm test           # Vitest
npm run lint       # ESLint (Vue 3 + TypeScript, flat config)
```

## Тесты

Локально:

```bash
cd backend
pytest

cd ../frontend
npm test
```

В Docker (нужен `make up`):

```bash
make test
```

Backend-тесты используют отдельную БД `taskflow_test`; `conftest.py` создаёт её при необходимости через подключение к служебной БД `postgres`. Пользователь PostgreSQL из Compose по умолчанию — superuser, поэтому прав достаточно.

## Windows / Docker Desktop

- `make` нет в PowerShell. Варианты: WSL2, Git Bash, Chocolatey (`choco install make`) либо обычные команды `docker compose`.
- Эквиваленты:
  ```powershell
  docker compose up -d --build      # make up
  docker compose down               # make down (данные сохраняются)
  docker compose ps                 # make ps
  docker compose logs -f --tail=100 # make logs
  docker compose exec -T backend pytest
  docker compose exec -T frontend npm test
  ```
- HMR: `CHOKIDAR_USEPOLLING=true` уже задан для frontend. Если правки всё равно не подхватываются, проверьте, что проект лежит на диске, доступном Docker Desktop (WSL2-диск предпочтительнее).
- Скрипты/команды с путями выполняйте в PowerShell с прямыми слэшами или через WSL; Makefile использует LF и табы — не конвертируйте его в CRLF.

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

Локально:

```bash
cd backend
alembic upgrade head                                   # apply
alembic revision --autogenerate -m "add something"     # generate
alembic check                                          # metadata vs migrations
alembic downgrade -1                                   # roll back one step
ruff format alembic/versions                           # keep generated files formatted
```

В Docker:

```bash
make migrate
# или:
docker compose exec -T backend alembic upgrade head
```

`env.py` берёт URL из `app.core.config.settings` (`DATABASE_URL`), поэтому
в `alembic.ini` нет учётных данных. В контейнере `DATABASE_URL` указывает на
`db:5432`; локально — на `localhost:5432`.

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
| Средний | Нет rate limiting для API в целом — включая анонимные сессии и ресурсоёмкие операции (пагинированные списки, массовые мутации); риск перегрузки PostgreSQL при злоупотреблении или всплесках трафика | После frontend, перед публикацией |
| Средний | CI/CD: GitHub Actions workflow для backend и frontend (lint, typecheck, tests, build). До восстановления доступности GitHub-hosted minutes проверять workflow локально через `act` при наличии Docker | После стабилизации frontend |
| Средний | Frontend E2E на Selenium WebDriver: создание задачи, изменение статуса, редактирование, удаление, фильтры, пагинация и сохранение после перезагрузки в реальном браузере | После завершения UI |
| Средний | Фильтры, сортировка и пагинация не синхронизированы с query-параметрами Vue Router | Этап интеграции UI с router |
| Низкий | Нет optimistic updates: после каждой успешной мутации список перезапрашивается — осознанный выбор ради консистентности offset-пагинации | Можно оставить для MVP |
| Низкий | Устаревшие ответы `fetchTasks()` отбрасываются по sequence, но HTTP-запросы не отменяются (нет AbortController) | Этап оптимизации после MVP |

- Проверить планы запросов PostgreSQL (EXPLAIN ANALYZE) на выборке задач.
- Проверить, что все CRUD-ответы и ошибки не раскрывают данные чужих сессий.
