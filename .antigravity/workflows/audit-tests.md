# Workflow: /audit-tests

## Purpose

Periodic or on-demand full-codebase audit. Runs the Spec-enforcer's complete checklist against all source files. Produces a drift report that identifies architecture violations, missing tests, planning non-conformance, and skills violations — without modifying any file.

## Invocation

```
/audit-tests
```

No arguments. Always audits the full codebase.

---

## Preconditions

1. **Spec-enforcer is the executing agent.** This workflow is read-only by design.
2. **`tsc --noEmit` baseline:** Run before starting the audit to capture the current TypeScript error baseline. Any errors are listed in the report but do not block the audit itself (they are findings).
3. **Tests run:** Run `npm run test` before starting. Test pass/fail results are listed in the report.

---

## Phase 1 — TypeScript Type-Check

```bash
npx tsc --noEmit
```

Record: number of errors, file names, and brief description of each error.

Gate condition: TypeScript errors are FINDINGS (not blockers for the audit to proceed), but any error in a non-test source file is a `BLOCK` on the final verdict.

---

## Phase 2 — Test Suite Run

```bash
npm run test
npm run test:coverage
```

Record:
- Total tests: pass count, fail count, skip count.
- Coverage: lines, functions, branches — against thresholds (80/80/75).
- Any failing test: exact name + error message.

---

## Phase 3 — Architecture Rule Scan

### 3a. HTMX attribute compliance

```bash
# Find hx-* request attributes — each must also have hx-target on the same element
grep -rn "hx-get\|hx-post\|hx-patch\|hx-delete" src/views/ --include="*.eta"
```

Manual check: for each match, verify `hx-target` is on the same HTML element (not a parent).

```bash
# Find hx-disable usage (prohibited — use hx-ignore in HTMX 4.0 era)
grep -rn "hx-disable" src/views/ --include="*.eta"
```

```bash
# Find raw HTMX event name strings outside htmx-events.ts
grep -rn "htmx:xhr\|htmx:afterSettle\|htmx:afterSwap\|htmx:beforeRequest" src/ --include="*.ts" | grep -v "htmx-events.ts"
```

### 3b. Alpine boundary compliance

```bash
# Find x-data inside known partial templates (partials/ directory)
grep -rn "x-data" src/views/partials/ --include="*.eta"
```

Each match is a potential violation — review whether the `x-data` element is inside an HTMX swap target.

### 3c. MikroORM entity compliance

```bash
# Find Postgres-only types in entity files
grep -rn "p\.array\|p\.jsonb\|\.uuid()\.primary\|p\.bigint" src/entities/ --include="*.ts"
```

```bash
# Find direct orm.em usage in route/handler context (should be request.em)
grep -rn "fastify\.orm\.em\.\|app\.orm\.em\." src/modules/ --include="*.ts"
```

### 3d. Auth compliance

```bash
# Find routes without schema: declaration (may be missing Zod validation)
grep -rn "fastify\.\(get\|post\|put\|patch\|delete\)" src/modules/ --include="*.ts" | grep -v "schema:"
```

```bash
# Find API token values in log statements
grep -rn "authorization\|x-api-token\|Bearer" src/ --include="*.ts" | grep -i "log\."
```

### 3e. Artifact endpoint compliance

```bash
# Find any separate /api/artifact endpoint (prohibited)
grep -rn "api/artifact" src/ --include="*.ts"
grep -rn "api/artifact" src/views/ --include="*.eta"
```

### 3f. CSS compliance

```bash
# Find dark: variant usage (CTRFHub is dark-mode-only — dark: variant is prohibited)
grep -rn "dark:" src/views/ --include="*.eta"
grep -rn "dark:" src/assets/ --include="*.css"
```

### 3g. Chunked bulk insert compliance

```bash
# Find direct em.flush() after a loop over results (potential missing chunk pattern)
grep -rn "for.*result.*em\.create\|results\.map.*em\.create" src/ --include="*.ts"
```

