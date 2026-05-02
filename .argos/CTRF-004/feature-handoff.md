# Feature Handoff — CTRF-004 Wave 1: Reporter Package Scaffold

**Branch:** `story/CTRF-004`
**Wave:** 1 (Feature-implementer) — scaffold packages + workspaces + examples

## What was built

- **Root `package.json`** — added `"workspaces": ["packages/*"]` only. No other fields touched. No `"private": true` added (npm 11 resolves workspaces without it on Node 25; the anti-pattern forbids it).
- **`packages/playwright-reporter/`** (`@ctrfhub/playwright-reporter`, `"private": true`):
  - `package.json` — ESM, depends on `playwright-ctrf-json-reporter` and `zod`, peerDep `@playwright/test >=1.50.0`
  - `tsconfig.json` — ES2022 target, Node16 module resolution, strict, no `verbatimModuleSyntax` (CJS interop with upstream)
  - `src/http.ts` — `postRunToCtrfHub(ctrf, opts?)` that reads `CTRFHUB_INGEST_URL`, `CTRFHUB_API_TOKEN`, `CTRFHUB_PROJECT_SLUG` from env (or opts), POSTs to `<url>/api/v1/projects/<slug>/runs` with `x-api-token` and deterministic `Idempotency-Key` (SHA-256 of run summary), logs to stderr, never throws, exits 0 on non-2xx. Uses Node 22 `fetch`.
  - `src/index.ts` — composition-based wrapper (implements `Reporter` interface, delegates to upstream `playwright-ctrf-json-reporter` via `createRequire`). On `onEnd`, reads the emitted CTRF JSON from disk and POSTs to CTRFHub. CJS interop forced composition over inheritance because `playwright-ctrf-json-reporter`'s default export doesn't resolve as a constructable type with Node16 moduleResolution + `esModuleInterop`.
  - `README.md` — usage snippet with env vars
- **`packages/cypress-reporter/`** (`@ctrfhub/cypress-reporter`, `"private": true`):
  - Same shape as playwright-reporter
  - `src/index.ts` — extends `GenerateCtrfReport` from `cypress-ctrf-json-reporter` (named export resolves cleanly). In constructor, hooks `after:run` event to read the CTRF JSON and POST (fire-and-forget with `.catch()`).
  - `cypress-ctrf-json-reporter@0.0.14` installed as dependency
- **`examples/github-actions/playwright.yml`** — reference workflow: `actions/checkout@v4` + `actions/setup-node@v4` (Node 22) + `npm ci` + `npx playwright test` with env vars via `vars.CTRFHUB_INGEST_URL` and `secrets.CTRFHUB_API_TOKEN`. Top comment explains this is reference material.
- **`examples/github-actions/cypress.yml`** — same shape for Cypress: uses `cypress-io/github-action@v6`.

## Env-var contract

Both reporters read the same three env vars (overridable via `opts` argument to `postRunToCtrfHub`):

| Variable | Required | Purpose |
|---|---|---|
| `CTRFHUB_INGEST_URL` | Yes | Base URL of the CTRFHub instance (e.g. `https://ctrfhub.example.com`) |
| `CTRFHUB_API_TOKEN` | Yes | API token with ingest scope (sent as `x-api-token` header) |
| `CTRFHUB_PROJECT_SLUG` | Yes | Project slug in CTRFHub (used in URL path `/api/v1/projects/<slug>/runs`) |

HTTP contract: `POST <ingestUrl>/api/v1/projects/<slug>/runs` with `Content-Type: application/json`, `x-api-token`, and `Idempotency-Key` (SHA-256 hex of the run summary object). No multipart support in the reporter packages — JSON-only POST with no artifact co-upload.

## Design decision: CJS interop with `createRequire`

`playwright-ctrf-json-reporter` is a CJS package with `export { default } from './generate-report'` in its `.d.ts`. TypeScript with `moduleResolution: "Node16"` fails to resolve the default export as a constructable type (`TS2507: Type 'typeof import(...)' is not a constructor function type`). The Cypress upstream reporter uses named exports (`export { GenerateCtrfReport }`) which resolves fine.

