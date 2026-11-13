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
│   ├── Dockerfile.prod
│   ├── .dockerignore
│   └── pyproject.toml
├── frontend/
│   ├── src/
│   ├── tests/
│   ├── Dockerfile
│   ├── Dockerfile.prod
│   ├── .dockerignore
│   ├── vite.config.ts
│   └── package.json
├── deploy/
│   ├── Caddyfile
│   └── postgres/
│       └── init-app-role.sh
├── docker-compose.yml
├── docker-compose.prod.yml
├── Makefile
├── .env.example
├── .env.prod.example
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

Backend-тесты используют отдельную БД `taskflow_test`; `conftest.py` создаёт её при необходимости через подключение к служебной БД `postgres`. В dev Compose пользователь PostgreSQL по умолчанию — superuser, поэтому прав достаточно. В production backend подключается от отдельной роли `taskflow_app` (см. раздел Production).

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

## Production (Ubuntu 24.04 + Caddy)

Production-стек отделён от dev и не использует Vite dev server, bind mounts или autoreload:

- `docker-compose.prod.yml` — отдельный Compose-проект `taskflow-prod` и отдельные volumes;
- `backend/Dockerfile.prod` — runtime-only образ, non-root пользователь, без dev-зависимостей и `--reload`;
- `frontend/Dockerfile.prod` — сборка Vue на Node 24, раздача статики через Caddy;
- `deploy/Caddyfile` — автоматический HTTPS, SPA и прокси `/api/*` на backend;
- `deploy/postgres/init-app-role.sh` — создание роли приложения при первой инициализации PostgreSQL.

Наружу открыты только `80` и `443`; PostgreSQL и backend доступны только внутри Docker-сети.

Production-режим (`APP_ENV=production`, `APP_DEBUG=false`) задаётся непосредственно в `docker-compose.prod.yml`; в `.env.prod` этих переменных нет. `.env.prod` используется Compose для подстановки значений, а не как общий env-файл контейнеров.

### Требования к серверу

- Ubuntu 24.04, Docker Engine и Docker Compose v2;
- домен `xn----8sbafmcbeon8ceb3bnc.xn--p1ai` (ASCII/punycode; в браузере отображается кириллицей) должен указывать A-записью на публичный IP ВМ;
- открыты порты `22`, `80`, `443`; порты `5432`, `8000`, `5173` закрыты;
- Caddy выпускает сертификат Let's Encrypt только после того, как DNS начнёт указывать на сервер. До этого `web` не запускайте.

### Файлы, которые нужны на сервере

Для запуска заранее собранных образов достаточно этих файлов:

- `docker-compose.prod.yml`;
- `deploy/Caddyfile`;
- `deploy/postgres/init-app-role.sh`;
- `.env.prod` (создаётся из `.env.prod.example`, в Git не попадает);
- архив образов `taskflow-images.tar.gz` или `taskflow-images.tar`.

Если собирать образы прямо на сервере, нужен весь репозиторий (`backend/`, `frontend/` и остальные файлы).

### PostgreSQL: bootstrap-пользователь и роль приложения

`POSTGRES_USER` — это **bootstrap-суперпользователь** официального образа PostgreSQL. Он используется только для первоначальной инициализации кластера и административных операций (например, `pg_dump`). Backend подключается не от его имени.

При первом запуске на пустом volume `deploy/postgres/init-app-role.sh` создаёт роль:

- `taskflow_app`;
- `LOGIN`;
- `NOSUPERUSER`;
- `NOCREATEDB`;
- `NOCREATEROLE`.

Эта же роль становится владельцем базы `taskflow`, поэтому Alembic может создавать и изменять таблицы и индексы без прав суперпользователя. Пароль задаётся отдельной переменной `APP_DB_PASSWORD`; в SQL он передаётся через `psql`-переменную и `format('%L', ...)`, без конкатенации непроверенной строки.

**Важно:** init-скрипты PostgreSQL выполняются только при первой инициализации пустого volume. Если volume `postgres_data` уже существует, скрипт не запустится. Не удаляйте и не пересоздавайте volume; перейдите на новую роль вручную по инструкции ниже.

### Подготовка `.env.prod`

```bash
cp .env.prod.example .env.prod
chmod 600 .env.prod
```

Заполните:

