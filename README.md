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
uv run uvicorn app.main:create_app --factory --reload
```

The API is then at <http://localhost:8000> (docs at `/docs`), health check at `/health`.

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

The app is then at <http://localhost:5173>.

The Transaction-form map picker defaults to the free Leaflet/OpenStreetMap map
(`VITE_MAP_PROVIDER=leaflet`, no key needed). To use a real Google Map with
place search instead, run `frontend/scripts/google-maps-wizard.sh` — it walks
you through the one-time Google Cloud setup (billing account + API key) and
writes `frontend/.env` (`VITE_MAP_PROVIDER=google` + the key). See
`frontend/.env.example` for the variables.

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

## Deployment

Free, always-on hosting on **Oracle Cloud Always Free** (a single ARM VM running
the whole stack in Docker): run `scripts/oracle-provision.sh` — it walks you
through the Oracle signup, creates the VM, and deploys. See
[`docs/deploy-oracle.md`](docs/deploy-oracle.md) for what it does and the
manual record.

## Project conventions

- All data is scoped to the single Account; foreign data gets a 403.
- Balances are derived from Transaction history, never stored.
- Deleted Wallets are frozen (read-only archives), never hard-deleted.
- See `CONTEXT.md` for the domain glossary and `docs/adr/` for decisions.
