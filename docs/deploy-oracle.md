# Deploying Budjetame on Oracle Cloud Always Free

A single ARM VM running the whole app in Docker — free forever (4 OCPU / 24 GB
RAM on the Ampere A1 shape), always on, no cold starts. The only thing Oracle
asks for is a credit card to verify your identity; nothing is ever charged.

```
browser ──▶ nginx (port 80) ──▶ /api/* ──▶ backend (uvicorn:8000) ──▶ postgres (internal only)
                │                                  ▲
                └───────── static SPA ─────────────┘
```

Everything below is **automated by `scripts/oracle-provision.sh`** — run that
instead of doing it by hand. This document is the canonical record of what it
does, for review and for when you want to do it manually.

## Architecture

- `compose.prod.yaml` — the production stack: `db` (postgres:16-alpine),
  `backend` (FastAPI, built from `backend/Dockerfile`), `frontend` (nginx
  serving the built SPA, built from `frontend/Dockerfile`).
- The backend container runs `alembic upgrade head` before boot, then
  `uvicorn`. The single Account is seeded at first boot from
  `BUDJETAME_SEED_ACCOUNT_*` env vars — **set them before the first start**;
  the seed only runs when the Account table is empty.
- `backend/alembic/env.py` honours `BUDJETAME_DATABASE_URL` so migrations run
  against the production database, not the local-dev default in `alembic.ini`.
- nginx proxies `/api/*` to the backend, stripping the prefix — the same
  contract as the Vite dev proxy. The browser is same-origin, so no CORS.
- Postgres is only reachable on the Docker internal network; nothing is
  published except nginx on port 80.

## One-time setup (manual record)

1. **Oracle account** — register at <https://signup.cloud.oracle.com> and
   verify your card. Use your home region (capacity for the free Ampere shape
   lives there). "Out of capacity" on the shape is common — retry later or
   pick another region.
2. **SSH keypair** (on your machine): `ssh-keygen -t ed25519 -f ~/.ssh/budjetame_oracle`
3. **VM** — Compute → Instances → Create: image **Canonical Ubuntu 24.04**
   (aarch64), shape **VM.Standard.A1.Flex**, **4 OCPU / 24 GB RAM** (all free),
   paste the public key. Note the public IP.
4. **Open port 80** — VCN → Security List → add ingress rule: TCP 80 from
   0.0.0.0/0 (SSH/22 is open by default).
5. **Docker** on the VM:
   ```bash
   ssh -i ~/.ssh/budjetame_oracle ubuntu@<IP>
   curl -fsSL https://get.docker.com | sh
   sudo usermod -aG docker ubuntu
   ```
6. **Code + secrets** — get the repo onto the VM (see below), then
   `cp .env.example .env` and fill it (`openssl rand -hex 32` for the two
   secrets; your real login for the seed account).
7. **Start**:
   ```bash
   docker compose -f compose.prod.yaml up -d --build
   ```
   First boot: image builds (~2 min on 4 ARM cores), migrations run, Account
   seeds. Verify: `curl http://<IP>/health` → `{"status":"ok"}`. Log in at
   `http://<IP>` with the seed email/password.

### Getting the code onto the VM

Works whether the repo is public or private — no credentials on the VM:

```bash
# on your machine
git bundle create /tmp/budjetame.bundle --all
scp -i ~/.ssh/budjetame_oracle /tmp/budjetame.bundle ubuntu@<IP>:~
# on the VM
git clone ~/budjetame.bundle budjetame-ai && cd budjetame-ai
git remote add origin https://github.com/amedeo-pasanisi/budjetame-ai.git
```

## Day 2

- **Update**: pull (or re-bundle), then
  `docker compose -f compose.prod.yaml up -d --build`.
- **Backup** (the only thing you own is `db_data`):
  `docker compose -f compose.prod.yaml exec db pg_dump -U budjetame budjetame > backup.sql`
- **TLS**: port 80 is plain HTTP. Before relying on this deployment, put it
  behind TLS — e.g. Caddy or a Cloudflare Tunnel (both free). This matters:
  the login travels in the clear otherwise.

## Troubleshooting

- **App unreachable** → check the security list (port 80), and that the VM is
  running (free instances stop if the account is suspended, not otherwise).
- **`{"detail":"Not Found"}` on `/api/...`** → you hit the backend directly or
  the nginx proxy rule is missing; requests must go through the frontend's
  port 80.
- **Login fails right after first boot** → you changed the seed env vars after
  the first start; the Account was seeded with the original values. Wipe the
  `db_data` volume (`docker compose -f compose.prod.yaml down -v`) and start
  again with the intended values.
- **Migrations didn't run** → check `BUDJETAME_DATABASE_URL` is set for the
  backend service; `alembic/env.py` refuses to guess when it's absent.
