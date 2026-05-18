# Workflow: Verify story — standalone re-verification

> **Audience.** This file is reference reading for the Orchestrator (Argos). Argos reads it when handling a kickoff line matching its trigger phrase. This workflow is the **standalone** verification path — re-running the verification tiers + spec-audit against an already-implemented story without going through the full implement loop. The trigger phrase has not been standardized yet; Argos can be told to invoke it by André via Dispatch (e.g. `Re-verify story CTRF-001`).

## Purpose

Standalone verification — run after implementation is complete to re-confirm acceptance criteria, test tiers, and spec compliance for a given story. Use this:

- After a bug fix on a previously-shipped story.
- To gate a story before merge when the implement loop ran on a different machine or in a stale session.
- As a periodic spot-check on a recently-shipped story.

This workflow **does not start new implementation**. If new code is required, run the implement loop (`docs/orchestrator-workflows/implementstory.md`) instead.

## Preconditions

Before starting, Argos verifies:

1. **Story is `[/]` (in-progress) or recently `[x]` (in review).** This workflow does not start net-new implementation.
2. **Dev server or test environment is reachable.** For UI stories: `npm run dev` boots cleanly and the story's screen is rendered without errors. For Uranus: `docker compose -f compose.dev.yml up` is healthy.
3. **Feature-handoff is available.** The `.argos/stories/<storyId>/feature-handoff.md` (or `.argos/<taskId>/feature-handoff.md` under the legacy path) must already exist. If it doesn't, Argos cannot run this workflow — the story hasn't been through the implement loop's Phase 2 yet.
4. **No active implement loop on this story.** If `.argos/stories/<storyId>/` has an unclosed pipeline (e.g. no `spec-audit-*.md` or no `pr-body.md`), this re-verification will collide. Surface to André via Dispatch.

---

## Phase A — Acceptance criteria re-check (Spec-enforcer)

**Spawned by:** Argos, via Task tool with `subagent_type: spec-enforcer`.

**Spawn input:** the diff `main..story/<storyId>` (or `main..<merge-sha>` if the story already merged) + pointers to `docs/planning/*` and `skills/*`.

**Spawn prompt (paraphrased):**
> "Re-audit `<storyId>` against `docs/planning/*` and `skills/*`. Pull the acceptance criteria for this story from `docs/planning/product.md` or `docs/planning/architecture.md` (cited in the brief if it still exists). For each criterion line, check whether the implementation satisfies it. Write `.argos/stories/<storyId>/spec-audit-reverify.md` (PASS or BLOCK)."

**S reads:**
- The current state of `src/` for the cited routes / modules.
- The acceptance criteria from the planning docs.
- `feature-handoff.md` for the story's narrative.

**S writes:** `spec-audit-reverify.md` — same template as the implement loop's `spec-audit-<M>.md` (in `.claude/agents/spec-enforcer.md`), but with the suffix `-reverify` rather than a numbered iteration.

**Routing:**
- PASS → Phase B.
- BLOCK → Argos surfaces to André via Dispatch; this workflow does not auto-spawn F. If remediation is required, kick off the implement loop with the story's existing branch (or a new fix branch) as needed.

---

## Phase B — Tier 1 re-verification (Test-writer)

**Spawned by:** Argos, via Task tool with `subagent_type: test-writer`.

**Spawn input:** the brief (if available) + `feature-handoff.md` + the diff or merge-sha.

**Spawn prompt (paraphrased):**
> "Re-run T1 headless verification for `<storyId>`. Use `npm run test:int -- --testNamePattern=<story-related>` or `npm run test` if no pattern fits. For API routes without integration tests, fall back to `curl` against the running dev server. Write `.argos/stories/<storyId>/tier-1-reverify.md` (PASS or BLOCK)."

**T runs (via `Bash`):**

```bash
# Targeted integration tests
npm run test:int -- --reporter=verbose --testNamePattern="<story-related pattern>"

# Or full suite
npm run test
```

For API routes not covered by integration tests, T uses `curl` against `npm run dev`:

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

**Verdict gate:** T1 must produce all expected status codes. Failures halt the re-verification at Phase B.

---

## Phase C — Tier 2 *or* T2.5 re-verification (Test-writer)

**Required for:** any story with a UI screen. Skip for API-only stories.

**Tool selection:**
- **T2** (clean-room browser, no auth) for unauthenticated routes (`/setup`, `/login`, `/forgot-password`, `/health`). Via `Bash`: a Playwright spec using `page.accessibility.snapshot()`.
- **T2.5** (authenticated state) for everything past AUTH-001. On Uranus: a Playwright spec using a `storageState.json` auth fixture. On a developer Mac: `~/.local/bin/browser-harness` CDP attach.

**T runs:** the same ARIA-tree assertions as in the implement loop's Phase 4 (`h1` presence, landmarks, button labels, ARIA roles, no duplicate landmarks). If the diff touched a layout token, backdrop, `[data-theme]` zone, or `@layer components` surface, run the numeric WCAG contrast re-check from `skills/page-verification-hierarchy.md §Backdrop-contrast`.

**T writes:** `.argos/stories/<storyId>/tier-2-reverify.md` *or* `tier-2-5-reverify.md` — same template as the implement loop's reports.

**Verdict gate:** the chosen tier must pass. Failures halt re-verification at Phase C. Surface to André; if remediation is needed, kick off the implement loop.

---

