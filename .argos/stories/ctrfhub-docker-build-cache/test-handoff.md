# Test Handoff — ctrfhub-docker-build-cache

**Branch:** `story/ctrfhub-docker-build-cache`
**Commits added by Test-writer:**
- `test(ctrfhub-docker-build-cache): verification reports` — tier-1, tier-2, and test-handoff reports under `.argos/stories/ctrfhub-docker-build-cache/`. No application or test-source files changed (verification-only story — see below).

## Tier summary

| Tier | Status | Report |
|---|---|---|
| T1 Headless | ✓ | `.argos/stories/ctrfhub-docker-build-cache/tier-1-report.md` |
| T2 ARIA (clean room) | N/A — non-UI build-infra story; no rendered route | `.argos/stories/ctrfhub-docker-build-cache/tier-2-report.md` |
| T2.5 Authenticated State | N/A — non-UI build-infra story; no auth-gated route | `.argos/stories/ctrfhub-docker-build-cache/tier-2-report.md` |
| T3 Visual | N/A — non-UI build-infra story; no rendered surface | `.argos/stories/ctrfhub-docker-build-cache/tier-2-report.md` |
| Backdrop-contrast | N/A — no CSS/layout-token/template change | inline in tier-2 report |

## Tests added

**None — this is a verification-only story.** Reasoning (stated per the brief's
T1 instruction):

- The diff touches only `Dockerfile`, `.dockerignore`, `package.json`, and
  `scripts/docker-build-cached.sh`. A shell script and a Dockerfile are **not
  exercised by the vitest or Playwright suites** — there is no application code
  path, no route, no pure function, and no rendered screen to assert against.
- The brief explicitly **forbids application-code changes**, so no new
  `src/` behaviour exists that would need a unit or integration test.
- Authoring a vitest/Playwright test purely to produce a test-file diff would be
  a low-value test (it could only re-shell-out to `docker build`, duplicating
  what `scripts/docker-build-cached.sh` already is). The brief instructs T to
  state this explicitly rather than invent such tests. **Done so here.**
- The story's three acceptance criteria are **measurable build outcomes** and
  were verified directly in Tier 1 by running the build script and the existing
  suite — that is the appropriate verification for build infrastructure.

| Layer | Files | Tests | Notes |
|---|---|---|---|
| Unit | — | 0 | N/A — no new pure function |
| Integration | — | 0 | N/A — no new route |
| E2E | — | 0 | N/A — no new screen |

## Acceptance-criteria verification (the substance of this handoff)

| Criterion (from brief) | Result | Status |
|---|---|---|
| Cold build time captured before/after | Cold build (fresh empty cache) = **57s** (script) / 59.62s wall | ✓ |
| Warm build (2nd consecutive, no source change) under 30s | **3s** (script) / **2.27s** wall — measured across 3 consecutive warm builds, all 2–3s | ✓ |
| All existing tests still pass | `npm test` → **23 files, 498 tests passed (498)** | ✓ |
| `tsc --noEmit` clean | **0 errors** | ✓ |
| Coolify stack on Uranus undisturbed | 34 Coolify/infra containers before and after; the only `docker ps` delta is the story-scoped `buildx_buildkit_ctrfhub-buildcache-builder0` backend (scope item 2's intended artifact) | ✓ |

## Coverage (from `npm run test:coverage`)

Not re-run — no test files were added or modified, so the coverage figure is
unchanged from `main`. Coverage thresholds are unaffected by a build-infra-only
diff (no `src/` lines added). N/A for this story.

## Non-blocking issues (if any)

- The first cached build after wiping the cache dir logs `WARNING: local cache
  import … skipped … no such file or directory`. Confirmed during T's cold run;
  expected and harmless on an empty cache, disappears on every warm build.
  Already documented in F's handoff "Known issues". No action needed.
- `/tmp/ctrfhub-buildcache` is not persistent across host reboots — first
  post-reboot build is cold again. Acceptable for a dev-iteration cache;
  overridable via `$CTRFHUB_BUILDCACHE_DIR`. Already documented by F. No action.
- The `ctrfhub-buildcache-builder` buildx builder and its `buildx_buildkit_*`
  container remain running after T's verification. This is **intentional** — it
  is the deliverable of scope item 2; the script recreates it on demand if
  removed. It is fully isolated from the Coolify `default` builder. Not a defect.

## Verdict

**PASS** — all four/five brief acceptance criteria verified independently by T;
the existing suite is fully green (498/498); `tsc --noEmit` is clean; the
Coolify stack is undisturbed. No structural/visual tiers apply (non-UI story).
Argos may proceed to Phase 6 close-out.
