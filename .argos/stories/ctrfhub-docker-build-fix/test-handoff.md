# Test Handoff — ctrfhub-docker-build-fix

**Branch:** `story/ctrfhub-docker-build-fix`
**Commits added by Test-writer:**
- `test(ctrfhub-docker-build-fix): verify Docker build + Branch 0 static-asset auth bypass`

## Orchestrator decision honored

Acceptance criterion 1 names `docker compose -f compose.sqlite.yml up -d`
literally. Per André's ruling, that wording is loose: `compose.sqlite.yml` is
a pull-image production file (`image:` ref, no `build:` stanza) and was left
untouched. Criteria 1–3 were verified against a **directly-built image** —
`docker build -f Dockerfile` → `docker run` → `curl` assertions. This aligns
with architecture review iteration-1 finding #1.

## Shared-host discipline

The live 34-container Coolify stack on Uranus was never touched. All
story-scoped Docker resources used distinct names (`ctrfhub-buildfix-test:t1`,
container `ctrfhub-buildfix-test-c`, volumes `ctrfhub-buildfix-test-sqlite` /
`ctrfhub-buildfix-test-artifacts`, host port 3999) and were fully torn down.
No global Docker command (`prune`, `system`, etc.) was run. Post-teardown:
0 residual story resources; `docker ps` count unchanged at 34.

## Tier summary

| Tier | Status | Report |
|---|---|---|
| T1 Headless | ✓ | `.argos/stories/ctrfhub-docker-build-fix/tier-1-report.md` |
| T2 ARIA (clean room) | N/A — non-UI story; no new/changed rendered route | `.argos/stories/ctrfhub-docker-build-fix/tier-2-report.md` |
| T2.5 Authenticated State | N/A — non-UI story; auth-hook change verified structurally at T1 via `fastify.inject()` | `.argos/stories/ctrfhub-docker-build-fix/tier-2-report.md` |
| T3 Visual | N/A — non-UI story; no rendered design slice changed | `.argos/stories/ctrfhub-docker-build-fix/tier-2-report.md` |
| Backdrop-contrast | N/A — no CSS / layout-token / template change in diff | `.argos/stories/ctrfhub-docker-build-fix/tier-2-report.md` |

T2/T2.5/T3 N/A reasoning is documented in full in `tier-2-report.md` (not
silently omitted): the diff touches only `Dockerfile` and `src/app.ts`
(static-asset serving + build infra) and adds no rendered route or template.

## Acceptance criteria — verdict

| # | Criterion | Result |
|---|---|---|
| 1 | Image builds with no errors | ✓ `docker build` exit 0; all 18 stages completed (builder Bug 1 reorder + Bug 2 asset bridge + runner `--ignore-scripts`/`npm rebuild` all succeeded) |
| 2 | Running container responds 200/302 on port 3000 | ✓ `/health` → 200; `/` → 302 `/setup` (expected on fresh DB; criterion accepts 302) |
| 3 | Vendored client JS reachable, no 404s | ✓ all 6 layout-referenced assets (`htmx`, `idiomorph-ext`, `alpine`, `flowbite`, `app.js`, `tailwind.css`) → 200; missing asset still correctly 404s |

## Tests added

| Layer | Files | Tests | Notes |
|---|---|---|---|
| Unit | — | 0 | No new pure function in the diff (Dockerfile + one auth-hook early-return) |
| Integration | `src/__tests__/integration/static-asset-auth-bypass.test.ts` | 31 | Branch 0 auth bypass: `/assets/*` reachable without auth; missing assets still 404; non-asset auth posture unchanged across Branches 1/3/5; path-prefix exactness; query-string handling |
| E2E | — | 0 | No new rendered screen; static-asset serving has no UI flow to drive |

## Coverage (from `npm run test:coverage`)

Lines: 88.92% · Functions: 95.31% · Branches: 81.42%
Thresholds: lines ≥ 80, functions ≥ 80, branches ≥ 75. **PASS**
Full suite: 23 test files, 498 tests, all passing. Integration suite alone:
195 tests, all passing — no regression from the new file.

## Non-blocking issues

- `/assets/tailwind.css` is a build-output artifact (Tailwind CLI,
  `npm run css:build`), not a postinstall-vendored file, and is gitignored.
  The integration test gives the five postinstall-vendored JS files the full
  `200` assertion (reliably present after `npm install`) and gives
  `tailwind.css` a conditional `200`/`404` + always-applies no-redirect
  assertion, so the suite is deterministic whether or not the CSS build has
  run in a given environment. In the Docker image `tailwind.css` IS present
  (the builder runs `npm run build`) and was verified `200` at T1.
- Architecture review finding #2 (dead `/assets/` clause in Branch 1's
  `isExemptFromEmptyCheck` allowlist) is a non-blocking nit A explicitly
  marked optional/defensive. Not a test concern; left as-is by F.

## Verdict

**PASS** — Argos may proceed to Phase 6 close-out. All three acceptance
criteria are satisfied against a directly-built image; the Branch 0 auth
bypass is fully covered and the auth posture of every non-asset route is
proven unchanged; full test suite green; coverage above thresholds.
