# Tier 1 Headless Report — ctrfhub-docker-build-cache

**Executed:** 2026-05-17 20:19
**Method:** `docker buildx build` via `scripts/docker-build-cached.sh` + `npx tsc --noEmit` + `npm test` (vitest). No browser; this is a build-infrastructure story.

## Story nature

Build-infrastructure story. The diff touches only `Dockerfile`, `.dockerignore`,
`package.json`, `scripts/docker-build-cached.sh`, and `.argos/` story docs — no
application code, no new route, no new template (the brief explicitly forbids
app-code changes; A's review confirms zero `src/` changes). T1 here verifies the
brief's three measurable acceptance criteria directly, rather than HTTP routes.

## Checks

| # | What is being verified | Command | Expected | Actual | Status |
|---|---|---|---|---|---|
| 1 | Cold build completes (baseline, empty cache) | `CTRFHUB_BUILDCACHE_DIR=/tmp/ctrfhub-buildcache-t-verify` (freshly wiped) → `bash scripts/docker-build-cached.sh ctrfhub-buildcache-t-verify:cold` | build succeeds; cold time captured | succeeded — **57s** (script-reported) / 59.62s wall; expected "local cache import skipped" warning present (empty cache) | ✓ |
| 2 | Warm build (2nd consecutive, no source change) under 30s | `CTRFHUB_BUILDCACHE_DIR=/tmp/ctrfhub-buildcache-t-verify` (populated) → `bash scripts/docker-build-cached.sh ctrfhub-buildcache-t-verify:warm` | < 30s | **3s** script-reported / **2.27s** wall — well under 30s | ✓ |
| 3 | Warm build caches every layer, incl. both `npm ci` cache-mount steps | 3rd warm build, grep for `CACHED` per stage | all 20 build stages `CACHED`; no cache-import warning | every layer `CACHED` incl. `#10 RUN --mount=type=cache,target=/root/.npm … npm ci` (runner) and `#17 RUN --mount=type=cache,target=/root/.npm npm ci` (builder); no warning | ✓ |
| 4 | `tsc --noEmit` clean | `npx tsc --noEmit` | 0 errors | 0 errors | ✓ |
| 5 | All existing tests still pass | `npm test` (`vitest run`) | suite green | **23 test files, 498 tests passed (498)**, duration 7.21s | ✓ |
| 6 | Coolify stack on Uranus undisturbed | `docker ps` container audit before/after | Coolify stack unchanged | 34 Coolify/infra containers before and after; the only delta is `buildx_buildkit_ctrfhub-buildcache-builder0` (`moby/buildkit:buildx-stable-1`) — the story-scoped buildx backend created by scope item 2's script, not a Coolify container | ✓ |

## Independent verification notes

- **Cold baseline captured by T, not just trusted from F's handoff.** A fresh
  story-scoped cache dir (`/tmp/ctrfhub-buildcache-t-verify`) was wiped before the
  cold run so the import was genuinely empty. F's handoff reported a 45s cold
  cached build on a fast host; T observed 57s — same order of magnitude, the
  variance is host load. Both are the one-time cost paid once per cache lifetime.
- **Warm criterion is the binding acceptance gate.** Observed 2–3s across three
  consecutive warm builds — a >20x margin under the 30s threshold.
- **`--mount=type=cache` mechanism confirmed.** Both `npm ci` steps carry the
  cache mount and both report `CACHED` on warm builds; this is the mechanism the
  brief's conflict-resolution section designates as the warm-build accelerator
  given the `COPY . .` → `npm ci` layer order from PR #71.
- **Test count matches F's handoff exactly** (498/498, 23 files) — the diff
  changed no application code, so no test delta was expected, and none occurred.

## Excerpt of raw output

```
=== WARM BUILD (no source change) ===
==> Build complete in 3s — image: ctrfhub-buildcache-t-verify:warm
WARM_ELAPSED=2.27s

#10 [runner 5/6] RUN --mount=type=cache,target=/root/.npm  … npm ci …    CACHED
#17 [builder 5/8] RUN --mount=type=cache,target=/root/.npm npm ci        CACHED

 Test Files  23 passed (23)
      Tests  498 passed (498)

TSC: 0 errors
```

## Teardown (shared-host hygiene)

- Removed all three story-scoped images: `ctrfhub-buildcache-t-verify:{cold,warm,warm2}`.
- Removed the story-scoped cache dir `/tmp/ctrfhub-buildcache-t-verify`.
- Left intact (intended deliverables of this story, not disturbed):
  `ctrfhub-buildcache-builder` buildx builder + its `buildx_buildkit_*` container,
  the shared `default` builder, and all 34 Coolify/infra containers.
- No `docker system prune` or any global Docker command was run.

## Verdict

**PASS** — all three measurable acceptance criteria verified. No T2/T2.5/T3 escalation applies (see tier-2 report). Proceed to test-handoff.
