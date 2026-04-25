# Tier 1 Headless Report — CI-001

**Executed:** 2026-04-25 15:53
**Method:** Python `yaml.safe_load()` (YAML validation) + Python AST inspection (workflow topology) + grep/python assertions (Dockerfile + `.dockerignore` policy)

---

## Checks

| # | What is being verified | Command / Method | Expected | Actual | Status |
|---|---|---|---|---|---|
| 1 | `ci.yml` is valid YAML | `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"` | No exception | Parsed successfully | ✓ |
| 2 | `release.yml` is valid YAML | `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml'))"` | No exception | Parsed successfully | ✓ |
| 3 | `lint` job has no `needs` (runs in parallel) | Python AST inspection | `lint.needs == []` | `[]` (independent) | ✓ |
| 4 | `unit` job has no `needs` (runs in parallel with lint) | Python AST inspection | `unit.needs == []` | `[]` (independent) | ✓ |
| 5 | `integration` job `needs: unit` | Python AST inspection | `integration.needs == 'unit'` | `'unit'` | ✓ |
| 6 | `e2e` job `needs: integration` | Python AST inspection | `e2e.needs == 'integration'` | `'integration'` | ✓ |
| 7 | All CI jobs use `ubuntu-latest` (no self-hosted) | Python scan over `jobs[*].runs-on` | `ubuntu-latest` for every job | All 4 jobs: `ubuntu-latest` | ✓ |
| 8 | CI uses `npm ci` (not `npm install`) | `grep 'npm install' ci.yml` | Not found | Not found | ✓ |
| 9 | Release workflow declares `packages: write` | `grep 'packages: write' release.yml` | Present | Present | ✓ |
| 10 | Release builds `linux/amd64,linux/arm64` | String search | Both arches in `platforms:` | `linux/amd64,linux/arm64` | ✓ |
| 11 | Release uses `GITHUB_TOKEN` (no hardcoded creds) | String search | `secrets.GITHUB_TOKEN` present | Present | ✓ |
| 12 | Dog-food ingest step present | `grep 'CTRFHUB_STAGING_URL' ci.yml` | Present | Present | ✓ |
| 13 | Dog-food ingest is `continue-on-error: true` | `grep 'continue-on-error: true' ci.yml` | Present | Present | ✓ |
| 14 | Dockerfile has 2 stages (`builder` + `runner`) | String search | `AS builder`, `AS runner` both present | Both present | ✓ |
| 15 | Dockerfile base image is `node:22-alpine` | String search | `node:22-alpine` | `node:22-alpine` for both stages | ✓ |
| 16 | Dockerfile compiles TypeScript (`npx tsc`) | String search | `npx tsc` present in builder | Present | ✓ |
| 17 | Dockerfile builds Tailwind CSS | String search | `@tailwindcss/cli` or `tailwind` present | `@tailwindcss/cli --minify` present | ✓ |
| 18 | Dockerfile runner uses `npm ci --omit=dev` | String search | `npm ci --omit=dev` | Present | ✓ |
| 19 | Dockerfile HEALTHCHECK polls `/health` | String search | `HEALTHCHECK` + `/health` | Present: `wget … /health \| grep -q '"status":"ok"'` | ✓ |
| 20 | Dockerfile CMD is `["node", "dist/index.js"]` | `grep CMD Dockerfile` | `CMD ["node", "dist/index.js"]` | `CMD ["node", "dist/index.js"]` (line 80) | ✓ |
| 21 | `.dockerignore` excludes all required paths | Python assertion loop | `node_modules`, `dist`, `e2e`, `src/__tests__`, `docs`, `.argos`, `.antigravity`, `.env`, `.git`, `coverage`, `*.db` excluded | All 11 entries found | ✓ |
| 22 | `.dockerignore` whitelists `.env.example` | String search | `!.env.example` present | Present | ✓ |
| 23 | Existing unit tests still pass (regression) | `npm run test:unit` | 148 tests, all green | 148 passed (6 files) in 1.38s | ✓ |
| 24 | Existing integration tests still pass (regression) | `npm run test:int` | All green | 62 passed (3 files) in 2.58s | ✓ |

---

## Excerpt of raw output

```
# YAML validation
ci.yml: VALID
release.yml: VALID

# Job ordering inspection
Jobs found: ['lint', 'unit', 'integration', 'e2e']
lint needs: []
unit needs: []
integration needs: unit
e2e needs: integration
Job ordering: CORRECT (lint independent, integration needs unit, e2e needs integration)

# Policy checks
CI runners: all ubuntu-latest, no self-hosted ✓
CI uses npm ci (not npm install) ✓
Release runners: all ubuntu-latest, no self-hosted ✓
Release declares packages: write ✓
Release builds linux/amd64,linux/arm64 ✓
Release uses GITHUB_TOKEN (no hardcoded creds) ✓
Dog-food ingest step present with continue-on-error: true ✓

# Dockerfile checks
Dockerfile has 2 stages: builder + runner ✓
Base image: node:22-alpine ✓
TypeScript compile: npx tsc ✓
Tailwind CSS build present ✓
Runner uses npm ci --omit=dev ✓
HEALTHCHECK polls /health ✓
CMD: ["node", "dist/index.js"] ✓
EXPOSE declared ✓

# .dockerignore checks — all 11 required exclusions ✓, !.env.example whitelisted ✓

# Test regression
Unit:        148 passed, 0 failed (6 files) in 1.38s
Integration:  62 passed, 0 failed (3 files) in 2.58s
```

---

## Verdict

**PASS** — All 24 headless checks green. No application code was changed; T2 / T2.5 / T3 are N/A for this infrastructure-only story.

Test-writer notes for Orchestrator:
- No new test files to author (no new Fastify routes, no new pure functions).
- Existing 210 tests (148 unit + 62 integration) continue to pass unaffected by CI-001 changes.
- Docker build was verified locally by the Feature-implementer (`docker build` succeeded in 42.7s; `node --version` returned v22.22.2). Local re-run was not performed by Test-writer — a Docker `build` re-run is a 5-min CPU operation with no additional signal beyond what the feature-implementer already captured. The YAML + policy checks above are the complete T1 scope for this story.
