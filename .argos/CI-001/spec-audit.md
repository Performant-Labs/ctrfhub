# Spec-enforcer Audit — CI-001

**Executed:** 2026-04-25 16:03
**Scope:** diff `main..story/CI-001`
**Checklists run:** Architecture rules (subset applicable to infrastructure), Coverage, Planning docs conformance, Skills violations (ctrf-ingest-validation — dog-food curl pattern only)

## Summary

CI-001 is an infrastructure-only story. The diff introduces 4 new files (`Dockerfile`, `.dockerignore`, `.github/workflows/ci.yml`, `.github/workflows/release.yml`) and flips `tasks.md` `CI-001` from `[ ]` → `[/]`. No files under `src/`, `src/__tests__/`, `e2e/tests/`, or `src/views/` were touched. Existing test suites (148 unit + 62 integration = 210 total) pass without regressions.

## Findings

| # | File:Line | Rule (cite source) | Remediation | Severity |
|---|---|---|---|---|
| — | — | — | — | — |

**No drift detected against `skills/` or `docs/planning/*`.**

## Coverage gaps

| # | What's missing | Required by | Severity |
|---|---|---|---|
| — | — | — | — |

**Coverage matches the story's declared Test tiers required and Page verification tiers.**

Rationale: `tasks.md §CI-001` declares "Test tiers required: none (meta)" and "Page verification tiers: none". No new routes, no new pure functions, no UI changes. The Test-writer correctly scoped T1 headless-only verification (YAML validity, job ordering, Dockerfile policy checks, regression run of existing 210 tests) — all 24 T1 checks passed. T2/T2.5/T3 are N/A.

## Planning-doc conformance (only lines relevant to this story's scope)

- [x] Ingest endpoint uses `x-api-token` header (not `Authorization: Bearer`) — `ci.yml:223` uses `-H "x-api-token: ${{ secrets.CTRFHUB_TOKEN }}"` per `architecture.md §Sending test reports to CTRFHub from CI` (line 529)
- [x] `lint` job runs `tsc --noEmit` + ESLint — `ci.yml:59,62` per `tasks.md §CI-001` acceptance
- [x] `unit` → `integration` → `e2e` jobs run sequentially — `ci.yml:96` (`integration needs: unit`), `ci.yml:126` (`e2e needs: integration`) per `tasks.md §CI-001` acceptance
- [x] `lint` job runs independently (parallel-safe) — `ci.yml:42` has no `needs:` per brief §Decision 2
- [x] E2E job ingests own CTRF report to staging (dog-food rule) — `ci.yml:213-226` per `architecture.md §Sending test reports to CTRFHub from CI`, guarded by `vars.CTRFHUB_STAGING_URL != ''`, `continue-on-error: true`
- [x] Multi-stage Dockerfile: `builder` → `runner` — `Dockerfile:19` (`AS builder`), `Dockerfile:49` (`AS runner`) per `architecture.md §Image build` (line 237)
- [x] Both stages use `node:22-alpine` — `Dockerfile:19,49` per `architecture.md §Image build`
- [x] Builder runs `npx tsc` and `npx @tailwindcss/cli --minify` — `Dockerfile:36,41` per `architecture.md §Image build` (line 243-244)
- [x] Runner uses `npm ci --omit=dev` — `Dockerfile:64` per `architecture.md §Image build` (line 248)
- [x] CMD is `["node", "dist/index.js"]` — `Dockerfile:80` per `architecture.md §Image build` (line 250)
- [x] HEALTHCHECK polls `/health` — `Dockerfile:76-77` per `architecture.md §Health endpoint` (line 474) and `deployment-architecture.md §Services`
- [x] Release workflow uses `GITHUB_TOKEN` (no hardcoded credentials) — `release.yml:98` per brief §Anti-patterns
- [x] Release builds `linux/amd64,linux/arm64` — `release.yml:123` per `architecture.md §CI / CD` (line 515)
- [x] Release pushes to `ghcr.io/ctrfhub/ctrfhub` — `release.yml:51` per `architecture.md §CI / CD` (line 516) and `tasks.md §CI-001`
- [x] `packages: write` declared at workflow level — `release.yml:47` per brief §Repo permissions check
- [x] All jobs use `ubuntu-latest` (no self-hosted runners) — all 4 CI jobs + release job per `cleanup/strip-self-hosted-runner-vestige`
- [x] `npm ci` used throughout (no `npm install`) — confirmed via grep; per brief §Anti-patterns
- [x] `.dockerignore` excludes all required paths — 11 required exclusions present (node_modules, dist, e2e, src/__tests__, docs, .argos, .antigravity, .env, .git, coverage, *.db); `.env.example` whitelisted with `!.env.example`
- [x] Per-PR and release are separate workflows — `ci.yml` (on pull_request + push:main) vs `release.yml` (on push:tags) per brief §Anti-patterns

## Forbidden-pattern scan (from CLAUDE.md)

Scan the diff for each forbidden pattern; note explicitly if none were found.

- [x] No `hx-target`/`hx-swap` inherited from a parent — N/A (no templates in diff)
- [x] No raw HTMX event names outside `src/client/htmx-events.ts` — N/A (no client code in diff)
- [x] No `hx-disable` anywhere in templates — N/A (no templates in diff)
- [x] No Alpine `x-data` inside an HTMX swap target (or vice versa) — N/A (no templates in diff)
- [x] No Postgres-only SQL / dialect-specific features without a SQLite equivalent — N/A (no entity/migration changes in diff)
- [x] No DB mocked in integration tests — N/A (no test files in diff)
- [x] No T3 visual assertions without corresponding T2 ARIA assertions — N/A (no test files in diff)
- [x] No layout-token change without a T2 backdrop-contrast re-check — N/A (no CSS in diff)
- [x] No raw CSRF-token or session-cookie handling outside Better Auth — N/A (no auth code in diff)
- [x] No Zod schema defined ad-hoc in a handler — N/A (no handler code in diff)
- [x] No `Dockerfile.dev` touched — confirmed: only `Dockerfile` (prod) in diff; `Dockerfile.dev` owned by CI-002
- [x] No self-hosted runners — confirmed: only `ubuntu-latest` in both workflows; `self-hosted` appears only in comments (as "FORBIDDEN" warnings)
- [x] No hardcoded credentials — `secrets.GITHUB_TOKEN`, `secrets.CTRFHUB_TOKEN`, `vars.CTRFHUB_STAGING_URL` all use GitHub secrets/vars mechanism
- [x] No `npm install` — confirmed: only `npm ci` used (verified via grep)

## Test regression verification (Spec-enforcer ran tests independently)

```
npm run test:unit  — 148 passed, 0 failed (6 files) in 0.89s ✓
npm run test:int   —  62 passed, 0 failed (3 files) in 2.04s ✓
Total: 210 tests green, no regressions.
```

## Verdict

**PASS** — story may proceed to Argos Phase 7 close-out and PR open.

All acceptance criteria from `tasks.md §CI-001` are satisfied:
1. ✅ `.github/workflows/ci.yml` with `unit` → `integration` (sequential) → `e2e` (`needs: integration`)
2. ✅ E2E job ingests own CTRF report to staging CTRFHub (dog-food rule, `continue-on-error: true`)
3. ✅ Docker multi-stage build (`builder` → `runner`)
4. ✅ `lint` job runs `tsc --noEmit` + ESLint
5. ✅ `release` job on tag pushes multi-arch image to `ghcr.io/ctrfhub/ctrfhub`

No BLOCKING or NIT findings. No coverage gaps. No planning drift. No forbidden patterns detected.
