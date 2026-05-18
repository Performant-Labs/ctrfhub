# Test Handoff — duplicate-issue-detection

**Branch:** `story/duplicate-issue-detection`
**Commits added by Test-writer:**
- (this commit) `test(duplicate-issue-detection): workflow verification reports`

## Tier summary

| Tier | Status | Report |
|---|---|---|
| T1 Headless | ✓ | `.argos/stories/duplicate-issue-detection/tier-1-report.md` |
| T2 ARIA (clean room) | N/A — no rendered route (CI workflow / docs only) | `.argos/stories/duplicate-issue-detection/tier-2-report.md` |
| T2.5 Authenticated State | N/A — no rendered route | see tier-2-report.md |
| T3 Visual | N/A — no rendered route, no design slice | see tier-2-report.md |
| Backdrop-contrast | N/A — no CSS / layout-token / template change | — |

## Tests added

| Layer | Files | Tests | Notes |
|---|---|---|---|
| Unit | none | 0 | No `src/` application code; a GitHub Actions workflow has no vitest module surface. See T1 report "No committed test files — reasoning". |
| Integration | none | 0 | No Fastify route added. |
| E2E | none | 0 | No rendered route. |

No committed test files. Per the freshly-tuned test-writer rules (PR #74),
authoring vitest/Playwright tests for YAML workflows would add maintenance
surface for no genuine coverage. Verification was performed via static parse +
executable shell/`jq` spot-checks recorded in `tier-1-report.md`.

## Verification performed (T1)

- All 3 new workflow YAML files parse cleanly (`yaml.safe_load`).
- Criterion 5 (no LLM calls): only `uses:` directives are `actions/checkout@v4`
  and `actions/stale@v9`; "Claude/Anthropic/LLM" strings appear solely in
  comments asserting their absence; no `ANTHROPIC_API_KEY` / LLM secret.
- Dedupe keyword-extraction snippet run against an ordinary title, a
  punctuation/stopword title, and an all-stopword title — produces sensible
  ~5-keyword strings and the empty (silent-path) string respectively.
- `jq` self-filter snippet run against sample candidate JSON — the just-opened
  issue's own number is filtered out; the only-self set yields `[]`
  (`MATCH_COUNT 0`, the silent no-comment path).
- Least-privilege `permissions:` independently re-confirmed on all 3 workflows
  (matches A's review).
- Criterion 4 (existing CI green): `npx tsc --noEmit` 0 errors;
  `npm test` **498 tests pass (23 files)** — unchanged, no app code touched.

## Coverage

N/A — no test files added; no `src/` code changed, so coverage is unchanged
from `main`. Vitest coverage thresholds (lines ≥ 80, functions ≥ 80,
branches ≥ 75) are unaffected by this story.

## Live-run-only acceptance criteria

Three acceptance criteria require a live GitHub Actions run (fork issue-open →
dedupe comment; `workflow_dispatch` → `stale` label + comment) and are not
executable from this local environment. Per the brief, this is **not** grounds
to BLOCK — the documented mechanism and static correctness are verified
instead (detailed in `tier-1-report.md` → "Live-run-only acceptance criteria").

## Non-blocking issues (if any)

- none. A's iteration-1 review carried 2 `nit` items (tag-pinning vs SHA-pinning
  of actions; workflow `name:` verbosity) and 1 informational `warn`
  (fail-loud on transient `gh` API error) — all explicitly optional / no action
  required, and they do not affect any acceptance criterion.

## Verdict

**PASS** — Argos may proceed to Phase 6 close-out.
