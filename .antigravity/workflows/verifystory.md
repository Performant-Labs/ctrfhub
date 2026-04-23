# Workflow: /verifystory <taskId>

## Purpose

Standalone verification workflow — run after implementation is complete to confirm all acceptance criteria, all tiers, and all test coverage are satisfied for a given story. Use this to re-verify a story after a bug fix, or to gate a story before merge when `/implementstory` was run by a different agent session.

## Invocation

```
/verifystory <taskId>
```

Example: `/verifystory CTRF-001`

---

## Preconditions

Before starting:

1. **Story is `[/]` (in-progress) or in review.** This workflow does not start new implementation.
2. **Dev server or test environment is reachable.** For UI stories: `npm run dev` and navigate to the story's screen.
3. **Feature-implementer's handoff note is available.** The Orchestrator provides it. It must state: what was implemented, commands run, any spec deviations.

---

## Phase A — Acceptance Criteria Checklist

**Executed by: Spec-enforcer (read-only)**

1. Pull the acceptance criteria for `<taskId>` from `docs/planning/product.md` or `docs/planning/architecture.md`.
2. For each criterion line, check whether the implementation satisfies it:
   - API routes: verify endpoint path, method, required headers, response codes.
   - UI routes: verify screen exists at the documented URL.
   - Data: verify entity fields exist in migration files.
   - Auth: verify routes that should require auth do not have `skipAuth: true` incorrectly.
3. Output: a criterion-by-criterion checklist with `✓` or `✗` and evidence for each.

---

## Phase B — Tier 1: Headless Re-verification

**Executed by: Test-writer**

Run the integration test suite for this story:

```bash
npm run test:int -- --reporter=verbose --testNamePattern="<story-related pattern>"
```

Or run the full suite:

```bash
npm run test
```

Assert:
- All new integration tests pass.
- No previously-passing tests have regressed.

For API routes not covered by integration tests, use `curl` against the running dev server:

```bash
# Happy path
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/v1/projects/demo/runs \
  -H "x-api-token: ctrf_test_token" \
  -H "Content-Type: application/json" \
  -d @<path-to-fixture.json>
# Expected: 201

# Missing token
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/v1/projects/demo/runs \
  -H "Content-Type: application/json" \
  -d '{"key":"value"}'
# Expected: 401

# Invalid CTRF
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/v1/projects/demo/runs \
  -H "x-api-token: ctrf_test_token" \
  -H "Content-Type: application/json" \
  -d '{"invalid":"json_shape"}'
# Expected: 422
```

**Gate:** T1 must produce all expected status codes. Failures halt verification.

---

## Phase C — Tier 2: ARIA Structural Skeleton

**Executed by: Test-writer**
**Required for: any story with a UI screen.**
**Skip for: API-only stories with no UI.**

1. Start dev server: `npm run dev`.
2. Navigate to the story's screen URL.
3. Use `read_browser_page` to capture the ARIA tree.
4. Verify:
   - `h1` exists and contains the expected page title.
   - All interactive elements in the acceptance criteria are present with correct ARIA labels.
   - Form fields have associated `<label>` elements or `aria-label`.
   - Table has `role="table"` or `<table>` with correct header structure.
   - WCAG 2.1 AA interactive-element floor: all buttons/links must be visually ≥ 24×24 CSS px.
5. Run Playwright E2E if a spec file exists for this screen.

**Gate:** T2 must pass. If ARIA structure is incorrect, return to Feature-implementer with specific ARIA snapshot and expected structure.

---

## Phase D — Tier 3: Visual Sign-off

**Executed by: Test-writer**
**Required for: any story with a UI screen.**
**Skip for: API-only stories with no UI.**

1. Capture screenshots using `browser_subagent`:
   - 1280×800 desktop viewport: primary assertions.
   - 375×800 narrow viewport: overflow smoke check only.
2. Desktop assertions:
   - Background is dark (`--color-surface` = `#0f172a` or equivalent for active theme).
   - Status badges use correct semantic classes (`.badge-pass`, `.badge-fail`, etc.).
   - Tailwind layout is correct (sidebar visible, main content area, correct spacing).
   - No visual regressions against the Flowbite component reference design.
3. Narrow assertions:
   - Page loads (no console errors).
   - No horizontal overflow outside `overflow-x-auto` wrappers.
4. Embed screenshots in the verification report using absolute artifact paths.

**One subagent call = one design slice.** Never pass a full-page composite to `MediaPaths`. Crop to the component under verification.

**Gate:** T3 must pass for UI stories. A layout overflow at 375×800 is a failing result.

---

## Phase E — Coverage Gate

**Executed by: Test-writer**

Run:
```bash
npm run test:coverage
```

Assert:
- `lines` ≥ 80%
- `functions` ≥ 80%
- `branches` ≥ 75%

Report the coverage delta compared to the previous run (lines before → lines after).

If thresholds fail, identify which uncovered lines belong to the story and add tests for them.

---

## Phase F — Verification Report

**Produced by: Test-writer, delivered to Orchestrator**

```markdown
## Verification Report: <taskId>

### Acceptance Criteria
- [x] POST /api/v1/projects/:slug/runs returns 201 with { runId }
- [x] Invalid CTRF returns 422 with Zod validation error
- [x] Missing token returns 401
- [ ] Idempotency key deduplication — FAILED: duplicate run created (see T1 output)

### Tier 1 — Headless
Status: PASS / FAIL
Output: <test run summary or curl results>

### Tier 2 — ARIA
Status: PASS / FAIL / N/A (API-only)
ARIA snapshot: <key elements found or missing>

### Tier 3 — Visual
Status: PASS / FAIL / N/A (API-only)
Screenshots: ![Desktop 1280×800](<path>) ![Narrow 375×800](<path>)

### Coverage
Before: 78.2% lines
After:  82.1% lines
Thresholds: PASS

### Verdict
PASS — ready for merge
— or —
BLOCK — <specific failing criterion with remediation>
```

---

## Remediation flow

If the verdict is **BLOCK**:

1. Orchestrator returns the report to the Feature-implementer (for code issues) or Test-writer (for test gaps).
2. Assignee resolves the specific failing items.
3. `/verifystory <taskId>` is invoked again from Phase A.
4. No more than 3 re-verifications are allowed before escalating to human reviewer.
