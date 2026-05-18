# Workflow: Implement story — `Start story <storyId>`

> **Audience.** This file is reference reading for the Orchestrator (Argos). Argos reads it when handling a kickoff line matching its trigger phrase. F, A, T, and S read their own role files in `.claude/agents/`; this workflow describes how Argos sequences them.

## Purpose

End-to-end implementation workflow for a single story from `docs/planning/tasks.md`. Drives the F ↔ A loop (architecture review, cap 3), the T phase (test authoring + tiering), the optional F-fix-pass + A re-check (Phase 5 / 5b), the close-out + S ↔ F loop (spec audit, cap 2), and the PR creation.

The full design is in `AGENT_LOOP_ON_URANUS.md §3`. The roles A, F, T, S are spawned by Argos via the Task tool with `subagent_type` equal to each role's name slug (`architecture-reviewer`, `feature-implementer`, `test-writer`, `spec-enforcer`).

## Kickoff

A line `Start story <storyId>` arrives in Argos's tmux pane via Dispatch (e.g. `Start story INFRA-002`, `Start story CTRF-001`).

> **Namespace note.** The target shape is `.argos/stories/<storyId>/`; today's implementation is still `.argos/<taskId>/`. Both paths are used interchangeably in this doc — substitute the live one for your repo. The migration is documented in `AGENT_LOOP_ON_URANUS.md §7` as future work.

## Preconditions

Before starting, Argos verifies:

1. **Dependencies satisfied.** Every task listed in the `depends_on` field of `<storyId>` in `tasks.md` is marked `[x]`. Do not start if any dependency is `[ ]` or `[/]`.
2. **No P0 gap blocks this story.** Review `docs/planning/gaps.md` for P0 items that would affect this story. If any P0 gap is directly relevant, halt and surface to André via Dispatch.
3. **Planning sections identified.** Argos has located the relevant acceptance criteria in `docs/planning/product.md` or `docs/planning/architecture.md`.
4. **No other story is mid-flight.** A single worktree, single implementer. If another `.argos/stories/<otherId>/` directory has an unclosed pipeline, surface the conflict.

---

## Phase 1 — Brief (Argos)

**Trigger:** Kickoff line `Start story <storyId>`.

**Reads:**
- `docs/planning/tasks.md` (story row + dependencies)
- `docs/planning/gaps.md` (relevant P0 / P1 items)
- The planning sections cited in `tasks.md` (`docs/planning/product.md §X`, `docs/planning/architecture.md §Y`, etc.)

**Side effects (before writing the brief):**
1. `git checkout main && git pull --ff-only`.
2. Cut `story/<storyId>` from `main` @ current sha.
3. Flip the task row in `docs/planning/tasks.md` from `[ ]` to `[/]`; commit on the story branch with message `chore(<storyId>): assign`; push.

**Writes:** `.argos/stories/<storyId>/brief.md` (gitignored — never commit). Use this template verbatim:

