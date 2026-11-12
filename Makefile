COMPOSE ?= docker compose

.PHONY: up down build rebuild logs ps restart test lint typecheck migrate

up:
	$(COMPOSE) up -d --build

down:
	$(COMPOSE) down

build:
	$(COMPOSE) build

rebuild:
	$(COMPOSE) build --no-cache
	$(COMPOSE) up -d --force-recreate --renew-anon-volumes --remove-orphans

logs:
	$(COMPOSE) logs -f --tail=100

ps:
	$(COMPOSE) ps

restart:
	$(COMPOSE) restart

test:
	$(COMPOSE) exec -T backend pytest
	$(COMPOSE) exec -T frontend npm test

lint:
	$(COMPOSE) exec -T backend ruff check --extend-ignore EXE002 app tests alembic
	$(COMPOSE) exec -T frontend npm run lint

typecheck:
	$(COMPOSE) exec -T frontend npm run typecheck

migrate:
	$(COMPOSE) exec -T backend alembic upgrade head
