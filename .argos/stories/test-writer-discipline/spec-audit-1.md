# Spec-enforcer Audit — test-writer-discipline — iteration 1

**Executed:** 2026-05-18 04:40
**Reviewer:** spec-enforcer (Claude Opus 4.7) — read-only
**Scope:** diff `main..story/test-writer-discipline` (commits eb21b89, 4389879, 03a309f)
**Checklists run:** Constraint/scope confinement, brief binding-decision conformance, skills consistency check (`vitest-three-layer-testing.md`, `page-verification-hierarchy.md`), package.json convention, audit-script soundness, forbidden-pattern scan. Coverage and Planning-doc-conformance checklists do **not** apply — this is a governance-documentation + tooling story with no `src/` application code and no new route.

## Prior-iteration check (iteration > 1 only)

N/A — iteration 1.

## Findings

This is a governance + tooling story. The diff touches exactly: `.claude/agents/test-writer.md`, `docs/orchestrator-workflows/verifystory.md`, `docs/orchestrator-workflows/audit-tests.md`, `package.json`, `scripts/check-test-discipline-rules.sh` (new), and ten `.argos/stories/test-writer-discipline/*` artifacts. No `src/`, no entity, no template, no route.

**Constraint & binding-decision verification (all confirmed):**

- `docs/planning/*` — **not modified.** `git diff main..story/test-writer-discipline --name-only -- 'docs/planning/*'` returns empty. (CLAUDE.md: planning docs are authoritative; never modified.)
- F/A/S agent files — **not modified.** `feature-implementer.md`, `architecture-reviewer.md`, `spec-enforcer.md` are absent from the diff. The only agent file touched is `.claude/agents/test-writer.md`, which is explicitly in scope (brief Scope edits 1–3).
- `src/__tests__/integration/static-asset-auth-bypass.test.ts` — **not modified, overwritten, or deleted.** Absent from the diff name-list; T's Tier-1 report confirms 31/31 pass, 342 lines, last commit `142fb97`. Acceptance criterion 3 honored.
- Brief binding Decision 1 — criterion 1's artifact is `scripts/check-test-discipline-rules.sh`, **not** a `src/__tests__/` unit test. Nothing under `src/__tests__/` is in the diff. Honored.
- Brief binding Decision 2 — criterion 2's dry-run is delivered as the artifact `dry-run-rederived-tests.md`, not a commit over the real test file. Honored.

**Brief Scope edits — all three delivered:**

| Scope edit | Delivered in | Verified |
|---|---|---|
| 1 — test-sizing rule (one test per distinct branch; matrix as ceiling; loop = one test) | `test-writer.md` new `## Test-sizing rule` section | ✓ verbatim rule text present |
| 2 — 4xx matrix reframed as per-route ceiling + worked counter-example | `test-writer.md` Responsibility 4 + `## Test-sizing rule` ❌/✅ worked example | ✓ both reframe and 24-test counter-example present |
| 3 — pre-handoff self-check in T's workflow + verifystory.md | `test-writer.md` (§Test-sizing rule, `On exit` step 1, handoff template) + `verifystory.md` Phase E `### Pre-handoff self-check` | ✓ identical load-bearing question string in both files |
| (also) audit-tests.md fan-out penalty — metric is tests-per-distinct-branch | `audit-tests.md` Phase 4 preamble + `### 4a. Fan-out detection` + Phase 6 table/example | ✓ bidirectional pressure, tests-per-distinct-branch metric, `[block]` over-coverage finding |

**Skills consistency (new ceiling rules vs. unchanged test skills) — no conflict:**

- `skills/vitest-three-layer-testing.md:55` ("Every Fastify route's happy path, error cases, 401, 422, 413, 429 responses") is **route-scoped** ("Every Fastify route's …"). The new ceiling in `test-writer.md` ("a per-route ceiling of the *applicable* cases … applies **only when the diff actually adds a route** … only for codes the route can genuinely return") narrows *how many* tests a single route's matrix earns. It does not contradict the skill's per-route framing — it constrains fan-out *across* paths/assets, which the skill never authorized. Consistent.
- `skills/vitest-three-layer-testing.md:76` ("Coverage is a floor, not a goal") concerns the coverage *percentage* threshold. The new test-sizing rule adds a *ceiling on tests-per-branch* — an orthogonal axis (signal-per-test, not line-percentage). The two coexist: a story can hit the coverage floor with minimum-meaningful tests. Consistent.
- `skills/page-verification-hierarchy.md` — untouched by the new rules; the T1/T2/T3 tier hierarchy is unaffected. No conflict.
- Note (informational, not a finding): the brief cites `skills/test-tier-selection.md` and `skills/integration-testing.md`; the repo's actual test skills are `vitest-three-layer-testing.md` and `page-verification-hierarchy.md`. The intended skills were audited under their real names. This is a brief-text imprecision, not an implementation defect, and is out of S's remit to alter.