```markdown
# Task Brief — <storyId>: <title>

## Preconditions (verified by Argos)

- [x] Dependencies satisfied: <list of task IDs with [x], or "none">
- [x] No P0 gap blocks this story: <G-P0-XXX status each, or "none affecting this task">
- [x] Branch cut: `story/<storyId>` from `main` @ <short-sha>
- [x] `tasks.md` flipped `[ ]` → `[/]` on the story branch (commit `chore(<storyId>): assign`)

## Story

**Description.** <verbatim "###" line from `docs/planning/tasks.md`>

**Acceptance criteria.** <verbatim "Acceptance:" from `tasks.md`, broken into bullets for scannability>

**Test tiers required.** <verbatim `Test tiers required:` from `tasks.md`>

**Page verification tiers.** <verbatim `Page verification tiers:` from `tasks.md`, or "none (no rendered routes)">

**Critical test paths.** <verbatim `Critical test paths:` from `tasks.md`>

## Required reading

**Skills (full paths).**
- `skills/<name>.md` — <one-line why this skill applies here>
- …

**Planning doc sections.**
- `docs/planning/<file>.md §<section>` — <one-line why this section applies>
- …

**Org-wide context (optional deep-dive).** Each cited skill has a `source:` frontmatter line pointing at Performant Labs's org-wide standards under `docs/ai_guidance/`. The symlink resolves on workspaces that have `~/Sites/ai_guidance` cloned. Skills inline the relevant rules — following the source is optional. A broken `docs/ai_guidance/` symlink doesn't block feature work; PR-Agent in CI runs without it too.

## Iteration tracking (for F's awareness)

This brief is F's input on **iteration 1**. On subsequent iterations F is spawned with:
- `architecture-review-<N-1>.md` (F↔A loop, iter N>1, cap 3)
- `fix-pass-notes.md` (Phase 5 fix-pass after T BLOCK)
- `spec-audit-<M-1>.md` (Phase 6b spec-remediation, cap 2; light remediation rule)

Each F invocation appends a `## Iteration <N>` (or `## Fix-pass`, `## Spec-remediation iter <M-1>`) section to `feature-handoff.md`.
```

**Next trigger:** Argos spawns F (Phase 2) with `iteration=1`, `input=brief.md`.

---

## Phase 2 — F iteration N (Feature-implementer)

**Spawned by:** Argos, via Task tool with `subagent_type: feature-implementer` and a prompt naming the input artifact.

**Spawn input:**
- Iteration 1: `.argos/stories/<storyId>/brief.md`.
- Iteration N>1: `.argos/stories/<storyId>/architecture-review-<N-1>.md`. F also has implicit access to all prior `feature-handoff.md` and `brief.md`.

**Spawn prompt (Argos paraphrases at spawn time):**
> "Read your input file (cite the path). On iteration >1, the `block`-severity findings in the architecture review are blockers — fix every one. Implement/revise source in `src/`. Append a `## Iteration <N>` section to `.argos/stories/<storyId>/feature-handoff.md`. Run `tsc --noEmit`, commit, push, exit."

**F writes:**
- Source under `src/`, templates under `src/views/`, migrations under `src/migrations/{pg,sqlite}/`.
- An appended section in `.argos/stories/<storyId>/feature-handoff.md` (template in `.claude/agents/feature-implementer.md`).

**F side effects:**
- Commit:
  - Iteration 1: `feat(<storyId>): …` (or `refactor(<storyId>): …`).
  - Iteration N>1: `fix(<storyId>): address arch review iter <N-1>`.
- Push.

**Next trigger:** F subprocess exit → Argos spawns A in review mode (Phase 3) with the same iteration number.

---

## Phase 3 — A iteration N, review mode (Architecture Reviewer)

**Spawned by:** Argos, via Task tool with `subagent_type: architecture-reviewer`. Mode is implicit in the input artifact handed to A: `feature-handoff.md` + diff → review mode.

**Spawn input:**
- The latest `.argos/stories/<storyId>/feature-handoff.md`.
- The diff `git diff main..story/<storyId>` (via `Bash`).
- The brief (`brief.md`).
- All prior `architecture-review-*.md` files in `.argos/stories/<storyId>/`.

**Spawn prompt (paraphrased):**
> "Review mode. Read the latest `feature-handoff.md` section and the diff `main..story/<storyId>`. On iteration >1, also verify F addressed every `block`-severity finding from `architecture-review-<N-1>.md`. Audit for architectural drift (layering, dependency direction, naming, pattern consistency, abstraction altitude — see your role file). Write `.argos/stories/<storyId>/architecture-review-<N>.md` with PASS or BLOCK verdict. Exit."

**A writes:** `architecture-review-<N>.md`. Template lives in `.claude/agents/architecture-reviewer.md §Mode 1 — Review mode`.

**Verdict routing:**
- **PASS** (zero `block`-severity findings) → Phase 4.
- **BLOCK** and `N < 3` → increment N, return to Phase 2 with `architecture-review-<N>.md` as F's input.
- **BLOCK** and `N == 3` → write `escalation.md` referencing all three reviews, pause.

### Iteration tracking — numbered files, not overwrites

Each iteration writes a **new** `architecture-review-<N>.md` (N = 1, 2, 3). A on iteration 2+ reads iteration 1's findings to verify F addressed them rather than shuffled code. On escalation, André sees all three reviews side by side. `feature-handoff.md` is **appended** each iteration (`## Iteration <N>` heading) — it's a single running narrative.

---

## Phase 4 — Tests (Test-writer)

**Trigger:** A returned PASS in Phase 3.

**Spawned by:** Argos, via Task tool with `subagent_type: test-writer`.