- `POSTGRES_USER`, `POSTGRES_PASSWORD` — bootstrap-суперпользователь; backend их не использует;
- `POSTGRES_DB` — имя базы (`taskflow`);
- `APP_DB_PASSWORD` — пароль роли `taskflow_app`;
- `DATABASE_URL` — подключение от имени `taskflow_app` к hostname `db`. Если пароль содержит `@`, `:`, `/` и т.п., percent-encode его в URL (например, `@` → `%40`). Значение `APP_DB_PASSWORD` при этом остаётся исходным, а `DATABASE_URL` должен содержать тот же пароль;
- `DOMAIN` — ASCII-форма домена;
- `ACME_EMAIL` — email для Let's Encrypt.

Если пароль содержит `$`, заключите значение в одинарные кавычки в `.env.prod`, чтобы Compose не интерполировал его как переменную.

`.env.prod` не коммитится. Секреты не хранятся в репозитории.

### Сборка образов

Собирать лучше локально/на отдельной машине: на ВМ 2 vCPU / 4 GiB сборка frontend может быть тяжёлой.

Linux / WSL / Git Bash:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod build
docker save taskflow-backend:prod taskflow-frontend:prod | gzip > taskflow-images.tar.gz
```

PowerShell (Windows 10+):

```powershell
docker compose -f docker-compose.prod.yml --env-file .env.prod build
docker save -o taskflow-images.tar taskflow-backend:prod taskflow-frontend:prod
```

В PowerShell нет `gzip`; если нужен сжатый архив, выполните `docker save ... | gzip` в WSL или Git Bash. `docker load` понимает оба варианта.

### Перенос на чистый сервер

На сервере создайте каталог:

```bash
sudo mkdir -p /opt/taskflow
sudo chown "$USER":"$USER" /opt/taskflow
```

С локальной машины (Linux / WSL / Git Bash):

```bash
scp docker-compose.prod.yml user@server:/opt/taskflow/
scp -r deploy user@server:/opt/taskflow/
scp .env.prod user@server:/opt/taskflow/
scp taskflow-images.tar.gz user@server:/opt/taskflow/
```

PowerShell:

```powershell
ssh user@server "mkdir -p /opt/taskflow"
scp .\docker-compose.prod.yml user@server:/opt/taskflow/
scp -r .\deploy user@server:/opt/taskflow/
scp .\.env.prod user@server:/opt/taskflow/
scp .\taskflow-images.tar user@server:/opt/taskflow/
```

`scp` входит в Windows 10+ (OpenSSH Client). Если его нет, используйте WinSCP.

На сервере:

```bash
cd /opt/taskflow
chmod 600 .env.prod
chmod 755 deploy/postgres/init-app-role.sh
docker load -i taskflow-images.tar.gz
# если переносили несжатый архив:
# docker load -i taskflow-images.tar
docker compose -f docker-compose.prod.yml --env-file .env.prod config --quiet
```

`chmod 755` делает init-скрипт читаемым и исполняемым для пользователя контейнера PostgreSQL. Если файл не исполняемый, официальный entrypoint выполнит его через `source`; скрипт безопасен для обоих режимов. Права `600` на init-скрипт не подходят: пользователь `postgres` внутри контейнера не сможет его прочитать.

Файл, скопированный из Windows, может иметь Git mode `100644` без исполняемого бита — это не мешает запуску через `source`. `chmod 755` на сервере гарантирует и чтение, и возможность прямого запуска. Проверить права можно через `ls -l deploy/postgres/init-app-role.sh`; Compose монтирует файл в `/docker-entrypoint-initdb.d/01-app-role.sh` (см. вывод `docker compose -f docker-compose.prod.yml --env-file .env.prod config`).

### Первый запуск

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d db
docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm backend alembic upgrade head
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d backend web
```

Миграции **не запускаются автоматически** при старте контейнера. `web` (Caddy) стартует после успешного healthcheck `/health/ready` backend.

Если на сервере уже есть старый volume `postgres_data` без роли `taskflow_app`, миграции завершатся ошибкой аутентификации. Не удаляйте volume — выполните ручную миграцию ролей из раздела ниже.

