# TaskFlow Selenium E2E (infrastructure)

Изолированный E2E-стек и Selenium-тесты для TaskFlow. Тесты используют существующие CSS-селекторы приложения.

## Состав стека

| Сервис | Назначение | Доступ с хоста |
|---|---|---|
| `db` | PostgreSQL 16, БД `taskflow_e2e`, данные в `tmpfs` | нет |
| `backend` | FastAPI production image, `APP_ENV=test` | нет |
| `web` | Vue production build + Caddy (HTTP) | `http://localhost:8080` |
| `selenium` | Selenium standalone Chrome | `http://localhost:4444/wd/hub` |

Production Compose, production volumes и `.env.prod` не используются.

## Важно: адреса для тестов

Тестовый процесс запускается на хосте, а браузер — внутри контейнера `selenium`. Это разные сетевые окружения:

| Переменная | Значение | Где используется |
|---|---|---|
| `SELENIUM_REMOTE_URL` | `http://localhost:4444/wd/hub` | тестовый процесс на хосте |
| `E2E_BASE_URL` | `http://web:8080` | URL, который открывает браузер внутри Selenium |
| `E2E_API_URL` | `http://localhost:8080` | API-запросы из тестового процесса на хосте через опубликованный порт Caddy |

Не используйте `localhost` в `E2E_BASE_URL`: браузер находится в контейнере, и `localhost` там указывает на сам Selenium-контейнер, а не на `web`.

Не используйте `web` в `E2E_API_URL`: тестовый процесс на хосте не разрешает Docker service names без дополнительной настройки.

`E2E_BASE_URL` и `E2E_API_URL` — разные origin. Cookie `tf_session`, созданная через API на `localhost:8080`, не будет автоматически доступна браузеру на `web:8080`. Для будущих API-seed сценариев используйте cookie из браузера либо сценарии через UI; не смешивайте cookie jars разных origin.

## Запуск

```bash
# 1. Поднять только БД
docker compose -f docker-compose.e2e.yml up -d db

# 2. Применить миграции к E2E-БД
docker compose -f docker-compose.e2e.yml run --rm backend alembic upgrade head

# 3. Поднять backend, web и Selenium
docker compose -f docker-compose.e2e.yml up -d backend web selenium

# 4. Дождаться готовности приложения
curl --retry 30 --retry-delay 1 --retry-connrefused -f \
  http://localhost:8080/api/v1/session
```

`backend` использует `APP_ENV=test`, поэтому cookie называется `tf_session` и не требует HTTPS. Это позволяет работать через HTTP Caddy на `:8080`.

## Зависимости тестов

```bash
python -m pip install -r e2e/requirements.txt
```

## Запуск тестов

Bash:

```bash
E2E_BASE_URL=http://web:8080 \
E2E_API_URL=http://localhost:8080 \
SELENIUM_REMOTE_URL=http://localhost:4444/wd/hub \
pytest e2e -q
```

PowerShell:

```powershell
$env:E2E_BASE_URL = "http://web:8080"
$env:E2E_API_URL = "http://localhost:8080"
$env:SELENIUM_REMOTE_URL = "http://localhost:4444/wd/hub"
pytest e2e -q
```

## Остановка

```bash
docker compose -f docker-compose.e2e.yml down
```

`down -v` для этого стека не требуется: PostgreSQL использует `tmpfs`, named volumes отсутствуют. Если всё же используется `down -v`, применяйте его **только** к `docker-compose.e2e.yml`; никогда не запускайте его для production Compose.

## Ограничения

- Тесты находятся в `e2e/test_tasks.py`; page object — `e2e/task_list_page.py`.
- Миграции применяются отдельной командой, как и в production.
- Caddy работает по HTTP на `:8080`, без TLS/ACME.
- Selenium image зафиксирован: `selenium/standalone-chrome:4.29.0-20250222`.
- Порты `8080` и `4444` могут быть заняты локально; при необходимости измените их в `docker-compose.e2e.yml`.
