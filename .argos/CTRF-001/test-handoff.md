# Test Handoff — CTRF-001

**Branch:** `story/CTRF-001`
**Commits added by Test-writer:**
- caab790 test(CTRF-001): close 8 sub-schema validation gaps in ctrf-validator tests

## Tier summary

| Tier | Status | Report |
|---|---|---|
| T1 Headless | ✓ | `.argos/CTRF-001/tier-1-report.md` |
| T2 ARIA (clean room) | N/A — schema-only story, no rendered routes | — |
| T2.5 Authenticated State (browser-harness) | N/A — schema-only story, no rendered routes | — |
| T3 Visual | N/A — non-UI story | — |
| Backdrop-contrast | N/A | — |

## Tests added

| Layer | Files | Tests | Notes |
|---|---|---|---|
| Unit | `src/__tests__/unit/ctrf-validator.test.ts` | 17 (added to existing 59 → 76 total) | closes gaps G1–G8: strict-mode for 6 sub-schemas, required-field enforcement for attachment/retryAttempt/step/baseline, format validation for UUID/URL/datetime |
| Integration | — | 0 | schema-only story — no routes |
| E2E | — | 0 | schema-only story — no UI |

## Coverage (from `npx vitest run --coverage`)

**Schema file (`src/modules/ingest/schemas.ts`):**
Lines: 100% · Functions: 100% · Branches: 100% · Statements: 100%

**Global (all source files):**
Lines: 38.86% · Functions: 100% · Branches: 100%
Thresholds: lines ≥ 80, functions ≥ 80, branches ≥ 75. **FAIL** (expected — many app source files at 0% coverage; not a CTRF-001 regression)

## Gaps found and resolved

| Gap | Description | Resolution |
|---|---|---|
| G1 | No strict-mode tests for 6 sub-schemas (environment, insights, baseline, retryAttempt, step, attachment) | Added 6 tests |
| G2 | No attachment required-field tests | Added 3 tests (name, contentType, path) |
| G3 | No retryAttempt required-field tests | Added 2 tests (attempt, status) |
| G4 | No step required-field tests | Added 2 tests (name, status) |
| G5 | No baseline.reportId required test | Added 1 test |
| G6 | No baseline.buildUrl URL format test | Added 1 test |
| G7 | No baseline.timestamp datetime format test | Added 1 test |
| G8 | No test.id UUID format test | Added 1 test |

## Non-blocking issues (if any)

- Global coverage threshold (80% lines) fails because many source files outside the ingest module have 0% coverage. This is pre-existing and expected at this stage of the project. The schema itself is at 100%.

## Next action (Spec-enforcer)

1. Open a new session. Paste `.antigravity/agents/spec-enforcer.md` as the first message, then this handoff as the second.
2. Check out `story/CTRF-001`.
3. Run the Audit Checklist and write the verdict to `.argos/CTRF-001/spec-audit.md` (template in `.antigravity/agents/spec-enforcer.md`).
