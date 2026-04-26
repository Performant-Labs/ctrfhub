# Feature Handoff — CI-001: GitHub Actions CI pipeline

**Branch:** `story/CI-001`
**Commits on this branch since `main`:**
- `4ff8a48` chore(CI-001): assign
- `ca73343` feat(CI-001): add production Dockerfile, .dockerignore, ci.yml, release.yml

---

## What was built

- **`Dockerfile`** — Production multi-stage image: `builder` stage compiles TypeScript (`npx tsc`) and builds minified Tailwind CSS (`npx @tailwindcss/cli --minify`); `runner` stage copies `dist/` and installs prod-only deps with `npm ci --omit=dev`. Both stages use `node:22-alpine` to ensure `better-sqlite3`'s native `.node` file links against the same musl libc version. HEALTHCHECK polls `/health` via `wget`. CMD is `node dist/index.js`.
- **`.dockerignore`** — Excludes `node_modules`, `dist`, `e2e`, `src/__tests__`, `docs`, `.argos`, `.antigravity`, `.env*` (except `.env.example`), `*.db`, `coverage`, `.git`, `.claude-bridge` — keeps build context at ~600KB.
- **`.github/workflows/ci.yml`** — Per-PR pipeline: `lint` (tsc --noEmit + eslint, parallel-safe) → `unit` → `integration` (needs unit, SQLite in-memory — no Postgres service required) → `e2e` (needs integration, Postgres 16-alpine service container). Uses `actions/setup-node@v4` with `cache: 'npm'`. Dog-food ingest step at end of `e2e` is `continue-on-error: true` — requires `vars.CTRFHUB_STAGING_URL`, `vars.CTRFHUB_PROJECT_SLUG`, `secrets.CTRFHUB_TOKEN` to be configured on the repo.
- **`.github/workflows/release.yml`** — On `v*.*.*` tag push or `workflow_dispatch`: builds multi-arch (`linux/amd64,linux/arm64`) image via QEMU + Buildx; pushes to `ghcr.io/ctrfhub/ctrfhub:<tag>` and `:latest` (semver tags only, not smoke tags); uses GITHUB_TOKEN with `packages: write`; registry-mode BuildKit cache for fast re-runs; smoke-verifies published image returns `v22.x` from `node --version`.

---

## Commands run locally (results)

- `tsc --noEmit` — 0 errors (exit 0)
- `docker build -f Dockerfile -t ctrfhub:ci-001-local .` — **succeeded in 42.7s** ([+] Building 42.7s (19/19) FINISHED)
- `docker run --rm ctrfhub:ci-001-local node --version` — **v22.22.2** ✅
- `npm run migrate:create:pg` — N/A (no entity changes in this story)
- `npm run migrate:create:sqlite` — N/A (no entity changes in this story)
- `npm run dev` — not run (no app code changes; existing dev server unaffected)

---

## Files created or modified

- `Dockerfile` — Production multi-stage Docker image (new)
- `.dockerignore` — Docker build context exclusion list (new)
- `.github/workflows/ci.yml` — Per-PR lint/unit/integration/e2e pipeline (new)
- `.github/workflows/release.yml` — GHCR multi-arch publish on tag push (new)

No files in `src/`, `src/views/`, `src/migrations/`, or `e2e/tests/` were touched.

---

## Decisions not covered by planning docs

1. **Integration tests use SQLite in-memory — no Postgres service container in `integration` job.** The `buildApp({ db: ':memory:' })` pattern is the established testing pattern (skills/mikroorm-dual-dialect.md §Integration tests always use SQLite in-memory). Adding a Postgres container would be redundant waste. Postgres is reserved for the `e2e` job where the full compiled app runs.

2. **`lint` job runs in parallel (not `needs: unit`).** The brief says lint must run on every PR; it doesn't mandate sequencing with unit. Running lint in parallel reduces wall-clock time. If lint and unit disagree on type errors, both fail explicitly — no ambiguity.

3. **`better-sqlite3` compiled in both builder and runner stages (not copied from builder).** The compiled `.node` file is architecture/libc-specific. To be safe across all build environments (and especially for multi-arch QEMU builds), re-compiling in the runner using the same base image guarantees ABI compatibility. This adds ~30s but eliminates a class of runtime linker errors.

4. **Dog-food ingest step is guarded by `vars.CTRFHUB_STAGING_URL != ''`.** If the variable isn't set (fresh repo forks, first few PRs), the step is silently skipped — not a job failure. The step is still `continue-on-error: true` for extra resilience when the variable IS set but staging is down. Argos can configure the variable when staging is available.

5. **Release workflow supports `ci-*-smoke` tag pattern for dry-run testing.** The tag pattern `ci-001-smoke` (and future `ci-003-smoke` etc.) allows testing the release pipeline without cluttering the `v*.*.*` release history. Smoke-tagged images are published to GHCR but not tagged `:latest`.

6. **BuildKit registry cache (`type=registry,ref=…:buildcache,mode=max`).** Chosen over `cache-from: type=gha` because the registry cache persists across branch checkouts and is more reliable for multi-arch builds. The `buildcache` tag is a write-only cache artifact — not a runnable image.

---

## Known issues / follow-ups

- **E2E job in `ci.yml` runs `node dist/index.js &` (background process) with a 60s health-wait loop.** This works but is fragile if the app crashes on startup (the loop times out rather than fast-fails). CI-003 (Tugboat) should use a proper service container or `docker compose up` instead. For now, the 30-attempt × 2s loop provides ~60s window which exceeds the typical cold-boot + migration time seen locally (~15s).
- **Dog-food ingest is a dry-run placeholder.** `vars.CTRFHUB_STAGING_URL` is not yet set on the repo. The step will be silently skipped on all PRs until Argos configures it. CI-003 (Tugboat per-PR previews) is the correct place to harden this into a per-PR ingest.
- **No `dependabot.yml` added.** The brief listed it as "optional / nice-to-have". Given the existing PR-Agent workflow already reviews deps in PRs, dependabot would create noise. Recommend Argos decide before CI-003.
- **E2E tests have no spec files yet** (e2e/tests/ is empty). The `npm run test:e2e` step will exit 0 with "No tests found" — Playwright returns 0 when no tests match. This is fine for CI-001; actual E2E specs land in later stories.

---

## Next action (Test-writer)

1. Open a new session. Paste `.antigravity/agents/test-writer.md` as the first message, then this handoff as the second.
2. Check out `story/CI-001` — `git checkout story/CI-001`.
3. **No application code was changed** — no T1/T2/T2.5/T3 integration tests to write for routes.
4. The test-writer's verification scope for this story:
   - **T1 Headless:** confirm `docker build -f Dockerfile .` completes (already verified locally). Confirm `docker run --rm <image> node --version` returns `v22.x`.
   - **T1 Headless:** validate `.github/workflows/ci.yml` YAML is valid (`python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"` and same for `release.yml`).
   - **T1 Headless:** confirm the `lint` → `unit` → `integration` → `e2e` job ordering via `needs:` inspection.
   - T2 / T2.5 / T3 not applicable — no rendered UI in this story.