**package.json convention — conformant.** New entry `"check:test-discipline": "bash scripts/check-test-discipline-rules.sh"` follows the established colon-namespaced convention and the `docker:build:cached` precedent for `bash scripts/*.sh` wiring. The `check:` prefix is correctly distinct from the `test:` vitest namespace, so it cannot be mistaken for a test runner.

**Audit-script soundness — verified independently.** `scripts/check-test-discipline-rules.sh`: `set -euo pipefail`; `cd "$(dirname "$0")/.."` for path-independence; `grep -qiF --` (fixed-string, case-insensitive, `--` guards needles); per-rule `✓`/`✗` report; missing-file branch; accumulating `FAILURES`; exit 1 with remediation message on any miss, exit 0 otherwise; executable (100755). I ran it against the branch commit in an isolated detached worktree — **11/11 ✓, exit 0**. Negative test: removing the self-check rule line produced `✗` for that rule and exit 1. The script cannot pass vacuously; each needle is a load-bearing fragment of the actual rule text.

No drift detected against `skills/` or `docs/planning/*`.

## Coverage gaps

Coverage matches the story's design. This is a governance + tooling story with no application code and no new route — by design T authored **no committed test** (brief binding Decisions 1 and 2; criterion 1's artifact is the `scripts/` audit script, criterion 2's is the dry-run analysis artifact). The Coverage checklist (route → integration test, `src/lib/` fn → unit test, coverage thresholds) has no applicable targets in this diff. T's regression baseline (498/498 pass, `tsc --noEmit` clean) confirms no application code was disturbed.

## Planning-doc conformance (only lines relevant to this story's scope)

No `docs/planning/*` line applies — the diff contains no route, no ingest endpoint, no `/setup`, no `/health`, no auth route, no entity, no migration, no artifact path. The story is governance/tooling only. Confirmed by `git diff --name-only` (no `docs/planning/*` and no `src/*` entries).

## Forbidden-pattern scan (from CLAUDE.md)

The diff contains no application code, no Eta template, no entity, no client code, and no committed test. Every forbidden pattern below was scanned for and is absent — there is no surface for any to appear on:

- [x] No `hx-target`/`hx-swap` inherited from a parent — no templates in diff
- [x] No raw HTMX event names outside `src/client/htmx-events.ts` — no client code in diff
- [x] No `hx-disable` anywhere in templates — no templates in diff
- [x] No Alpine `x-data` inside an HTMX swap target — no templates in diff
- [x] No Postgres-only SQL / dialect-specific features — no entities or migrations in diff
- [x] No DB mocked in integration tests — no test files in diff
- [x] No T3 visual assertions without corresponding T2 ARIA assertions — no test files; T's Tier-2 report correctly marks T2/T2.5/T3 N/A (no rendered route)
- [x] No layout-token change without a T2 backdrop-contrast re-check — no layout token / `[data-theme]` / `@layer components` change in diff
- [x] No raw CSRF-token or session-cookie handling outside Better Auth — no auth/session code in diff
- [x] No Zod schema defined ad-hoc in a handler — no handlers in diff

Note: the ❌ worked counter-example in `test-writer.md` contains an illustrative `for`-loop fan-out and a `hx`-style header reference, but it is intentional teaching content inside a documentation file — explicitly labeled the wrong way to do it — not application code. Not a finding.

## Verdict

**PASS** — Argos may proceed to Phase 7 (open the PR).

All three brief Scope edits are delivered and internally coherent; both brief binding decisions are honored; the constraint set (touch only role files / workflow docs / `scripts/`; no application code; do not delete the build-fix 31-test file) is fully respected; the new ceiling rules are consistent with the unchanged test skills, not in conflict; the audit script is sound and cannot pass vacuously (independently re-run: 11/11, exit 0; negative test fails as expected). A's two `nit` findings are documentation-locator polish, explicitly non-blocking, and are accepted documented decisions per the orchestration notes — not re-litigated here. No `block` findings. No coverage gaps. No forbidden patterns.
