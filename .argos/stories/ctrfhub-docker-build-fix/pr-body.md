# [ctrfhub-docker-build-fix] Fix Docker build failures so the SQLite stack builds and serves

## Summary

The CTRFHub Docker image failed to build, and even with the build fixed,
vendored client JS would 404 at runtime. This PR fixes both bugs with
minimal, well-scoped edits: it reorders the `Dockerfile` builder stage so
`postinstall` can find its sources, repairs the runner stage so it does not
re-trigger that hook against a source-free image, bridges vendored assets
from `src/assets/` to the `dist/assets/` directory production serves from,
and adds a static-asset auth bypass in `src/app.ts` so the now-served
assets are reachable.

## Acceptance criteria

Verbatim from `.argos/stories/ctrfhub-docker-build-fix/brief.md`. All verified
in `tier-1-report.md` against a directly-built image (see "Decisions that
deviate from spec" for why the build is verified directly rather than via
`compose.sqlite.yml up`).

- [x] The Docker image builds with no errors (`docker build` exits 0; all 18 stages complete).
- [x] The running container responds HTTP 200/302 on port 3000 (`/health` → 200, `/` → 302 `/setup`).
- [x] Vendored client JS is reachable at runtime — all 6 layout-referenced assets return 200, no 404s.

## Test tiers

| Layer | Declared in tasks.md | Present in diff | Notes |
|---|---|---|---|
| Unit | n/a — standalone bug-fix story | N/A | No new app logic beyond the `src/app.ts` auth hook |
| Integration | n/a | ✓ | 31 tests in `src/__tests__/integration/static-asset-auth-bypass.test.ts` |
| E2E | n/a | N/A | Build/runtime verification done at T1 against a live container |

## Page verification tiers

| Tier | Declared | Result | Report location (story branch) |
|---|---|---|---|
| T1 Headless | yes (judgment) | ✓ | `.argos/stories/ctrfhub-docker-build-fix/tier-1-report.md` |
| T2 ARIA (clean room) | no — no new rendered route | N/A | `.argos/stories/ctrfhub-docker-build-fix/tier-2-report.md` (N/A reasoning) |
| T2.5 Authenticated State | no — see tier-2-report.md | N/A | see `tier-2-report.md` |
| T3 Visual | no — build-infra + static-asset story, no rendered route | N/A | see `tier-2-report.md` |

## Architecture reviews

| # | Verdict | File |
|---|---|---|
| 1 | PASS | `.argos/stories/ctrfhub-docker-build-fix/architecture-review-1.md` |

## Decisions that deviate from spec

- **Acceptance criterion 1 verified via direct `docker build`, not `docker compose -f compose.sqlite.yml up`.** `compose.sqlite.yml` references a published registry image (`ghcr.io/ctrfhub/ctrfhub:latest`) with no `build:` stanza, so the literal command pulls rather than builds. André ruled (orchestration decision) that the criterion's wording is loose and `compose.sqlite.yml` stays a pull-image production file; the file is left untouched and the Dockerfile is verified directly.
- **Runner stage uses `--ignore-scripts` + an explicit `npm rebuild better-sqlite3`** (`Dockerfile`). The runner has no `scripts/`, no `src/client/`, and no `esbuild` devDep, so it cannot run the `postinstall` vendor-copy hook; skipping all install scripts and explicitly rebuilding the single native module that legitimately needs one is the narrow remedy. A confirmed this is architecturally sound.
- **New "Branch 0" early-return in the `src/app.ts` `onRequest` auth hook** exempts `/assets/*` from auth entirely. Without it the now-served vendored assets fall through to the `/login` redirect and acceptance criterion 3 cannot pass. A verified the bypass predicate exactly matches the sole `@fastify/static` registration, so auth posture for every non-asset route is unchanged.
- **Builder stage lost its separate `COPY package*.json` cache layer** (minor build-speed regression). Accepted deliberately: the brief forbids pipeline refactoring, and the `postinstall` hook genuinely needs sources present before `npm ci`.

## Gaps filed during this story

- none

## Spec-enforcer verdict

_Pending — `spec-audit-1.md` written at Phase 6.2; this section is updated to the final verdict before PR creation._

## Next assignable stories (after this merges)

- Queued in `.argos/stories/`: `ctrfhub-docker-build-cache`, `orchestrator-autonomy-hardening` (state not assessed by this story).

---
_Generated from `.argos/stories/ctrfhub-docker-build-fix/pr-body.md`. If you edit the PR description directly on GitHub, the `.argos/` source will not reflect those edits._