Manual check: verify the matching code uses the 500-row chunked pattern with `setImmediate` yield.

### 3h. Iframe sandbox compliance

```bash
# Find iframe allow-same-origin (prohibited for artifact rendering)
grep -rn "allow-same-origin" src/views/ --include="*.eta"
```

---

## Phase 4 — Coverage Gap Detection

For every file in `src/modules/*/routes.ts`:

```bash
find src/modules -name "routes.ts" -print
```

For each routes file, check for a corresponding integration test:

```bash
find src/__tests__/integration -name "*.test.ts" -print
```

Report: any route file without a corresponding integration test file.

For every exported function in `src/lib/`:

```bash
find src/lib -name "*.ts" -not -path "*__tests__*" -print
```

For each utility file, check for a corresponding unit test:

```bash
find src/__tests__/unit -name "*.test.ts" -print
```

Report: any utility file whose exports lack unit test coverage.

---

## Phase 5 — Planning Conformance Check

### Ingest endpoint

```bash
grep -rn "api/v1/projects" src/modules/ingest/ --include="*.ts"
```

Assert: endpoint path is `/api/v1/projects/:slug/runs` with `x-api-token` header (not `Authorization: Bearer`).

### Setup wizard

```bash
grep -rn "/setup" src/modules/ --include="*.ts"
grep -rn "410" src/modules/ --include="*.ts"
```

Assert: `/setup` route returns `410 Gone` when `users` table is non-empty.

### Health endpoint

```bash
grep -rn "/health" src/modules/ --include="*.ts"
grep -rn "503\|booting\|migrating" src/modules/ --include="*.ts"
```

Assert: `/health` returns 503 during `booting` and `migrating` states.

### Migrations dual-dialect

```bash
find src/migrations/pg -name "*.ts" -print
find src/migrations/sqlite -name "*.ts" -print
```

Assert: both directories have the same number of migration files. If PG has more than SQLite or vice versa, flag as a finding.

---

## Phase 6 — Drift Report

**Format:**

```markdown
## Audit Report — /audit-tests
Date: <ISO date>

### Summary
- TypeScript errors: <N>
- Test failures: <N>
- Architecture violations: <N>
- Coverage gaps: <N>
- Planning non-conformance: <N>
- Skills violations: <N>

### Verdict: PASS | BLOCK

---

### Findings

#### [BLOCK] Architecture violation — raw HTMX event string
File: src/client/some-component.ts:42
Rule: skills/htmx-4-forward-compat.md §Rule 2
Found: `document.addEventListener('htmx:afterSettle', ...)` 
Expected: `document.addEventListener(HtmxEvents.AFTER_SETTLE, ...)`
Remediation: Import HtmxEvents from './htmx-events' and replace the raw string.

#### [BLOCK] Coverage gap — missing integration test
File: src/modules/settings/routes.ts
No corresponding file found in src/__tests__/integration/settings.test.ts
Remediation: Test-writer must create integration tests covering all settings routes.

#### [INFO] TypeScript strict error
File: src/modules/ingest/service.ts:87
Error: Type 'string | undefined' is not assignable to type 'string'
Remediation: Add non-null assertion or null-check.

---

### Coverage
Lines:     82.3% ✓ (threshold: 80%)
Functions: 81.1% ✓ (threshold: 80%)
Branches:  74.2% ✗ (threshold: 75%) — BLOCK

---

### Dual-dialect migration parity
PG migrations:     7
SQLite migrations: 6  ← BLOCK — missing Migration20260424007 for SQLite
```

**Verdict rules:**
- `PASS` — zero BLOCK findings, all coverage thresholds met, zero TypeScript errors in src/.
- `BLOCK` — one or more BLOCK findings; the report is delivered to the Orchestrator for remediation assignment.
- `WARN` — only INFO findings; merge is allowed but findings should be addressed in the next sprint.