## Phase D — Tier 3 re-verification (Test-writer)

**Required for:** any story with a UI screen. Skip for API-only stories.

**T runs (via `Bash`):** `npx playwright test` with `await page.screenshot()` per design slice. Two viewports:
- 1280×800 desktop — primary assertions.
- 375×800 narrow — overflow smoke check only.

**Desktop assertions:**
- Background is dark (`--color-surface`).
- Status badges use the correct semantic classes (`.badge-pass`, `.badge-fail`, etc.).
- Tailwind layout is correct (sidebar visible, main content area, correct spacing).
- No visual regressions against the Flowbite component reference design.

**Narrow assertions:**
- Page loads (no console errors).
- No horizontal overflow outside `overflow-x-auto` wrappers.

**One screenshot = one design slice.** Never full-page composites.

**T writes:** `.argos/stories/<storyId>/tier-3-reverify.md` + `screenshots/`.

**Verdict gate:** T3 must pass for UI stories. A layout overflow at 375×800 is a failing result.

---

## Phase E — Coverage gate (Test-writer)

**T runs (via `Bash`):**

```bash
npm run test:coverage
```

**Assert:**
- `lines` ≥ 80%
- `functions` ≥ 80%
- `branches` ≥ 75%

**T reports** the coverage delta compared to the previous coverage run (lines before → lines after).

If thresholds fail, T identifies which uncovered lines belong to the story and reports them — but does not write tests (this is re-verification, not implementation). If gaps exist, Argos surfaces to André.

---

## Phase F — Re-verification report (Argos)

**Argos writes:** `.argos/stories/<storyId>/reverify-handoff.md`, an aggregate of all the phase outputs.

```markdown
# Re-verification report — <storyId>

**Date:** <ISO date>
**Triggered by:** <reason — e.g. "bug fix landed on `story/<storyId>`-fix", "periodic spot-check">

## Acceptance criteria

(from `spec-audit-reverify.md`)
- [x] POST /api/v1/projects/:slug/runs returns 201 with { runId }
- [x] Invalid CTRF returns 422 with Zod validation error
- [x] Missing token returns 401
- [ ] Idempotency key deduplication — **BLOCK**: duplicate run created (see Phase B output)

## Tier 1 — Headless

**Status:** PASS / FAIL
**Report:** `.argos/stories/<storyId>/tier-1-reverify.md`
**Output:** <test run summary or curl results>

## Tier 2 *or* T2.5 — Structural

**Tier run:** T2 (clean room) *or* T2.5 (authenticated state)
**Status:** PASS / FAIL / N/A (API-only)
**Report:** `.argos/stories/<storyId>/tier-2-reverify.md` *or* `tier-2-5-reverify.md`
**ARIA snapshot:** <key elements found or missing>

## Tier 3 — Visual

**Status:** PASS / FAIL / N/A (API-only)
**Report:** `.argos/stories/<storyId>/tier-3-reverify.md`
**Screenshots:** see `.argos/stories/<storyId>/screenshots/`

## Coverage

Before: <pct>% lines
After:  <pct>% lines
Thresholds: PASS / FAIL

## Spec-enforcer verdict

PASS — `.argos/stories/<storyId>/spec-audit-reverify.md`
— or —
BLOCK — <specific failing criterion with remediation>

## Verdict

PASS — story confirmed clean; ready for merge / closed out.
— or —
BLOCK — <specific failing criterion>. Remediation path: <run implement loop with a fix branch | run a partial F invocation | surface to André>.
```

---

## Remediation flow

If the verdict is **BLOCK**:

1. Argos surfaces the report to André via Dispatch.
2. André decides whether to:
   - Kick off a fix story (`Start story <storyId>-fix`) — runs the full implement loop on a new branch.
   - Re-cut the existing story and re-run.
   - Accept the block as a follow-up and update `tasks.md` / `gaps.md`.
3. Argos does not auto-spawn the implement loop from a re-verify BLOCK. The decision is André's.

No more than 3 re-verifications are run on a single story before escalating to André for a categorical decision.

---

## Phase summary

| Phase | Agent | Input | Output | Gate |
|---|---|---|---|---|
| A Acceptance re-check | S | diff + planning docs | `spec-audit-reverify.md` | PASS → Phase B |
| B T1 Headless | T | brief + handoff + diff | `tier-1-reverify.md` | PASS → Phase C |
| C T2 or T2.5 | T | running app, ARIA tooling | `tier-2-reverify.md` *or* `tier-2-5-reverify.md` | PASS → Phase D (UI stories) |
| D T3 Visual | T | running app, Playwright | `tier-3-reverify.md` + screenshots | PASS → Phase E |
| E Coverage | T | `npm run test:coverage` | inline in report | thresholds met |
| F Aggregate | Argos | all of the above | `reverify-handoff.md` | Verdict to André |

---

## Notes

- This workflow runs Phases A–E sequentially; Phase E is the coverage check (no agent spawn).
- T2.5 on Uranus uses Playwright with `storageState.json`. T2.5 on a developer Mac uses `~/.local/bin/browser-harness`. The choice is made by Argos based on environment (`uname` / `$HOSTNAME`) at spawn time and recorded in the tier-report's "Tool" line.
- If `feature-handoff.md` is missing (e.g. on a story that pre-dates the multi-agent workflow), Argos can still run Phases A and B against the diff; Phases C / D / E require either a fresh implementation pass or André's explicit override.