**Spawn input:** `brief.md` + latest `feature-handoff.md` + diff.

**Spawn prompt (paraphrased):**
> "Implement the test tiers declared in the brief. T1 first (always required). T2 *or* T2.5 depending on the route's auth posture. T3 for UI stories only. Write the per-tier reports to `.argos/stories/<storyId>/tier-*.md` and the overall verdict to `test-handoff.md` (PASS or BLOCK). Commit + push, exit."

**T writes:**
- Tests under `src/__tests__/` and `e2e/tests/`.
- Tier reports: `tier-1-report.md` (always), `tier-2-report.md` *or* `tier-2-5-report.md` (one of, per auth posture), `tier-3-report.md` (UI stories).
- `test-handoff.md` with PASS / BLOCK.

**T side effects:** `test(<storyId>): …` commit, push.

**Verdict routing:**
- **PASS** → Phase 6.
- **BLOCK** → Phase 5.

---

## Phase 5 — F fix-pass for T failures (Feature-implementer, one-shot)

**Trigger:** T BLOCK in Phase 4.

**Argos writes:** `.argos/stories/<storyId>/fix-pass-notes.md` consolidating the failing tier reports — exact `tier-*.md` paths, the failing assertions, the diff hunks T cited as broken.

**Spawn input:** `fix-pass-notes.md`.

**F's prompt (paraphrased):** "Read `fix-pass-notes.md`. Address every failing tier assertion. Append a `## Fix-pass` section to `feature-handoff.md`. Commit `fix(<storyId>): address T failures`, push, exit."

**F writes:** source edits + appended handoff section.

### Phase 5b — A re-check (Architecture Reviewer, one-shot)

After F exits, Argos re-spawns A in review mode on the new diff. Single re-check (this is *not* a full F↔A loop reset).

**A writes:** `architecture-review-fix.md`.

**Verdict routing:**
- **A PASS** → re-spawn T (one more time only).
  - **T PASS** → Phase 6.
  - **T BLOCK** second time → write `escalation.md`, pause.
- **A BLOCK** → write `escalation.md`, pause.

The asymmetry — F↔A cap 3, F→T cap 1 — is deliberate: architectural drift is often a multi-step negotiation; test failures are usually narrower.

---

## Phase 6 — Close-out + S ↔ F loop (Argos, then Spec-enforcer)

**Trigger:** A PASS (final) and T PASS.

### 6.1 Argos writes the close-out commit

1. Write `.argos/stories/<storyId>/pr-body.md` (template in §Phase 8 below).
2. Flip `docs/planning/tasks.md` `[/]` → `[x]`.
3. Commit on the story branch: `chore(<storyId>): complete`. Push.
4. **Do NOT open the PR yet.** S is the merge-gate.

### 6.2 Argos spawns S

**Spawned by:** Argos, via Task tool with `subagent_type: spec-enforcer`.

**Spawn input:** the diff `main..story/<storyId>` + pointers to `docs/planning/*` and `skills/*`. On iteration M>1, also the prior `spec-audit-<M-1>.md`.

**Spawn prompt (paraphrased):**
> "Audit `main..story/<storyId>` against `docs/planning/*` and `skills/*`. On iteration >1, also verify F addressed every `block`-severity finding from `spec-audit-<M-1>.md`. Write `.argos/stories/<storyId>/spec-audit-<M>.md` (M=1 on first spawn) with PASS or BLOCK. Exit."

**S writes:** `spec-audit-<M>.md`. Template in `.claude/agents/spec-enforcer.md §Spec-audit template`.

**Verdict routing:**
- **PASS** → Phase 7.
- **BLOCK** and `M < 2` → Phase 6b.
- **BLOCK** and `M == 2` → write `escalation.md`, pause.

### Phase 6b — F spec-remediation (Feature-implementer, conditional, light rule)

**Trigger:** S BLOCK with `M < 2`.

**Spawn input:** `spec-audit-<M-1>.md`. F also has implicit access to `brief.md`, prior `feature-handoff.md`, `architecture-review-<N>.md` (PASS), `test-handoff.md` (PASS).