**Resolution for Playwright:** composition + delegation via `createRequire(import.meta.url).default` with an explicit local interface declaration. The wrapper implements the `Reporter` interface and delegates all methods to the upstream instance. This avoids the CJS interop issue entirely while keeping full type safety.

**Why not share `http.ts` between packages:** Each package is self-contained with zero cross-package dependencies. The `http.ts` files are identical by design — making them a shared dep would add a third workspace package for 60 lines, over-engineering for two consumers.

## Verification commands run

```
npm install                                # workspaces resolved, symlinks created
npx tsc --noEmit                           # root: clean
cd packages/playwright-reporter && npx tsc --noEmit    # clean
cd packages/cypress-reporter && npx tsc --noEmit       # clean
npm run lint                               # 14 pre-existing warnings (src/__tests__/integration/health.test.ts) + 1 pre-existing from src/app.ts; no new warnings from packages (packages/ not in eslint scope)
ls node_modules/@ctrfhub/                  # cypress-reporter -> ../../packages/cypress-reporter, playwright-reporter -> ../../packages/playwright-reporter
```

## Files created or modified

| File | Status |
|---|---|
| `package.json` (root) | Modified — added `"workspaces": ["packages/*"]` |
| `packages/playwright-reporter/package.json` | New |
| `packages/playwright-reporter/tsconfig.json` | New |
| `packages/playwright-reporter/src/index.ts` | New |
| `packages/playwright-reporter/src/http.ts` | New |
| `packages/playwright-reporter/README.md` | New |
| `packages/cypress-reporter/package.json` | New |
| `packages/cypress-reporter/tsconfig.json` | New |
| `packages/cypress-reporter/src/index.ts` | New |
| `packages/cypress-reporter/src/http.ts` | New |
| `packages/cypress-reporter/README.md` | New |
| `examples/github-actions/playwright.yml` | New |
| `examples/github-actions/cypress.yml` | New |

No files under `src/`, `src/__tests__/`, `e2e/`, or `src/modules/ingest/` were touched.

## Manual-test recipe

1. Check out this branch. Run `npm install`.
2. Set env vars: `export CTRFHUB_INGEST_URL=http://localhost:3000 CTRFHUB_API_TOKEN=<token> CTRFHUB_PROJECT_SLUG=<slug>`.
3. Run a Playwright test with the `@ctrfhub/playwright-reporter` in `playwright.config.ts`:
   ```ts
   reporter: [['@ctrfhub/playwright-reporter', { outputDir: 'ctrf' }]],
   ```
4. Verify `ctrf/ctrf-report.json` is written and `<ingestUrl>/api/v1/projects/<slug>/runs` receives a POST (check CTRFHub logs or a test server like `nc -l 3000`).
5. For Cypress: configure `reporter: '@ctrfhub/cypress-reporter'` in `cypress.config.ts` and run Cypress. Verify same POST pattern.

## For the test writer (Wave 2)

The following behaviors should be tested in the next wave:

1. **`postRunToCtrfHub` unit tests (both packages)**
   - Missing env vars → no POST, logs to stderr, no throw
   - Successful POST → logs `runId` to stderr
   - Non-2xx response → logs HTTP status + body to stderr, no throw, exit 0
   - Network failure → logs error to stderr, no throw, exit 0
   - Idempotency-Key is deterministic (same summary → same SHA-256 hex)
   - Trailing slash in `CTRFHUB_INGEST_URL` is stripped before appending path

2. **Playwright reporter integration test**
   - Reporter produces valid CTRF JSON (conforms to `CtrfReportSchema`)
   - After `onEnd`, the CTRF JSON file exists at expected path
   - HTTP POST to ingest endpoint is attempted with correct headers

3. **Cypress reporter integration test**
   - Same as Playwright but for the Cypress wrapper
   - Reporter hook fires on `after:run`

4. **Reporter equivalence test** (`src/__tests__/integration/reporter-equivalence.test.ts`)
   - Raw POST, Playwright reporter, Cypress reporter produce equivalent ingest records for the same fixture

5. **Note**: The root `package.json` `workspaces` field was added without `"private": true`. On some npm versions this may prevent workspace resolution. If the CI/T environment fails, adding `"private": true` may be needed (but conflicts with the brief's anti-pattern — escalate if this occurs).
