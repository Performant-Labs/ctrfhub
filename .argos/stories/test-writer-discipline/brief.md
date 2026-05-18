# Story: Tune the test-writer agent to land minimum-meaningful coverage

## Argos preconditions & notes (added at Phase 1)

- [x] Dependencies satisfied: `ctrfhub-docker-build-fix` (#71), `ctrfhub-docker-build-cache` (#72), `orchestrator-autonomy-hardening` (#73) all merged.
- [x] No P0 gap blocks this story: G-P0-001..004 concern Tailwind/Eta/settings/AI — none affect test-writer role tuning.
- [x] Branch cut: `story/test-writer-discipline` from `main` @ `4240e74`.
- No `tasks.md` row (process/governance story) — nothing to flip.
- [x] `evidence-audit.md` read — its Section D recommendation matches the brief's three scope edits.

### Binding decisions for this story (READ BEFORE IMPLEMENTING)

**Decision 1 — Acceptance criterion 1's verification artifact is an audit script
in `scripts/`, NOT a unit test.** Criterion 1 offers two routes: "a unit test of
the role-file content, OR an audit script in `scripts/`." The brief's Constraints
section restricts this PR to "role files / workflow docs / scripts." A unit test
file under `src/__tests__/` falls *outside* that allowed set; an audit script in
`scripts/` falls squarely *inside* it. Because criterion 1 explicitly offers a
route that fully respects the Constraints section, Argos selects it autonomously
(no escalation needed — this applies the constraints-over-literal-reading
discipline merged in `orchestrator-autonomy-hardening` / PR #73). **F writes the
audit script in `scripts/`.**

**Decision 2 — Acceptance criterion 2's "dry-run" is performed by the Phase 4 T
invocation, and its output is an artifact, not a commit.** Criterion 2 asks that
"Argos's test-writer is re-prompted to re-do the `ctrfhub-docker-build-fix` story's
test file as a dry-run." That re-prompt IS the Phase 4 T spawn. By then F has
edited `.claude/agents/test-writer.md` on this branch, so the spawned T runs under
the *new* rules — exactly the integration check criterion 2 wants. T re-derives
the build-fix test file independently, reports the resulting test count (target
≤ 12; 8–10 load-bearing), and writes the comparison into the story namespace /
handoff. **The dry-run output is a comparison artifact under
`.argos/stories/test-writer-discipline/` — it is NOT committed over, and does NOT
delete or modify, `src/__tests__/integration/static-asset-auth-bypass.test.ts`**
(brief constraint + acceptance criterion 3: the existing 31 tests stay).

**Constraint reinforcement.** Touch only role files, workflow docs, and
`scripts/`. Do NOT change application code. Do NOT delete or edit the build-fix
story's existing 31-test file.

## Motivation
On the first run of the implementstory loop (story `ctrfhub-docker-build-fix`), the test-writer agent (T) wrote 31 new integration tests for a change that consisted of a single conditional in `src/app.ts` plus a Dockerfile fix. A diagnostic audit (see `evidence-audit.md` in this story namespace) found:

- ~9 of the 31 tests are load-bearing (unique regression signal).
- ~18 are matrix fan-out — `for`-loops iterating 6 asset paths × 2–3 assertions through the same prefix-check branch.
- ~4 flatly duplicate coverage in `health.test.ts` and `auth.test.ts`.
- 6 assert an `HX-Redirect` outcome that is physically unreachable because Branch 0 returns first; they cannot fail unless an existing branch is deleted, in which case other tests catch it.

The root cause is in `.claude/agents/test-writer.md` and `docs/orchestrator-workflows/audit-tests.md`:
- T's role file mandates a 401/422/429/413 matrix "for every new route" applied as a floor, not a ceiling.
- Minimum-coverage rules have no upper bound and no "one test per distinct branch" guidance.
- The audit-tests workflow rewards test-file existence one-directionally — counts new tests as positive without penalizing fan-out.

## Scope (three targeted edits)

1. **Add a test-sizing rule to `.claude/agents/test-writer.md`:** "One test per distinct branch added. One test per distinct branch removed. The 4xx response-code matrix is a per-route ceiling, not a per-asset multiplier. Loops over input strings that all exercise the same code branch count as ONE test, not N."

2. **Reframe the 401/422/429/413 matrix as a per-route ceiling**, not a floor — explicitly. Add a worked counter-example showing what NOT to do (a `for` loop over 6 paths × 4 codes producing 24 tests).

3. **Add a pre-handoff self-check** to T's workflow in `.claude/agents/test-writer.md` and `docs/orchestrator-workflows/verifystory.md`: before emitting `test-handoff.md`, T must answer for every new test "would this test fail in isolation if the code were wrong?" If the answer is "no, only if another test would also fail" — delete the test.

Also update `docs/orchestrator-workflows/audit-tests.md` to penalize fan-out — counting tests-per-distinct-branch as the metric, not raw test count.

## Acceptance criteria
- A small test-only PR is opened that updates the three docs and verifies (via a unit test of the role-file content, or via an audit script in `scripts/`) that the new rules are present.
- Argos's test-writer is re-prompted to re-do the ctrfhub-docker-build-fix story's test file as a dry-run: T should produce ≤ 12 tests under the new rules (target: 8–10 load-bearing tests). Compare diff in the story handoff.
- No existing test files are deleted in this PR — the rule is forward-looking for new tests; the build-fix story's existing 31 tests stay for now.

## Constraints
- Touch only role files / workflow docs / scripts in this PR.
- Do not change application code.
- Do not delete the existing 31 tests; they'll be cleaned up in a separate housekeeping pass.
- Merges on top of whichever main is current when this story starts.

## Note to Argos
This story is queued. Start AFTER `ctrfhub-docker-build-fix`, `ctrfhub-docker-build-cache`, AND `orchestrator-autonomy-hardening` have all merged. Read `evidence-audit.md` in this story's namespace before drafting the brief; it has the verbatim categorized test breakdown and the lines from `test-writer.md` and `audit-tests.md` that drive the over-testing.
