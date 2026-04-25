# [CI-001] GitHub Actions CI pipeline + production Dockerfile

## Summary

Lays in the per-PR pipeline (`lint` → `unit` → `integration` → `e2e`), the tag-triggered multi-arch GHCR release, and the production multi-stage `Dockerfile` that CI-002 deferred. The release workflow publishes to `ghcr.io/ctrfhub/ctrfhub` — the path `compose.yml` (CI-002) already references — so the first `vX.Y.Z` tag pushed after this merges produces a runnable image. Unblocks CI-003 (Tugboat per-PR previews).

## Acceptance criteria

- [x] `.github/workflows/ci.yml` with: `unit` job → `integration` job (sequential) → `e2e` job (`needs: integration`).
- [x] E2E job ingests its own CTRF report into a staging CTRFHub instance (dog-food rule, `continue-on-error: true`, guarded on `vars.CTRFHUB_STAGING_URL != ''`).
- [x] Multi-stage Docker build: `builder` (TypeScript + Tailwind) → `runner` (Node 22 LTS Alpine, runtime-only).
- [x] `lint` job runs `tsc --noEmit` + ESLint.
- [x] `release` job triggered on git tag push; pushes a multi-arch image (`linux/amd64,linux/arm64`) to `ghcr.io/ctrfhub/ctrfhub`.

## Test tiers

| Layer | Declared in tasks.md | Present in diff | Notes |
|---|---|---|---|
| Unit | no (meta — orchestrates other tiers) | N/A | None expected per `tasks.md §CI-001`. Existing 148 unit tests across 6 files remain green (verified by Spec-enforcer). |
| Integration | no (meta — orchestrates other tiers) | N/A | None expected. Existing 62 integration tests across 3 files remain green (verified by Spec-enforcer). |
| E2E | no (meta — orchestrates other tiers) | N/A | None expected for CI-001 itself. The workflow runs `npm run test:e2e` against the existing (currently empty) Playwright suite — Playwright returns 0 with "no tests found" until later UI stories add specs. |

CI-001 is a configuration-only story. The brief and `tasks.md §CI-001` both declare "Test tiers required: none (meta — orchestrates other tiers)." Spec-enforcer confirmed coverage matches what the story declared.

## Page verification tiers

| Tier | Declared | Result | Report location (story branch) |
|---|---|---|---|
| T1 Headless | yes — YAML validity + Dockerfile policy + job ordering | ✓ | `.argos/CI-001/tier-1-report.md` (24 checks green) |
| T2 ARIA (clean room) | no — no rendered routes | N/A | n/a |
| T2.5 Authenticated State | no — no rendered routes | N/A | n/a |
| T3 Visual | no — no rendered routes | N/A | n/a |

## Decisions that deviate from spec

The spec-enforcer audit returned **PASS with zero findings**. The following six decisions are documented in `.argos/CI-001/feature-handoff.md` and surfaced here for André's independent review:

1. **Integration tests use SQLite in-memory; no Postgres service container in the `integration` job.** Matches the established `buildApp({ db: ':memory:' })` pattern from `skills/mikroorm-dual-dialect.md` (integration tests always use SQLite in-memory). Postgres is reserved for the `e2e` job where the full compiled app runs.
2. **`lint` job runs in parallel (no `needs: unit`).** Brief required lint to run on every PR but didn't mandate sequencing. Parallel reduces wall-clock; both still fail explicitly on disagreement.
3. **`better-sqlite3` compiled in both `builder` and `runner` stages (not copied from builder).** ABI compatibility insurance for multi-arch QEMU builds — adds ~30s but eliminates a class of runtime linker errors.
4. **Dog-food ingest step guarded by `vars.CTRFHUB_STAGING_URL != ''`.** If the variable isn't set (fresh repo, first few PRs), the step is silently skipped — not a job failure. Still `continue-on-error: true` for resilience when the variable IS set but staging is down.
5. **`release.yml` supports a `ci-*-smoke` tag pattern for dry-run testing.** Smoke-tagged images are published to GHCR but not tagged `:latest` — clean separation from real `vX.Y.Z` releases.
6. **BuildKit registry cache (`type=registry,ref=…:buildcache,mode=max`).** Chosen over `cache-from: type=gha` because the registry cache persists across branch checkouts and is more reliable for multi-arch builds.

## Known follow-ups (documented, not in scope here)

- **E2E job uses `node dist/index.js &` (background process) with a 60s health-wait loop.** Works but fragile if the app crashes on startup. CI-003 (Tugboat) is the right place to harden this with a service container or `docker compose up`.
- **Dog-food ingest is a dry-run placeholder** until `vars.CTRFHUB_STAGING_URL` / `vars.CTRFHUB_PROJECT_SLUG` / `secrets.CTRFHUB_TOKEN` are configured on the repo. CI-003 (Tugboat per-PR previews) is the correct place to harden this into a per-PR ingest.
- **No `dependabot.yml`.** The brief listed it as optional. Existing PR-Agent already reviews deps in PRs; dependabot would create noise. Recommend deciding before CI-003.
- **`e2e/tests/` is empty.** Playwright returns 0 with "no tests found" until later UI stories (DASH-*, SET-*, etc.) add specs — expected behavior, not a defect.

## Gaps filed during this story

None.

## Spec-enforcer verdict

**PASS** — see `.argos/CI-001/spec-audit.md`
**Date:** 2026-04-25
**Findings:** 0 blocking, 0 NIT, 0 coverage gaps, 0 forbidden patterns, 0 planning drift.

## Next assignable stories (after this merges)

- **CI-003** — Tugboat per-PR preview + dog-food CTRF ingestion. All three deps now satisfied (AUTH-001 ✅, CI-001 ⏳ merging, CI-002 ✅). Becomes the next CI-track story to assign.
- **CTRF-002** — already in flight on `story/CTRF-002` (Talos). Not affected by this merge.
- **AI-001** — depends only on INFRA-001 ✅; ready to brief whenever you want a third parallel track.

---
_Generated from `.argos/CI-001/pr-body.md`. If you edit the PR description directly on GitHub, the `.argos/` source will not reflect those edits._
