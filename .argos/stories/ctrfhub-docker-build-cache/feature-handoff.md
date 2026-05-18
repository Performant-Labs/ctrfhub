# Feature handoff — ctrfhub-docker-build-cache

## Iteration 1

**Date:** 2026-05-17
**Branch:** `story/ctrfhub-docker-build-cache`
**Commits added this iteration:**
- (see `git log` — `perf(ctrfhub-docker-build-cache): add Docker build-layer caching for fast iteration`)

### What was built / fixed

- **Scope item 1 — BuildKit npm cache mounts.** Added `# syntax=docker/dockerfile:1.7` to `Dockerfile` and converted both `npm ci` steps to `RUN --mount=type=cache,target=/root/.npm`: the builder-stage `npm ci` and the runner-stage combined `apk add … && npm ci --omit=dev … && npm rebuild …` step. These are the only long install steps.
- **Scope item 2 — buildx local-cache backend.** Added `scripts/docker-build-cached.sh` (executable) and the `docker:build:cached` npm script. The script runs `docker buildx build` with `--cache-from`/`--cache-to type=local`. Cache dir: **`/tmp/ctrfhub-buildcache`** (override via `$CTRFHUB_BUILDCACHE_DIR`). Documented inline in the script header and in the `Dockerfile` header comment.
- **Scope item 3 — `.dockerignore` audit.** Tightened the build context. Added exclusions for `test-results`, `coverage`, `.nyc_output`, `ctrf`, `playwright-report`, `.claude`, `.intent`, `.tugboat`, `.github`, `.husky`, `.mergify.yml`, `.pr_agent.toml`, `.eslintrc.json`, `tsconfig.eslint.json`, `*.md`, `.gitattributes`, `Dockerfile*`, `.dockerignore`, and `compose*.yml`. `node_modules`, `dist`, `.git`, `.argos`, `.env*` were already excluded. `.e2e-test.db` is covered by the existing `*.db` glob.
- **Scope item 4 — layer-ordering verification (see conflict resolution below).**

### Conflict-item-4 handling (binding resolution honored)

Per the brief's "⚠️ Conflict resolution" section, scope item 4 was treated as **verify-and-document only**. The `ctrfhub-docker-build-fix` (PR #71) builder stage deliberately runs `COPY . .` *before* `npm ci` because the `postinstall` hook (`scripts/copy-vendor-assets.mjs`) needs `scripts/` and `src/client/` present at install time. **I did NOT revert that layer order.** Instead I confirmed it is correct given the postinstall constraint and documented — in the `Dockerfile` header and in the `npm ci` step comment — that scope item 1's `--mount=type=cache` is the mechanism delivering the warm-build speedup: a BuildKit cache mount survives the `COPY . .` layer invalidation that an ordinary layer cache cannot. No further conflict was found.

### Commands run locally (results)

- `docker build --no-cache -f Dockerfile -t ctrfhub-buildcache-test:baseline .` — **cold baseline ≈ 30s** (fast host; brief estimates ~2–3 min on a typical Uranus build).
- `bash scripts/docker-build-cached.sh ctrfhub-buildcache-test:cached` (run 1, empty cache) — **cold cached build = 45s** (includes one-time cache-export overhead; the "local cache import skipped" warning is expected on the first run with an empty cache dir).
- `bash scripts/docker-build-cached.sh ctrfhub-buildcache-test:cached` (run 2, no source change) — **warm build = 2s** ✅ well under the 30s acceptance criterion.
- Run 3 (warm, full log) — confirmed every layer reports `CACHED`, including both `RUN --mount=type=cache … npm ci` steps; no cache-import warning.
- `npx tsc --noEmit` — 0 errors.
- `npm test` — 23 test files, **498 tests passed**.
- `docker ps -q | wc -l` — 34 containers before and after; the Coolify stack on Uranus was not disturbed.

### Files created or modified

- `Dockerfile` — added `# syntax=docker/dockerfile:1.7` directive; converted both `npm ci` steps to `RUN --mount=type=cache,target=/root/.npm`; expanded header comments explaining the cache strategy and the layer-order rationale.
- `.dockerignore` — tightened build context (see scope item 3 above).
- `package.json` — added `docker:build:cached` script invoking the new build script.
- `scripts/docker-build-cached.sh` — new executable script: cache-backed buildx build using a dedicated `docker-container`-driver builder and a local-disk cache backend.

### Decisions not covered by planning docs

- **Dedicated buildx builder (`ctrfhub-buildcache-builder`).** The host's default buildx builder uses the `docker` driver, which cannot export `--cache-to type=local`. The script creates a story-scoped `docker-container`-driver builder on first use rather than reconfiguring the shared `default` builder — required by the shared-host constraint. Adjoins the brief's scope item 2; no planning doc covers buildx driver choice.
- **`*.md` excluded from the build context.** No runtime code reads a Markdown file (the image runs compiled `dist/` only), and the repo carries large top-level `.md` notes (`MOVE_TO_URANUS_PLAN.md`, etc.). Adjoins scope item 3.
- **Cache dir `/tmp/ctrfhub-buildcache`.** Matches the path suggested verbatim in the brief; overridable via `$CTRFHUB_BUILDCACHE_DIR`.

### Known issues / follow-ups

- The first cached build after wiping `/tmp/ctrfhub-buildcache` logs `WARNING: local cache import … skipped … no such file or directory`. This is expected (empty cache) and harmless — it disappears on every subsequent build.
- `/tmp` is not persistent across host reboots; after a reboot the first build will be cold again. Acceptable for a dev-iteration cache. A persistent location can be set via `$CTRFHUB_BUILDCACHE_DIR` if desired.
- The story-scoped builder and test images created during verification were torn down (`docker buildx rm ctrfhub-buildcache-builder`, `docker image rm ctrfhub-buildcache-test:*`). The script recreates the builder automatically on next invocation.
