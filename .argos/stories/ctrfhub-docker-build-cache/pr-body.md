# [ctrfhub-docker-build-cache] Add Docker build-layer caching for fast iteration verification

## Summary

Each F↔A iteration of the orchestrator loop re-runs `docker build` from
scratch (~1 minute cold on Uranus). This PR adds build-layer caching so a
warm rebuild with no source change completes in 2–3 seconds: BuildKit
`--mount=type=cache` on both `npm ci` steps, a buildx local-cache script for
verification builds, a tightened `.dockerignore`, and confirmation that the
deps layer ordering is correct given the `postinstall` constraint. No
application code is touched.

## Acceptance criteria

Verbatim from `.argos/stories/ctrfhub-docker-build-cache/brief.md`. All verified
in `tier-1-report.md`.

- [x] Cold build time captured before and after the change (cold ≈ 57–60s; reported in `feature-handoff.md` and `tier-1-report.md`).
- [x] Warm build (second consecutive build, no source change) under 30 seconds — measured **2–3s** across three runs; all 20 build stages report `CACHED`.
- [x] All existing tests still pass — `npm test` → 498 tests pass (unchanged; no app-code change).
- [x] Coolify stack on Uranus undisturbed — 34 containers identical before/after; no global Docker command run.

## Test tiers

| Layer | Declared in tasks.md | Present in diff | Notes |
|---|---|---|---|
| Unit | n/a — build-infra story | N/A | No application code changed; brief forbids app-code edits |
| Integration | n/a | N/A | Nothing in `Dockerfile`/`.dockerignore`/shell script is exercised by vitest |
| E2E | n/a | N/A | No new route or UI surface |

No new test files were authored — this is a verification-only story; a shell
script and Dockerfile are not exercised by vitest/Playwright, and a synthetic
test would only re-shell-out to `docker build`. Reasoning is documented in
`tier-1-report.md`. T verified all four acceptance criteria independently.

## Page verification tiers

| Tier | Declared | Result | Report location (story branch) |
|---|---|---|---|
| T1 Headless | yes (judgment) | ✓ | `.argos/stories/ctrfhub-docker-build-cache/tier-1-report.md` |
| T2 ARIA (clean room) | no — no rendered route | N/A | `.argos/stories/ctrfhub-docker-build-cache/tier-2-report.md` |
| T2.5 Authenticated State | no — see tier-2-report.md | N/A | see `tier-2-report.md` |
| T3 Visual | no — no UI/CSS change | N/A | see `tier-2-report.md` |

## Architecture reviews

| # | Verdict | File |
|---|---|---|
| 1 | PASS | `.argos/stories/ctrfhub-docker-build-cache/architecture-review-1.md` |

## Decisions that deviate from spec

- **Scope item 4 reinterpreted as verify-and-document, not a layer-order revert.** The brief's item 4 asked to confirm `npm ci` runs *before* `COPY . .`, but the just-merged `ctrfhub-docker-build-fix` (#71) deliberately runs `COPY . .` first — the `postinstall` hook needs `scripts/` present. Argos issued a binding conflict resolution in the brief: do not revert. The `--mount=type=cache` mount (item 1) is what delivers the warm-build speedup — a BuildKit cache mount survives the `COPY . .` layer invalidation that an ordinary layer cache cannot.
- **`scripts/docker-build-cached.sh` creates a dedicated `ctrfhub-buildcache-builder` (`docker-container` driver)** rather than mutating the shared `default` buildx builder — the default `docker` driver cannot export `type=local` cache, and a shared-host story must not reconfigure shared infrastructure.
- **`.dockerignore` exclusions widened** (`*.md`, `Dockerfile*`, `compose*.yml`, `ctrf`, `coverage`, `test-results`, etc.). A audited every newly-excluded entry against build-time needs and confirmed nothing the build copies is now excluded.

## Gaps filed during this story

- none

## Spec-enforcer verdict

_Pending — `spec-audit-1.md` written at Phase 6.2; this section is updated to the final verdict before PR creation._

## Next assignable stories (after this merges)

- Queued in `.argos/stories/`: `orchestrator-autonomy-hardening`, `test-writer-discipline` (state not assessed by this story).

---
_Generated from `.argos/stories/ctrfhub-docker-build-cache/pr-body.md`. If you edit the PR description directly on GitHub, the `.argos/` source will not reflect those edits._