**Spawn prompt (paraphrased):**
> "Read `spec-audit-<M-1>.md`. Address every `block`-severity finding. **Light remediation rule:** A and T already passed — don't regress them. Limit edits to spec-audit findings' scope. Append `## Spec-remediation iter <M-1>` to `feature-handoff.md`. Commit `fix(<storyId>): address spec-audit-<M-1>`, push, exit."

**Next trigger:** F subprocess exit → Argos returns to Phase 6.2 to re-spawn **only S** (not A, not T). S iteration advances to M.

**Light remediation rule — justification.** A and T already passed; re-spawning them after a narrow spec-driven edit is wasteful. The light rule bets on F staying in scope; regressions get caught at PR-Agent time. Promote light → full re-run only if real-world data shows the light rule causing regressions.

---

## Phase 7 — PR creation (Argos)

**Trigger:** S PASS at Phase 6.

**Side effects:**

```bash
gh pr create \
  --base main \
  --head story/<storyId> \
  --title "[<storyId>] <summary>" \
  --body-file .argos/stories/<storyId>/pr-body.md
```

GitHub triggers PR-Agent automatically (default Kimi K2.6; `high-stakes` label routes to Opus 4.6). PR-Agent's review is **advisory** — the in-loop S audit at Phase 6 is the merge-gate proper.

**Next trigger:** Argos returns to idle, watching its tmux pane for the next kickoff.

---

## Phase 8 — PR body template

**Written by:** Argos at Phase 6.1. **Consumed by:** `gh pr create --body-file`, André at PR open, PR-Agent for review context.

Write to `.argos/stories/<storyId>/pr-body.md`. Fill from the handoff notes produced in Phases 2–6.

