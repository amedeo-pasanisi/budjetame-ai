# Deploying Budjetame on Oracle Cloud Always Free

## Environments & pipeline

Three Always-Free environments, driven by GitHub Actions:

| Trigger | Environment | VM | URL |
|---|---|---|---|
| push to `dev` branch | **dev** | E2.1.Micro 1 GB (AMD) | https://dev.budjetame.de |
| `v*` tag (release candidate) | **stage** | E2.1.Micro 1 GB (AMD) | https://stage.budjetame.de |
| manual **CD (prod)** run at a tag | **prod** | A1.Flex 4 OCPU/24 GB (ARM) | https://budjetame.de |

Pushing to `main` deploys nothing (CI only); releases are cut from `main`
commits as tags.

- **CI** (`.github/workflows/ci.yml`): on every push/PR — frontend lint +
  build + vitest; backend mypy + pytest (testcontainers).
- **CD — dev** (`.github/workflows/cd.yml`): on push to the `dev` branch —
  builds `backend:dev`/`frontend:dev` (linux/amd64, on the AMD64 runner),
  pushes them to GHCR, then SSHes to the dev VM and runs
  `docker compose -f compose.deploy.yaml -p budjetame-ai up -d`. Fast
  iteration; a floating tag, rebuilt on every push.
- **CD — release** (`.github/workflows/cd-release.yml`): on a `v*` tag —
  the release candidate. Builds the exact artifact prod will run: both
  platforms, each natively (linux/amd64 on the AMD64 runner, linux/arm64
  on GitHub's free ARM64 runner — no QEMU emulation, which makes JS
  toolchain builds grind for hours), pushed as platform-suffixed tags and
  assembled by `buildx imagetools create` into one `:vX.Y.Z` manifest, then
  deploys that manifest to the **stage** VM. Stage is the hard gate: prod
  can only ever run an artifact stage has run.
- **CD — prod** (`.github/workflows/cd-prod.yml`): **manual only** — a
  human runs it from the Actions UI and picks the tag. A gate step refuses
  tags whose images don't exist (i.e. tags that never went through
  cd-release.yml), then deploys the same `:vX.Y.Z` manifest to the prod VM
  (ARM pulls the arm64 image from the manifest automatically). The project
  name matches the original prod stack, so the `db_data` volume — all
  data — carries over on every deploy.
- Secrets live in GitHub **environments** (`dev`/`stage`/`prod`): VM host,
  deploy SSH key, Postgres password, JWT secret, seed login. `BUDJETAME_JWT_EXPIRE_MINUTES`
  is optional — absent from the environment's secrets, the compose default
  (129600 minutes = 90 days, for the Android client) applies. The deploy SSH
  public key is in `~/.ssh/authorized_keys` on each VM; the private key is
  only in GitHub.
- VMs are provisioned by `scripts/oracle-provision.sh` + `scripts/oci_api.py`
  (pure-Python OCI client; the official oci-cli cannot install on Termux).
  `scripts/oci_api.py instance-list` lists the VMs;
  `instance-terminate <ocid>` tears one down (compute slot *and* boot
  volume — Always Free storage is freed too).

### Release ritual

1. **Ride on dev** — do the work on the `dev` branch; every push previews
   on `dev.budjetame.de`. Dev is where problems surface, not stage.
2. **Cut the tag** — update `CHANGELOG.md` (that section becomes the
   release notes), commit, then `git tag -a vX.Y.Z` on the green `main`
   commit and push it. `cd-release.yml` builds both platforms and deploys
   `vX.Y.Z` to stage automatically.
3. **Verify on stage** — log in at `stage.budjetame.de` and exercise the
   release. If it fails: fix on `main`, then force-move the tag
   (`git tag -f vX.Y.Z <fixed-sha> && git push --force origin vX.Y.Z`) —
   nothing has reached prod, so re-tagging is safe.
4. **Promote** — in the Actions UI, run **CD (prod)** and enter the tag.
   The gate refuses tags stage never built.
