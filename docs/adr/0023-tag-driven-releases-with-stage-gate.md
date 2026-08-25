# Prod deploys only from stage-verified release tags

Prod used to deploy on every push to `main` — any commit reached the real
domain with real data, and stage was a parallel copy that never gated
anything (prod updated regardless of what stage showed). Deploys are now
release-driven with **stage as the hard gate**: a `v*` tag builds the exact
artifact prod will run (both platforms under one version tag) and deploys
it to stage; prod is then deployed **only** by a human running the `CD
(prod)` workflow at that tag, whose gate step refuses tags whose images
don't exist — i.e. tags that never went through the release pipeline. Prod
can only ever run an artifact stage has run.

**Status**: accepted. Supersedes the push-to-main CD described in the
pre-ADR-0023 `docs/deploy-oracle.md`.

## Why a human gate, not an automated one

GitHub's environment approvals (`required reviewers`) need a second account,
which a solo developer does not have. A `workflow_dispatch` with the tag as
input is the same gate, operated by hand: releasing is a deliberate act, and
the click happens after the human has actually looked at `stage.budjetame.de`
— the strongest check a solo project can run. The workflow's gate job makes
the mechanical half of it (was this tag built at all?) impossible to skip.

## The artifact that moves through the gate

- `cd-release.yml` builds each platform **natively** (amd64 on the AMD64
  runner, arm64 on GitHub's free ARM64 runner — never QEMU, where the
  frontend's npm/tsc/vite toolchain grinds for hours) and assembles one
  `:vX.Y.Z` manifest with `buildx imagetools create`.
- Stage (AMD64) and prod (ARM64) both pull the **same version tag**; each
  VM's docker resolves the platform it needs from the manifest. Stage
  verifies the same commit, image build and configuration prod will run —
  the earlier per-environment image rebuilds (`:dev|:stage|:prod`) meant
  stage tested a build prod never ran.
- `dev` is untouched: a floating `:dev` tag on every `dev`-branch push. It
  stays the fast-iteration environment; releases are cut from what has been
  riding on it.

## Consequences

- **Rollback is a re-run**: deploying the previous tag restores the
  previous known-good images; the `db_data` volume carries over. No code
  changes needed to roll back.
- **Re-tagging on stage failure is safe**: nothing has reached prod, so the
  tag can be force-moved to the fixed commit (`git tag -f` + force-push).
  This keeps version numbers clean instead of burning a new version per
  failed attempt.
- The `stage` branch is retired — stage environment deploys come from tags
  now, not from the branch. The `main` branch no longer deploys anything
  (CI still runs on every push).
- A migration that breaks on real data is still caught **after** stage is
  already on the new schema: the recommended ritual is a `pg_dump` of prod
  restored into stage before promoting a release that touches the schema.
- Prod is now only as fresh as the last deliberate release; a typo on `main`
  can no longer go live by itself.
