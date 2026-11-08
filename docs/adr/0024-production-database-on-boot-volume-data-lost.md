# Production database lived on the instance boot volume — data lost on termination

The production deployment (A1.Flex ARM instance) used `compose.prod.yaml` with a
Docker named volume `db_data` mapped to `/var/lib/postgresql/data`. No separate
block volume was provisioned; the volume lived on the instance's **boot volume**
— the root disk created when the instance launched.

When the instance was terminated (Oracle Always Free reclaim or accidental), the
boot volume was deleted with it. The entire production database — all user
accounts, wallets, transactions, recurring definitions, budgets — was **lost
irrecoverably**. Stage and dev environments were unaffected (they run on
separate E2.1.Micro instances with their own boot volumes).

**Status**: accepted. Supersedes the implicit assumption in the original
provisioning that the boot volume was "permanent enough."

## Context

The wizard (`scripts/oracle-provision.sh`) provisions a single A1.Flex
instance via `oci_api.py instance-launch`. It creates no block volumes, no
backup schedule, no managed database. The stack is self-contained on one VM:

```
compose.prod.yaml:
  volumes:
    db_data:          # Docker named volume → /var/lib/postgresql/data
```

On Oracle Cloud, an instance's boot volume is deleted when the instance is
terminated unless `preserveBootVolume=true` is explicitly passed. The
wizard's launch call does not set it; my later `instance-terminate` explicitly
passes `preserveBootVolume=false` to free the Always Free storage quota.
Either way, the boot volume was not meant to survive termination.

## Why it happened

- The original prototype optimized for "single VM, free tier, no moving parts"
  — a block volume adds cost (even on Always Free there's a 200 GB block
  storage limit, but it's a separate resource to manage) and operational
  complexity (attach, mount, fstab, resize).
- The Always Free tier's compute reclaim policy is documented but easy to
  forget: idle A1.Flex instances can be reclaimed. Our prod instance had
  real traffic, but the policy is opaque — it may have been reclaimed after
  a quiet period, or someone terminated it by mistake.
- No backup strategy existed. The only "backup" was the boot volume persisting
  across `docker compose up -d` restarts — which it did, until the instance
  itself disappeared.

## Consequences

- **All production data is gone.** No recovery possible.
- **Trust is damaged.** Real users had accounts; they now hit a fresh seed
  screen.
- **The next prod deployment starts from zero** — a new instance, a new boot
  volume, a new database seeded with one account.

## Path forward (decision required before re-provisioning)

Before standing up a new production instance, choose one:

### Option A — Block volume (cheapest, stays in Always Free)
1. Provision a 50–100 GB block volume in the same AD.
2. Attach it to the instance at launch (or after).
3. Format + mount it at `/mnt/data` (or similar).
4. Change `compose.prod.yaml` to `db_data:/mnt/data/postgres` (or bind-mount).
5. On termination, `preserveBootVolume=false` is safe; the block volume
   survives and re-attaches to the next instance.

### Option B — OCI Autonomous Database (Always Free tier)
- 2 free Autonomous Databases (20 GB each), fully managed, automated backups,
  no instance coupling.
- Change `BUDJETAME_DATABASE_URL` to the ADB connection string (TLS, wallet).
- Removes the database from the compute instance entirely — the VM becomes
  stateless and replaceable at will.
- Cost: zero on Always Free; the only "cost" is operational learning curve.

### Option C — Keep boot volume + add nightly `pg_dump` to Object Storage
- Cheapest to implement now (no new infra), but still loses data since the
  last dump on termination.
- OCI Object Storage has 10 GB free tier; a nightly `pg_dump | gzip` uploaded
  via `oci_api.py` or the OCI CLI is a few lines of script.
- Does not fix the root cause — the database is still ephemeral.

### Option D — Managed Postgres outside Oracle (Neon, Supabase, Fly.io, etc.)
- Not on Oracle; adds a vendor but gives real managed Postgres with PITR,
  branching, etc. Some have generous free tiers.
- The app already runs on Oracle compute; the database would cross the
  network boundary (latency, egress — but private within Oracle is not an
  option here unless using a VCN peering or VPN, which adds complexity).

## Recommendation

**Option A (block volume)** is the minimal change that preserves the current
architecture while making the database survive instance termination. It stays
within the Oracle free tier, adds ~5 minutes to the wizard, and requires no
application changes.

**Option B (Autonomous DB)** is the "right" long-term choice — fully managed,
backups, no coupling — but requires TLS/wallet handling and connection-string
changes. It also makes the compute instance truly stateless, which aligns with
the tag-driven release model (the VM becomes a cattle, not a pet).

**I recommend Option B** for a personal finance app with real users: the data
deserves managed durability, and the operational cost is a one-time migration.
Option A is an acceptable interim if you want to restore service fast and
migrate later.

## Immediate action

1. Document the loss in the release notes / changelog (transparent to users).
2. Choose A or B (or another).
3. Extend the wizard / `oci_api.py` / `compose.prod.yaml` accordingly.
4. Re-provision prod, deploy v1.1.1 (or v1.2.0) through the pipeline.

No production deployment should happen until the database durability story is
explicit and tested.