# Budjetame

A single-user personal finance app. Money lives in Wallets; every Balance is derived
from the Wallet's Transaction history; Net Worth is the sum of all Wallet balances.

Domain vocabulary lives in [`CONTEXT.md`](CONTEXT.md); architectural decisions in
[`docs/adr/`](docs/adr/). Product work is tracked as GitHub issues.

## Stack

- **Backend**: FastAPI + SQLAlchemy + Alembic + PostgreSQL (`backend/`)
- **Frontend**: React + Vite + Tailwind CSS, mobile-first (`frontend/`)
- **Database**: PostgreSQL 16 via Docker Compose

## Prerequisites

- Python ≥ 3.12 and [uv](https://docs.astral.sh/uv/)
- Node.js ≥ 20 and npm
- Docker Desktop (for the local database and for tests via testcontainers)

## Local development

### 1. Start the database

```bash
docker compose up -d
```

### 2. Backend

```bash
cd backend
uv sync
uv run alembic upgrade head
uv run uvicorn app.main:app --reload
```

The API is then at <http://localhost:8000> (docs at `/docs`), health check at `/health`.

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

The app is then at <http://localhost:5173>.

## Tests

```bash
cd backend
uv run pytest
```

Tests drive the HTTP API through an ASGI transport against a real Postgres
instance spun up per-session with testcontainers (Docker must be running).
The test seam is the HTTP API — see the v1 spec (GitHub issue #1).

## Migrations

```bash
cd backend
uv run alembic revision --autogenerate -m "describe the change"
uv run alembic upgrade head
```

## Project conventions

- All data is scoped to the single Account; foreign data gets a 403.
- Balances are derived from Transaction history, never stored.
- Deleted Wallets are frozen (read-only archives), never hard-deleted.
- See `CONTEXT.md` for the domain glossary and `docs/adr/` for decisions.
