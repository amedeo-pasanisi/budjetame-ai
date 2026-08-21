# Budjetame backend — FastAPI + uvicorn. Multi-arch (amd64/arm64), built on
# the target machine (e.g. the Oracle Cloud Always Free ARM VM).
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

WORKDIR /app

# Install dependencies first so rebuilds only re-copy code.
COPY pyproject.toml uv.lock ./
RUN uv sync --no-dev --frozen

# App code + migrations.
COPY alembic.ini ./
COPY alembic ./alembic
COPY app ./app

ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8000

# Migrations run before boot: the single Account is seeded at startup, so the
# schema must exist first (seed only runs when the Account table is empty).
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:create_app --factory --host 0.0.0.0 --port 8000"]
