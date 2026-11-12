FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Dependencies are installed before the application sources are copied, so
# editing code does not invalidate this layer. Hatchling needs the package
# directory to exist for the editable install, hence the minimal stub.
COPY pyproject.toml ./
RUN mkdir -p app && touch app/__init__.py
RUN pip install --upgrade pip \
    && pip install -e ".[dev]"

# Real sources; in dev this directory is replaced by the bind mount.
# tests/alembic are kept so lint, tests and migrations work in the container.
COPY . .

# Fail the build early if the editable install cannot import the real package.
RUN python -c "import app.main"

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload", "--reload-dir", "app"]