### Проверка

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
```

Проверка health-эндпоинтов — **изнутри backend-контейнера**, а не через публичный Caddy. Caddy проксирует только `/api/*`, поэтому `https://<домен>/health` и `/health/ready` вернут SPA `index.html`, а не JSON backend:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T backend \
  python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/health').read().decode())"

docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T backend \
  python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/health/ready').read().decode())"
```

Ожидаемо: `{"status":"ok"}` и `{"status":"ready"}`. Readiness намеренно не публикуется наружу.

Проверка через публичный HTTPS:

```bash
curl -i https://xn----8sbafmcbeon8ceb3bnc.xn--p1ai/api/v1/session
```

Ожидаемо:

- `/api/v1/session` отвечает `200` и выставляет cookie `__Host-tf_session` с `Secure`, `HttpOnly`, `SameSite=lax`, `Path=/`;
- создание задачи работает через UI;
- `docker compose -f docker-compose.prod.yml --env-file .env.prod ps` не показывает публикацию `5432` или `8000`.

Логи Caddy (выпуск сертификата):

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f --tail=100 web
```

### Обновление

Бэкап выполняется на Ubuntu-сервере в bash. PowerShell-варианта backup в этом разделе нет.

```bash
# 1. Бэкап БД
(
  set -o pipefail

  backup="backup-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"

  if ! docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T db \
      sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > "$backup"; then
    rm -f -- "$backup"
    echo "ERROR: pg_dump failed; incomplete backup removed" >&2
    false
  elif ! gzip -t "$backup"; then
    rm -f -- "$backup"
    echo "ERROR: gzip integrity check failed; corrupt backup removed: $backup" >&2
    false
  else
    echo "Backup created and gzip-verified: $backup"
  fi
)

# 2. Новые образы (собранные локально и перенесённые, или build на сервере)
docker load -i taskflow-images.tar.gz

# 3. Миграции
docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm backend alembic upgrade head

# 4. Перезапуск приложения
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d backend web
```

Если backup-команда вернула non-zero, остановитесь: не переходите к шагу 2. `gzip -t` проверяет только целостность gzip-контейнера, а не полноту и корректность SQL-дампа; периодически проверяйте восстановление на отдельной БД.

Старый backend продолжает работать во время шага 3. Для текущей additive-миграции это безопасно; для будущих миграций с удалением или переименованием колонок используйте maintenance window или схему expand/contract. При несовместимых миграциях сначала проверьте их на копии БД; при необходимости используйте `alembic downgrade` по согласованному плану.

### Остановка и данные

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod down
```

Команда останавливает контейнеры, но **сохраняет** volumes `postgres_data`, `caddy_data`, `caddy_config`.

Полное удаление данных и сертификатов (необратимо):

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod down -v
```

Используйте только при необходимости полностью пересоздать окружение.

**Не запускайте на production** `docker volume prune`, `docker system prune` и другие команды, удаляющие неиспользуемые volumes: они могут уничтожить `postgres_data` вместе с базой. Для очистки старых образов используйте точечное удаление конкретных тегов.

### Переход на роль `taskflow_app` на существующем volume

Init-скрипт не выполняется на уже инициализированном volume. Если база была создана раньше от имени bootstrap-пользователя, перейдите вручную:

1. Откройте `psql` от bootstrap-суперпользователя:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod exec db \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

2. Создайте роль и передайте ей базу. Пароль задайте через `\password` (psql запросит его и не покажет в истории команд); он должен совпадать с `APP_DB_PASSWORD`:

```sql
CREATE ROLE taskflow_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
\password taskflow_app
ALTER DATABASE taskflow OWNER TO taskflow_app;
```

3. Если таблицы и последовательности уже принадлежат старому пользователю приложения (не bootstrap-суперпользователю `postgres`), переназначьте владение. Команду нужно выполнять, подключившись к базе `taskflow`, от суперпользователя:

```sql
REASSIGN OWNED BY old_role TO taskflow_app;
```

`REASSIGN OWNED` действует на объекты в текущей базе и не меняет владельца самой базы; при необходимости выполните его также для других баз, где есть объекты старой роли. Не используйте в качестве `old_role` bootstrap-суперпользователя `postgres`.

4. Обновите `DATABASE_URL` в `.env.prod` (пользователь `taskflow_app`, пароль `APP_DB_PASSWORD`) и перезапустите backend:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d backend
```

Не удаляйте и не пересоздавайте volume `postgres_data` ради применения init-скрипта.

### Бэкапы и диск

- Регулярно делайте `pg_dump` (команда выше) и храните копии вне ВМ.
- Том `caddy_data` содержит сертификаты; при его потере Caddy запросит новые (учитывайте rate limits Let's Encrypt).
- Docker-логи ограничены (`max-size: 10m`, `max-file: 3` на сервис).
- На диске 10 GiB следите за образами, build cache и размером БД; старые неиспользуемые образы можно удалять вручную.
- Очистка истёкших сессий пока не автоматизирована (см. технический долг), БД со временем растёт.

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
