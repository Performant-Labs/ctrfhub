# Workflow: Audit tests — full-codebase spec audit

> **Audience.** This file is reference reading for the Orchestrator (Argos). Argos reads it when handling a kickoff line matching its trigger phrase (e.g. `Audit tests`). This is the **periodic spec-audit** workflow — run on demand against the whole codebase, not against any single story's diff. Distinct from `auditarchitecture.md` (which audits architectural drift in a scoped subtree) — this one audits **spec compliance** across all of `src/`.

## Purpose

Periodic or on-demand full-codebase spec audit. Runs the Spec-enforcer's complete checklist against the entire `src/` tree, producing a drift report that identifies architecture rule violations, missing tests, planning non-conformance, and skills violations — without modifying any file.

This is **not** the implement loop's Phase 6 S audit (that one runs against a single story's diff). This is a periodic broad sweep, useful as a calibration check across the codebase or to baseline before a refactor wave.

## Kickoff

A line like `Audit tests` arrives in Argos's tmux pane via Dispatch. No arguments — this always audits the full codebase. (For a scoped architectural audit, use the audit-architecture loop instead — `Audit scope <auditId>`.)

## Preconditions

Before starting, Argos verifies:

1. **No implement loop is in flight.** This audit reads source files; if F is mid-edit, the audit captures an inconsistent snapshot. Surface and pause.
2. **`tsc --noEmit` baseline can run.** Required for Phase 1's error-count snapshot.
3. **Tests can run.** Required for Phase 2's pass/fail and coverage snapshot.

The audit itself is read-only and never modifies files. It writes only its report file.

---

## Phase 1 — TypeScript type-check baseline (Argos, via Bash)

**Argos runs:**

```bash
npx tsc --noEmit 2>&1 | tee /tmp/tsc-audit.log
```

**Records:** number of errors, file names, brief description of each error.

**Gate condition:** TypeScript errors are **findings** (not blockers for the audit to proceed). Any error in a non-test source file is a `block` on the final verdict.

---

## Phase 2 — Test suite snapshot (Argos, via Bash)

**Argos runs:**

```bash
npm run test 2>&1 | tee /tmp/test-audit.log
npm run test:coverage 2>&1 | tee /tmp/coverage-audit.log
```

**Records:**
- Total tests: pass count, fail count, skip count.
- Coverage: lines, functions, branches — against thresholds (80 / 80 / 75).
- Any failing test: exact name + error message.

---

## Phase 3 — Architecture rule scan (Spec-enforcer)

**Spawned by:** Argos, via Task tool with `subagent_type: spec-enforcer`.

**Spawn input:** the Phase 1 and Phase 2 logs + a pointer to the full `src/` tree.

**Spawn prompt (paraphrased):**
> "Full-codebase audit, not a single-story diff. Run the Architecture rules, Coverage, Planning docs conformance, and Skills violations sections of your Audit Checklist against every file under `src/`. Use the patterns below as your starting point for `Grep`. Write `.argos/audits/<auditId>/spec-audit-fullcodebase.md` with PASS / BLOCK / WARN. Exit."

S uses these `Grep` patterns (via `Bash`) as scan entry points:

### 3a. HTMX attribute compliance

```bash
# Find hx-* request attributes — each must also have hx-target on the same element
grep -rn "hx-get\|hx-post\|hx-patch\|hx-delete" src/views/ --include="*.eta"
```

Manual check per match: verify `hx-target` is on the same HTML element (not inherited from a parent).

```bash
# Find hx-disable usage (prohibited — renamed to hx-ignore in HTMX 4.0)
grep -rn "hx-disable" src/views/ --include="*.eta"

# Find raw HTMX event name strings outside htmx-events.ts
grep -rn "htmx:xhr\|htmx:afterSettle\|htmx:afterSwap\|htmx:beforeRequest" src/ --include="*.ts" | grep -v "htmx-events.ts"
```

### 3b. Alpine boundary compliance

```bash
# Find x-data inside known partial templates
grep -rn "x-data" src/views/partials/ --include="*.eta"
```

Each match: review whether the `x-data` element is inside an HTMX swap target.

### 3c. MikroORM entity compliance

```bash
# Find Postgres-only types in entity files
grep -rn "p\.array\|p\.jsonb\|\.uuid()\.primary\|p\.bigint" src/entities/ --include="*.ts"

# Find direct orm.em usage in route/handler context (should be request.em)
grep -rn "fastify\.orm\.em\.\|app\.orm\.em\." src/modules/ --include="*.ts"
```

### 3d. Auth + Zod compliance