5. **Rollback** — run **CD (prod)** again with the previous tag; compose
   pulls the older images and `db_data` carries over.


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

## Domain & TLS

One domain serves all three environments (ADR-0018, ADR-0019):

| Environment | Hostname | DNS A record |
|---|---|---|
| prod | `budjetame.de` (+ `www`, redirects to the apex) | 89.168.30.119 |
| stage | `stage.budjetame.de` | 130.110.1.224 |
| dev | `dev.budjetame.de` | 92.4.163.113 |

- The domain is registered at Aruba (~€10/yr). DNS lives in Aruba's panel.
- Caddy in the frontend image terminates TLS with Let's Encrypt certificates
  (obtained and renewed automatically; `DOMAIN` env var per environment, set
  in `.env` / GitHub environment secrets) and redirects HTTP → HTTPS.
- The prod security list was updated with
  `scripts/oci_api.py sl-add-https <SL>` (ingress 443); the wizard's
  `sl-create` now opens 22, 80 and 443 for new VMs.
- The bare-IP URLs are retired: Caddy only answers for `DOMAIN`, so the IPs
  return nothing. Old bookmarks die with them — log in once at the new
  address (the browser's stored login does not carry across origins).
- dev/stage have no extra gate in front of the app — the Account login is
  the only protection there (ADR-0019).

## One-time setup (manual record)

The wizard (`scripts/oracle-provision.sh`) automates all of this except the
signup and one key upload; this is the record of what it does.

1. **Oracle account** — register at <https://signup.cloud.oracle.com> and
   verify your card. Use your home region (capacity for the free Ampere shape
   lives there). "Out of capacity" on the shape is common — retry later or
   pick another region.
2. **API key** — the wizard generates `~/.oci/budjetame_api_key.pem`, and you
   upload its public key in the console (Identity & Security → Users → your
   user → API Keys → Add API Key), then paste the Tenancy OCID, User OCID and
   home region. The wizard writes `~/.oci/config` (standard oci-cli format:
   `user`, `tenancy`, `fingerprint`, `key_file`, `region`) and smoke-tests the
   connection.

   **Why not the official oci-cli?** Its dependencies (`crc32c`, `cryptography`)
   have no Android wheels and don't compile with Termux's clang. Instead the
   wizard uses `scripts/oci_api.py` — a minimal REST client that ports the
   official oci-python-sdk signer (UPL 1.0 / Apache 2.0) onto the pure-Python
   `rsa` package (installed via `uv`). It reads the standard `~/.oci/config`,
   so the credentials work unchanged on a real machine with the official CLI.
   `selftest` verifies the crypto chain offline; `--dry-run` prints the signed
   request without sending.
3. **Network** — the wizard creates, via the REST API: VCN `10.0.0.0/16`,
   internet gateway, route table (`0.0.0.0/0` → gateway), security list
   (ingress TCP 22, 80 and 443, egress all), subnet `10.0.0.0/24`.
4. **Instance** — the wizard launches `VM.Standard.A1.Flex` (4 OCPU / 24 GB,
   Always Free eligible) with the newest Canonical Ubuntu 24.04 aarch64 image
   and your SSH public key, waits for RUNNING, and captures the public IP.
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
- **OCI API calls return 401** → wrong fingerprint (the console's fingerprint
  must match the one in `~/.oci/config`), or the key file doesn't match the
  uploaded public key. Re-run the wizard to redo the API-key stage.
- **OCI API calls return 404** → wrong Tenancy OCID (the availability-domain
  call hits it directly).
- **Login fails right after first boot** → you changed the seed env vars after
  the first start; the Account was seeded with the original values. Wipe the
  `db_data` volume (`docker compose -f compose.prod.yaml down -v`) and start
  again with the intended values.
- **Migrations didn't run** → check `BUDJETAME_DATABASE_URL` is set for the
  backend service; `alembic/env.py` refuses to guess when it's absent.
