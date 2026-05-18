# Spec-enforcer Audit — ctrfhub-docker-build-cache — iteration 1

**Executed:** 2026-05-17 20:22
**Reviewer:** spec-enforcer (Claude Opus 4.7) — read-only
**Scope:** diff `main..story/ctrfhub-docker-build-cache`
**Checklists run:** Planning-doc conformance (`architecture.md §Image build`, `deployment-architecture.md`), project-convention check (npm-script naming), forbidden-pattern scan, no-application-code constraint. Architecture-rules / Coverage / Skills-violation checklists are mostly N/A for a build-infra-only diff (no `src/`, no routes, no entities, no templates, no tests) — see notes below.

## Prior-iteration check (iteration > 1 only)

N/A — iteration 1; no `spec-audit-0.md` exists.

## Findings

| # | File:Line | Rule (cite source) | Remediation | Severity |
|---|---|---|---|---|
| — | — | — | — | — |

No drift detected against `skills/` or `docs/planning/*`.

Notes supporting the empty Findings table:

- **No application code changed.** `git diff main..story/ctrfhub-docker-build-cache --stat -- src/ tests/ e2e/` is empty. The brief's hard constraint ("Do not change application code; only `Dockerfile`, `.dockerignore`, and scripts/Make targets") holds. The diff touches `Dockerfile`, `.dockerignore`, `package.json`, `scripts/docker-build-cached.sh`, and `.argos/` story docs only.
- **`architecture.md §Image build` (lines 237–253) not contradicted.** The section describes the multi-stage shape (builder: `npm ci` → `npx tsc` → `@tailwindcss/cli --minify`; runner: copy `dist/` + prod deps, `CMD ["node","dist/index.js"]`). The diff preserves every element — it only prepends `# syntax=docker/dockerfile:1.7` and adds `--mount=type=cache,target=/root/.npm` to the two existing `npm ci` invocations. No build step was added, removed, or reordered by this story.
- **Layer order (scope item 4) — accepted documented decision.** `Dockerfile` runs `COPY . .` before `RUN ... npm ci`. Per the brief's binding "⚠️ Conflict resolution" section, this PR #71 order is deliberately NOT reverted (the `postinstall` hook needs `scripts/`+`src/client/` present). F documented the rationale in both the Dockerfile header and the `npm ci` step comment, as the resolution required. Not a finding — explicitly out of scope to re-litigate.
- **`deployment-architecture.md` not contradicted.** That doc references `compose*.yml`, named volumes, Caddy, and `/health` — none touched. `.dockerignore` now excludes `compose.yml`/`compose.dev.yml`/`compose.sqlite.yml` from the *build context*; this is correct, as the image's `COPY` directives never reference a compose file. Local-disk-only cache (`/tmp/ctrfhub-buildcache`, no remote registry) matches the brief constraint.
- **`package.json` script convention.** `docker:build:cached` follows the established colon-namespaced cadence (`test:unit`, `migrate:pg`, `css:build`, `schema:emit:pg`). Consistent with project conventions.
- **Shared-host constraint.** `scripts/docker-build-cached.sh` creates a dedicated story-scoped `ctrfhub-buildcache-builder` (`docker-container` driver) only if absent, writes only to its own `/tmp` cache dir and image tag, runs `set -euo pipefail`, and anchors to repo root via `cd "$(dirname "$0")/.."`. It never mutates the shared `default` builder or any other container. The 34-container Coolify stack is undisturbed (confirmed independently by T).

## Coverage gaps

| # | What's missing | Required by | Severity |
|---|---|---|---|
| — | — | — | — |

Coverage matches the story's declared verification posture. This is a verification-only build-infrastructure story: the diff adds no `src/` route, no exported `src/lib/` pure function, no Eta template, and no rendered surface — so there is nothing for the vitest or Playwright suites to exercise. T correctly authored no new tests and stated the reasoning explicitly (`test-handoff.md` "Tests added" section), per the brief's T1 instruction. The existing suite (23 files / 498 tests) is fully green and `tsc --noEmit` is clean — verified independently by both F and T. `npm run test:coverage` thresholds are unaffected (zero `src/` lines added).

## Planning-doc conformance (only lines relevant to this story's scope)

- [x] `architecture.md §Image build` (multi-stage builder/runner shape) preserved — `npm ci` → `tsc` → tailwind `--minify` in builder; `dist/` + prod deps + `CMD ["node","dist/index.js"]` in runner. Diff only adds cache mounts + `# syntax=` directive.
- [x] No application code changed — brief constraint "only `Dockerfile`/`.dockerignore`/scripts" satisfied (`git diff --stat -- src/ tests/ e2e/` empty).
- [x] Local-disk cache only, no remote registry cache — brief constraint satisfied (`type=local` `--cache-from`/`--cache-to`).
- [x] Shared 34-container Coolify host on Uranus undisturbed — brief constraint; story-scoped buildx builder, no global Docker mutation.
- [x] `package.json` script addition follows existing colon-namespaced convention.

Checklist items irrelevant to this story's scope (Ingest `x-api-token`, `/setup` 410, `/health` 503, dual-dialect migrations, auth `skipAuth`, HTMX/Alpine/Tailwind/Zod/MikroORM rules, integration-test patterns) are omitted — the diff contains no route, entity, migration, template, client code, or test file.

## Forbidden-pattern scan (from CLAUDE.md)

Scanned the diff for each forbidden pattern; none were found (the diff contains no template, client, entity, migration, or handler code in which any of these could appear):

- [x] No `hx-target`/`hx-swap` inherited from a parent — no template/HTMX code in diff
- [x] No raw HTMX event names outside `src/client/htmx-events.ts` — no client code in diff
- [x] No `hx-disable` anywhere — no template code in diff
- [x] No Alpine `x-data` inside an HTMX swap target — no template code in diff
- [x] No Postgres-only SQL / dialect-specific features — no entity or migration code in diff
- [x] No DB mocked in integration tests — no test files added (verification-only story, by design)
- [x] No T3 visual assertions without corresponding T2 ARIA assertions — non-UI story; T2/T2.5/T3 correctly N/A (`tier-2-report.md`)
- [x] No layout-token change without a T2 backdrop-contrast re-check — no CSS/layout-token/template change in diff
- [x] No raw CSRF-token or session-cookie handling outside Better Auth — no auth code in diff
- [x] No Zod schema defined ad-hoc in a handler — no handler code in diff

## Verdict

**PASS** — Argos may proceed to Phase 7 (open the PR).

The diff is confined to `Dockerfile`, `.dockerignore`, `package.json`, `scripts/docker-build-cached.sh`, and `.argos/` story docs. No application code changed. The `architecture.md §Image build` multi-stage shape is preserved; `deployment-architecture.md` is not contradicted. The binding scope-item-4 conflict resolution (un-reverted `COPY . .` → `npm ci` order) was honored and documented in the Dockerfile, exactly as the brief's resolution required — treated as an accepted decision, not a finding. The verification-only test posture is correct for a build-infra story and was explicitly justified by T. A's architecture review is PASS with two optional nits; T's tiers are PASS/N/A. No `block`-severity findings, no coverage gaps, no forbidden patterns.