```markdown
# [<storyId>] <title>

## Summary

<1–3 sentences describing what this PR ships and why>

## Acceptance criteria

Verbatim from `docs/planning/tasks.md` → `<storyId>` → `Acceptance:`. Check every box. If any box is unchecked, this PR is not ready.

- [x] <criterion 1>
- [x] <criterion 2>
- [x] …

## Test tiers

| Layer | Declared in tasks.md | Present in diff | Notes |
|---|---|---|---|
| Unit | <yes/no> | ✓ | <count> tests in `src/__tests__/unit/*` |
| Integration | <yes/no> | ✓ | <count> tests in `src/__tests__/integration/*` |
| E2E | <yes/no> | ✓ / N/A | <count> specs in `e2e/tests/*` |

## Page verification tiers

T2 *or* T2.5 — fill the row that applied; mark the other "N/A — see <other tier>".

| Tier | Declared | Result | Report location (story branch) |
|---|---|---|---|
| T1 Headless | <from tasks.md> | ✓ | `.argos/stories/<storyId>/tier-1-report.md` |
| T2 ARIA (clean room) | <yes / no — unauthenticated route> | ✓ / N/A | `.argos/stories/<storyId>/tier-2-report.md` |
| T2.5 Authenticated State | <yes / no — auth-gated route> | ✓ / N/A | `.argos/stories/<storyId>/tier-2-5-report.md` |
| T3 Visual | <from tasks.md, or N/A> | ✓ / N/A | `.argos/stories/<storyId>/tier-3-report.md` |

## Architecture reviews

| # | Verdict | File |
|---|---|---|
| 1 | <PASS / BLOCK> | `.argos/stories/<storyId>/architecture-review-1.md` |
| 2 | <PASS / BLOCK> | `.argos/stories/<storyId>/architecture-review-2.md` (if iter 2 ran) |
| 3 | <PASS / BLOCK> | `.argos/stories/<storyId>/architecture-review-3.md` (if iter 3 ran) |
| fix | <PASS / BLOCK> | `.argos/stories/<storyId>/architecture-review-fix.md` (if Phase 5b ran) |

## Decisions that deviate from spec

List every choice not directly pinned down by `docs/planning/*` or `skills/*`. Spec-enforcer has already evaluated these; they are surfaced here so André can independently decide.

- <bullet describing the decision, the file it lives in, and why>
- **If none: "None — every decision is pinned to the spec."**

## Gaps filed during this story

- <G-ID — one-line summary — severity>
- **If none: "none"**

## Spec-enforcer verdict

**PASS** — see `.argos/stories/<storyId>/spec-audit-<M>.md` (M = <final iteration>)
**Date:** <YYYY-MM-DD>

## Next assignable stories (after this merges)

- `<storyId>` — <title>
- …

---
_Generated from `.argos/stories/<storyId>/pr-body.md`. If you edit the PR description directly on GitHub, the `.argos/` source will not reflect those edits._
```

---

## Phase 9 — Merge sweep (Argos)

**Trigger:** Dispatch sends `Merged PR #<N>` to Argos's pane.

**Side effects:**
1. `git checkout main && git pull --ff-only`.
2. If the merged story unblocks others, update `ORCHESTRATOR_HANDOFF.md` (or whichever file tracks "what's next").
3. Return to idle.

---

## Phase-by-phase summary

| Phase | Agent | Input | Output | Next trigger |
|---|---|---|---|---|
| 1 Brief | Argos | planning + kickoff line | `brief.md`, branch cut, `chore(<storyId>): assign` | Spawn F (iter 1) |
| 2 F iter N | F | iter 1: `brief.md` · iter N>1: `architecture-review-<N-1>.md` | source + appended `feature-handoff.md` | Subprocess exit → spawn A (iter N) |
| 3 A iter N (review mode) | A | `feature-handoff.md` + diff + prior reviews | `architecture-review-<N>.md` | PASS → Phase 4 · BLOCK & N<3 → Phase 2 with N+1 · BLOCK & N=3 → escalation |
| 4 T | T | brief + `feature-handoff.md` + diff | tier reports + `test-handoff.md` | PASS → Phase 6 · BLOCK → Phase 5 |
| 5 F fix-pass | Argos then F | `fix-pass-notes.md` | source + appended `feature-handoff.md` | A re-check (5b) |
| 5b A re-check | A | new diff | `architecture-review-fix.md` | PASS → re-spawn T once · BLOCK → escalation |
| 6 Close-out + S iter M | Argos then S | A PASS + T PASS; S input: diff + planning + skills + prior `spec-audit-<M-1>.md` | `pr-body.md` (Argos); `spec-audit-<M>.md` (S) | S PASS → Phase 7 · S BLOCK & M<2 → Phase 6b · S BLOCK & M=2 → escalation |
| 6b F spec-remediation iter M | F | `spec-audit-<M-1>.md` | source edits scoped to findings + appended `feature-handoff.md` | Subprocess exit → re-spawn S (iter M); A and T do NOT re-run |
| 7 PR creation | Argos | S PASS | (no new file) | `gh pr create` → GitHub triggers PR-Agent |
| 9 Merge sweep | Argos | merge notification | `ORCHESTRATOR_HANDOFF.md` update | Idle |

**Iteration caps:**
- F ↔ A loop: max **3** A iterations.
- F → T fix-pass: max **1** retry; one A re-check.
- S ↔ F loop: max **2** S iterations.

---

## `.argos/stories/<storyId>/` handoff schema (implement loop)

```
.argos/stories/<storyId>/
├── brief.md                          ← Phase 1 (Argos)
├── feature-handoff.md                ← Phases 2, 5, 6b (F, appended each iter)
├── architecture-review-1.md          ← Phase 3 (A review mode)
├── architecture-review-2.md          ← Phase 3 iter 2 (optional)
├── architecture-review-3.md          ← Phase 3 iter 3 (optional)
├── architecture-review-fix.md        ← Phase 5b (A re-check, optional)
├── tier-1-report.md                  ← Phase 4 (T)
├── tier-2-report.md  or  tier-2-5-report.md   ← Phase 4 (T, one of)
├── tier-3-report.md                  ← Phase 4 (T, UI stories only)
├── screenshots/                      ← Phase 4 (T, UI stories only)
├── test-handoff.md                   ← Phase 4 (T)
├── fix-pass-notes.md                 ← Phase 5 (Argos, T BLOCK only)
├── decisions.md                      ← any phase (Argos, appended; non-obvious autonomous calls — optional)
├── pr-body.md                        ← Phase 6.1 (Argos)
├── spec-audit-1.md                   ← Phase 6.2 (S)
├── spec-audit-2.md                   ← Phase 6b → 6.2 iter 2 (optional)
└── escalation.md                     ← reserved-conditions escalation only (see Escalation conditions)
```

`decisions.md` is the story's audit trail of non-obvious **autonomous** calls Argos
made instead of pausing on an interactive prompt. Argos appends a one-paragraph
entry whenever the autonomous-decision rule (below) produces a choice a reasonable
reader would not consider self-evident. It is **not** an escalation — writing it
never pauses the loop, and a story with no non-obvious calls may have no
`decisions.md` at all. Purpose, format, and write-triggers are defined in
`.claude/agents/orchestrator.md §Decision log`.

---

## Autonomous phase-gate routing (no interactive prompts)

Argos runs unattended; André is reachable only through Dispatch and cannot answer
an interactive `AskUserQuestion` popup. **Argos must not surface a popup to route a
phase gate.** Specifically, when A (Phase 3 / 5b) or T (Phase 4) returns **PASS but
also flags a `warn`- or `nit`-level finding**, the routing choice is Argos's to make
autonomously:

1. PASS clears the gate. A `warn`/`nit` finding on a PASS verdict does **not** by
   itself block progression.
2. If the finding raises a real question, Argos resolves it by re-reading the
   brief's acceptance criteria and constraints, then `docs/planning/*` and the
   architecture docs. If those show an acceptance criterion is genuinely unmet, the
   correct verdict was BLOCK and Argos routes the loop back accordingly.
3. Before autonomously interpreting an acceptance criterion, Argos checks the
   brief's Constraints section. If a literal reading of the criterion would require
   changes that violate any explicit constraint (e.g. "do not change pipeline
   config", "minimal edits", "no application code changes", "do not modify X"),
   Argos escalates to the human rather than autonomously deciding. The Constraints
   section is authoritative over a literal-reading-only interpretation of an
   acceptance criterion when the two conflict.
4. Argos documents any non-obvious call inline in the next handoff artifact it
   writes, and appends an entry to `decisions.md`.
5. Argos proceeds — it does not pause.

The full rule, including the `decisions.md` format, lives in
`.claude/agents/orchestrator.md §Autonomous decision-making` and `§Decision log`.
A PASS-with-`warn`/`nit` gate is **never** an escalation; it is always a judgment
call Argos owns.

## Escalation conditions

`escalation.md` (writing it **pauses the loop**) is reserved for **exactly** the
conditions below — operational cap breaches / pipeline faults plus one judgment-call
condition. Anything not in this table is a judgment call Argos owns and resolves via
the autonomous-decision rule above; it is **not** escalated and **not** surfaced as
an interactive prompt.

| Condition | Class | Action |
|---|---|---|
| P0 gap in `gaps.md` blocks this story | operational | Halt at Phase 1. Surface to André via Dispatch. |
| F↔A cap breach (3rd A BLOCK) | operational | Argos writes `escalation.md` referencing all three reviews. Pause. |
| T BLOCK twice (initial + retry after fix-pass) | operational | Argos writes `escalation.md` quoting both `test-handoff.md` versions. Pause. |
| A re-check (Phase 5b) BLOCK | operational | Argos writes `escalation.md` quoting `architecture-review-fix.md`. Pause. |
| S↔F cap breach (2nd S BLOCK) | operational | Argos writes `escalation.md` quoting both `spec-audit-*.md` and F's spec-remediation handoff section. Pause. |
| `gh pr create` fails at Phase 7 | operational | Argos writes `pr-create-failed.md`. Pause. |
| TypeScript errors remain at F's exit (Phase 2) | operational | F should not have exited; if it did, Argos surfaces this immediately rather than spawning A. |
| Genuinely ambiguous business-logic decision, unresolvable from the brief, `docs/planning/*`, or the architecture docs | judgment | Argos writes `escalation.md` describing the ambiguity and also files it to `docs/planning/gaps.md`. Pause. |

The seven operational rows are mechanical cap breaches and pipeline faults — they
are unchanged by the autonomy rule and must not be removed or weakened. The single
judgment row is the **only** escalation Argos raises on a judgment call: a genuine,
spec-unresolvable ambiguity. A non-escalation reminder for contrast:

| Non-condition (does NOT escalate) | What Argos does instead |
|---|---|
| A or T returns PASS with `warn`/`nit` findings | Proceed; log a non-obvious call in `decisions.md`. |
| F regresses A or T during spec-remediation | PR-Agent in CI catches it after Phase 7. Promote light → full re-run only if this becomes a real-world failure class. |

All escalations route to André via Dispatch (`cat .argos/stories/<storyId>/escalation.md`). Argos does not retry past the cap on its own.