```bash
# Find routes without schema: declaration (may be missing Zod validation)
grep -rn "fastify\.\(get\|post\|put\|patch\|delete\)" src/modules/ --include="*.ts" | grep -v "schema:"

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

Manual check per match: verify the matching code uses the 500-row chunked pattern with `setImmediate` yield.

### 3h. Iframe sandbox compliance

```bash
# Find iframe allow-same-origin (prohibited for artifact rendering)
grep -rn "allow-same-origin" src/views/ --include="*.eta"
```

---

## Phase 4 — Coverage gap detection (Spec-enforcer)

For every file in `src/modules/*/routes.ts`, S checks for a corresponding integration test:

```bash
find src/modules -name "routes.ts" -print
find src/__tests__/integration -name "*.test.ts" -print
```

**Reports:** any route file without a corresponding integration test file.

For every exported function in `src/lib/`, S checks for a corresponding unit test:

```bash
find src/lib -name "*.ts" -not -path "*__tests__*" -print
find src/__tests__/unit -name "*.test.ts" -print
```

**Reports:** any utility file whose exports lack unit-test coverage.

---

## Phase 5 — Planning conformance check (Spec-enforcer)

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
find src/migrations/pg -name "*.ts" -print | wc -l
find src/migrations/sqlite -name "*.ts" -print | wc -l
```

Assert: both directories have the same number of migration files. If PG has more than SQLite or vice versa, flag as a finding.

---

## Phase 6 — Drift report (Spec-enforcer)

S writes `.argos/audits/<auditId>/spec-audit-fullcodebase.md`. (The `<auditId>` is Argos-generated, e.g. `FULL-AUDIT-<YYYYMMDD>`.) Use this format:

```markdown
# Full-codebase spec audit — <auditId>

**Reviewer:** spec-enforcer (Claude Sonnet 4.6) — read-only
**Date:** <ISO date>
**Triggered by:** kickoff `Audit tests`
**Scope:** entire `src/` tree

## Summary

| Category | Count |
|---|---|
| TypeScript errors | <N> |
| Test failures | <N> |
| Architecture violations | <N> |
| Coverage gaps | <N> |
| Planning non-conformance | <N> |
| Skills violations | <N> |

## Verdict

**PASS** — zero `block` findings, all coverage thresholds met, zero TypeScript errors in `src/`.
**BLOCK** — one or more `block` findings; the report is delivered to Argos / André for remediation assignment.
**WARN** — only `info` / `nit` findings; merge / shipping is allowed, but findings should be addressed in the next sprint.

---

## Findings

### [block] Architecture violation — raw HTMX event string
File: `src/client/some-component.ts:42`
Rule: `skills/htmx-4-forward-compat.md §Rule 2`
Found: `document.addEventListener('htmx:afterSettle', ...)`
Expected: `document.addEventListener(HtmxEvents.AFTER_SETTLE, ...)`
Remediation: Import `HtmxEvents` from `./htmx-events` and replace the raw string.

### [block] Coverage gap — missing integration test
File: `src/modules/settings/routes.ts`
No corresponding file found in `src/__tests__/integration/settings.test.ts`.
Remediation: Test-writer must create integration tests covering all settings routes.

### [info] TypeScript strict error
File: `src/modules/ingest/service.ts:87`
Error: Type 'string | undefined' is not assignable to type 'string'.
Remediation: Add non-null assertion or null-check.

(…)

---

## Coverage

| Metric | Value | Threshold | Status |
|---|---|---|---|
| Lines | <pct>% | ≥ 80% | ✓ / ✗ |
| Functions | <pct>% | ≥ 80% | ✓ / ✗ |
| Branches | <pct>% | ≥ 75% | ✓ / ✗ |

---

## Dual-dialect migration parity

PG migrations: <N>
SQLite migrations: <M>
**If unequal:** flag with the missing-side migration filenames.

---

## Next action (Argos / André)

- On **PASS**: no action; file the audit as a clean spot-check.
- On **WARN**: Argos surfaces the findings to André via Dispatch; André decides whether to spawn audit-architecture or remediation stories.
- On **BLOCK**: Argos lists which findings would become which implement-loop stories (similar to a decomposition); André kicks off `Start story <storyId>` for each one he wants to act on.
```

---

## Phase summary

| Phase | Agent | Input | Output |
|---|---|---|---|
| 1 TypeScript baseline | Argos (Bash) | `tsc --noEmit` | error count + log |
| 2 Test snapshot | Argos (Bash) | `npm run test`, `npm run test:coverage` | pass/fail counts + coverage |
| 3 Architecture rule scan | S | grep patterns | findings (architecture rules) |
| 4 Coverage gaps | S | `find` + diff against `src/__tests__/` | findings (missing tests) |
| 5 Planning conformance | S | targeted grep against canonical endpoints | findings (planning drift) |
| 6 Drift report | S | all of the above | `spec-audit-fullcodebase.md` |

---

## Why this exists alongside the per-story Phase 6 S audit

The implement loop's Phase 6 S audit catches drift in *one story's diff*. This workflow catches drift that:

- Predates the multi-agent workflow (e.g. legacy code that was never re-audited).
- Is cross-cutting (e.g. a pattern violation that started in one story and propagated by copy-paste).
- Emerges from the interaction of two recently-merged stories (each was clean individually).

Run this workflow on a schedule (weekly, before a release) or on demand (after a refactor wave, before promoting a major feature).
