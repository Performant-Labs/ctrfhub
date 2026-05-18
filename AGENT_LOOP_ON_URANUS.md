# Agent loop on Uranus — filesystem-mediated pipeline design

**Date:** 2026-05-17
**Scope:** Design for running the CTRFHub agent workflow on the Linux server `uranus`. The human (André) never SSHes into Uranus directly — he talks only to **Dispatch**, a Claude orchestrator on a separate device. The design supports **two grand loops** (implement and audit) sharing the same agent cast, single worktree, and Dispatch surface. It is shaped by these non-negotiable constraints:

1. **No human relay between agents.** All inter-agent handoffs are mediated by files on disk under `.argos/`. André's only inputs are (a) kicking off a loop via Dispatch, and (b) reading reports Dispatch surfaces back.
2. **One implementer at a time.** Single pipeline, single worktree. The audit loop does not invoke F at all; the implement loop runs F serially.
3. **Implement-loop main flow is O → (F ↔ A)* → T → optional F-fix → close-out + (S ↔ F)* → PR.**
4. **Audit-loop flow is O → A (audit mode) → O (decomposition into stories).** No F, no PR.
5. **Spec-enforcer (S) is in the implement loop's Phase 6** as a merge-gate with its own bounded F-remediation cycle.

Sources read for this report: `FLOW.md`, `agents.md`, `AGENTS_README.md`, `HANDOFF.md`, `ORCHESTRATOR_HANDOFF.md`, `CLAUDE.md`, `docs/planning/project-architecture.md`, `.antigravity/workflows/implementstory.md`, `.antigravity/agents/orchestrator.md`, `MOVE_TO_URANUS_PLAN.md`, plus directory surveys of `.argos/`, `.intent/`, `.conductor/`, `.antigravity/`, `.claude/`, `.claude-bridge/`.

---

## 1. The two grand loops

Argos runs **two** distinct workflows. Both share the same agent cast, the same tmux pane, the same worktree, the same Dispatch surface — they differ in what triggers them, what artifacts they produce, and whether they ship code.

| Loop | Kickoff message | Workflow doc | Driver | Output | Ships code? |
|---|---|---|---|---|---|
| **Implement loop** | `Start story <storyId>` | `docs/orchestrator-workflows/implementstory.md` | O → (F↔A)* → T → close-out + (S↔F)* → PR | A merged PR for the story | Yes — opens a PR, lands on `main` after merge |
| **Audit loop** | `Audit scope <auditId>` | `docs/orchestrator-workflows/auditarchitecture.md` *(to be authored)* | O → A (audit mode) → O (decomposition) | A `findings.md` and a `decomposition.md` (one story brief per finding worth acting on) | No — produces work, does not execute it |

**Routing rule.** When a kickoff line lands in Argos's tmux pane, Argos looks at the verb:

- `Start story <storyId>` → implement loop, scoped to `.argos/stories/<storyId>/`.
- `Audit scope <auditId>` → audit loop, scoped to `.argos/audits/<auditId>/`.
- `Merged PR #<N>` → post-merge sweep on the implement loop's last active story.
- Anything else → Argos asks for clarification (Dispatch surfaces the question to André).

**Loop linkage.** The audit loop produces a `decomposition.md` whose entries are shaped as implement-loop briefs. After an audit completes, André (via Dispatch) can kick off the implement loop for each entry he wants to act on, with a kickoff line of the form `Start story <storyId-derived-from-finding>`. The two loops are **linked but not coupled** — the audit loop does not auto-spawn implement loops; that decision is André's, since each finding's story may need re-scoping, re-prioritizing against `tasks.md`, or rejection.

**Namespace partition.** Implement-loop artifacts live under `.argos/stories/<storyId>/`, audit-loop artifacts under `.argos/audits/<auditId>/`. The two namespaces never overlap. (Note: today's implement-loop artifacts live at `.argos/<taskId>/`, not `.argos/stories/<storyId>/`. The move from `.argos/<taskId>/` → `.argos/stories/<storyId>/` is a **future migration** that this revision documents as the target shape but does not perform. Until that migration lands, the implement loop uses `.argos/<taskId>/`; readers should mentally substitute that path wherever this doc says `.argos/stories/<storyId>/`.)

**Agent reuse.** Every transient agent except S is bi-modal or contextual. The most important is A:

- **A in review mode** (implement loop, Phase 3 and 5b): reads a diff and prior reviews, writes `architecture-review-<N>.md`.
- **A in audit mode** (audit loop, Phase A2): reads `audit-scope.md` and walks the scoped subtree, writes `findings.md`.

Mode is determined by **which input artifact Argos hands A on spawn**, not by a flag or a different agent file. Same role file (`.claude/agents/architecture-reviewer.md`), same model, same tools.

F, T, S are unchanged and are not invoked at all in the audit loop. PR-Agent is unchanged and runs only after the implement loop opens a PR.

---

## 2. The agent cast

| Codename | Role | Model | Tools | Lifecycle | Used in |
|---|---|---|---|---|---|
| **Argos** (O) | Orchestrator | `claude-opus-4-7` | full | Long-lived tmux session | Both loops |
| **F** | Feature-implementer | `claude-sonnet-4-6` | full (incl. Edit/Write) | Transient subprocess, spawned per iteration | Implement only |
| **A** | Architecture Reviewer (bi-modal: review / audit) | `claude-opus-4-7` | read-only (Read, Grep, Glob, Bash) | Transient subprocess | Both loops |
| **T** | Test-writer | `claude-sonnet-4-6` | full (writes tests only) | Transient subprocess | Implement only |
| **S** | Spec-enforcer | `claude-sonnet-4-6` | read-only | Transient subprocess (Phase 6 with S↔F sub-loop) | Implement only |
| **PR-Agent** | CI reviewer | Kimi K2.6 (Opus 4.6 on `high-stakes`) | GitHub Actions | CI-side, on every PR | Implement only (post-PR) |

**Argos (O)** is the Orchestrator. Runs as a single long-lived `claude` (Claude Code CLI) session inside a tmux pane on Uranus, attached to the repo at `~/CTRFHub`. **Argos's responsibilities are:**

1. **Route kickoff lines** from its tmux pane (delivered by Dispatch). `Start story X` → implement workflow; `Audit scope Y` → audit workflow; `Merged PR #N` → post-merge sweep.
2. **Implement loop (per `docs/orchestrator-workflows/implementstory.md`):**
   - Run Phase 1 to produce `.argos/stories/<storyId>/brief.md`.
   - **Spawn F** with the relevant input file (`brief.md` on iteration 1, `architecture-review-N.md` on F↔A iterations, `fix-pass-notes.md` on a post-T fix, `spec-audit-M.md` on a spec-remediation pass).
   - **Spawn A in review mode** after every F invocation that is part of the F↔A loop. Gate progression to T on A's verdict. If A BLOCKs, re-spawn F with the latest `architecture-review-N.md`.
   - **Spawn T** exactly once per story, only after A PASS.
   - On T BLOCK: write `fix-pass-notes.md`, spawn F, then A (one re-check), then T (one retry). On second T BLOCK: escalate.
   - After T+A clear, run Phase 6 close-out (write `pr-body.md`, flip `tasks.md`, commit, push). **Then spawn S** to audit the diff against `docs/planning/*` and `skills/*`.
   - Gate PR creation on S's verdict. If S BLOCKs and `M < 2`, re-spawn F with `spec-audit-<M>.md`; after F exits, only S re-runs. If S BLOCKs at M=2: escalate.
   - Enforce iteration caps: F↔A=3, F→T fix-pass=1 (with one A re-check), S↔F=2.
   - On success: `gh pr create`. Post-merge: sweep `main`.
3. **Audit loop (per `docs/orchestrator-workflows/auditarchitecture.md`, to be authored):**
   - Run Phase A1 to produce `.argos/audits/<auditId>/audit-scope.md` describing the scope and what to look for.
   - **Spawn A in audit mode** pointed at `audit-scope.md` (not at a diff). A walks the scoped code and writes `findings.md`.
   - Run Phase A3 to read `findings.md` and write `decomposition.md` — one entry per finding worth acting on, each shaped as an implement-loop story brief.
   - Audit loop ends. Argos does NOT auto-spawn implement loops from the decomposition; that requires a kickoff from André.
4. **Never write source code or tests.** Argos runs `git` and `gh` directly.

On Uranus, the orchestrator's role file (which will live at `~/CTRFHub/.claude/agents/orchestrator.md` after the move + YAML frontmatter is added) must reference `docs/orchestrator-workflows/` (which holds both workflow files) — **not** `.antigravity/workflows/`. The role file's prose must explicitly enumerate the routing rule, A's two modes, and A's place in each loop, so neither A's audit mode nor S is an invisible callee.

**Feature-implementer (F)** is the only agent that writes source code. Spawned by Argos only during the implement loop. Input file is one of: `brief.md` (initial), `architecture-review-N.md` (F↔A iteration), `fix-pass-notes.md` (post-T), or `spec-audit-M.md` (post-S). Reads relevant skills + planning sections, implements/revises code in `src/`, runs `tsc --noEmit`, commits, pushes, appends `feature-handoff.md`, exits. F is not used in the audit loop.

**Architecture Reviewer (A) — bi-modal.** Role file at `.claude/agents/architecture-reviewer.md`. Read-only. The same agent file is used in two distinct modes determined by the input artifact Argos hands it:

- **Review mode** (implement loop, Phase 3 + 5b): Input = `feature-handoff.md` + the diff `main..story/<storyId>` + prior `architecture-review-*.md`. A audits the diff for **architectural drift** in F's just-written code — layering, dependency direction, naming, pattern consistency. Output = `.argos/stories/<storyId>/architecture-review-<N>.md` with PASS/BLOCK.
- **Audit mode** (audit loop, Phase A2): Input = `audit-scope.md`. There is no diff. A walks the scoped subtree (a directory, subsystem, or set of files identified in the scope file) and produces a numbered, prioritized list of **architectural issues already present in the codebase**. Output = `.argos/audits/<auditId>/findings.md`. The findings are not gated by a verdict — the output is the findings list itself.

A is the same agent in both modes: same model (`claude-opus-4-7`), same tools (`Read, Grep, Glob, Bash`), same agent file, same general posture of "compare what's in front of you to the established patterns." The mode is implicit in the prompt Argos constructs at spawn time. A is *not* the Spec-enforcer in either mode — S audits against the declared spec (`docs/planning/*`, `skills/*`); A audits against the actual codebase.

**Test-writer (T)** is spawned exactly once after the F↔A loop converges (and again at most once if Phase 5 fix-pass runs). Reads the brief + the diff, writes tests under `tests/`, runs `vitest` and (where the brief declares them) `playwright` tiers. Writes tier reports and `test-handoff.md` with PASS/BLOCK. T is implement-loop only.

**Spec-enforcer (S)** is implement-loop only. Runs at Phase 6 after the close-out commit lands. Audits the full diff against `docs/planning/*` and `skills/*`. Writes `spec-audit-<M>.md` (M = 1, 2). On BLOCK, Argos re-spawns F with the spec-audit file; after F exits, only S re-runs (light remediation rule). Cap = 2 S iterations; second BLOCK escalates. PR-Agent in CI is a separate post-PR-open advisory layer; the in-loop S audit at Phase 6 is the merge-gate proper.

**PR-Agent** is the automated reviewer in GitHub Actions. Default Kimi K2.6; `high-stakes` routes to Opus 4.6. Advisory only. Implement-loop only.

**Hermes** is André's personal manager agent on another project. Not part of CTRFHub.

---

## 3. Implement loop — O → (F ↔ A)* → T → optional F-fix → close-out + (S ↔ F)* → PR

Argos drives the whole loop. Every transition between roles is a subprocess exit plus a file write. The pipeline has two iterated structures (F↔A, S↔F) and one bounded coda (F→T fix-pass + A re-check).

> All file paths in this section are written as `.argos/stories/<storyId>/…`. The current implementation uses `.argos/<taskId>/` — that path is the live one until the namespace migration lands.

### Phase 1 — Brief (O)
- **Trigger:** Kickoff line `Start story <storyId>` arrives in Argos's tmux pane.
- **Reads:** `docs/planning/tasks.md`, `docs/planning/gaps.md`, relevant planning sections, story dependencies.
- **Writes:** `.argos/stories/<storyId>/brief.md`.
- **Side effects:** Cuts `story/<storyId>` from `main`, flips `tasks.md` `[ ]` → `[/]`, commits `chore(<storyId>): assign`, pushes.
- **Next trigger:** Argos spawns F (Phase 2) with `iteration=1`, `input=brief.md`.

### Phase 2 — F iteration (F)
- **Spawn input:** On iteration 1, `brief.md`. On iteration N>1, `architecture-review-<N-1>.md` (plus implicit access to the previous `feature-handoff.md` and `brief.md`).
- **Spawn prompt:** "Read your input file. On iteration >1, the findings in the architecture review are blockers — fix every `block`-severity item. Implement/revise source in `src/`. Append your changes to `feature-handoff.md`. Exit."
- **Writes:** Source under `src/`, appended section in `feature-handoff.md` (`## Iteration <N>`).
- **Side effects:** `feat(<storyId>): …` (iteration 1) or `fix(<storyId>): address arch review iter <N-1>` (iter N>1) commit, push.
- **Next trigger:** Argos `wait()` returns → spawn A in review mode (Phase 3) with the same iteration number.

### Phase 3 — A iteration in review mode (A)
- **Spawn input:** Latest `feature-handoff.md`, the diff `git diff main..story/<storyId>`, the brief, all prior `architecture-review-*.md`.
- **Spawn prompt:** "Review the diff for architectural drift. Write `architecture-review-<N>.md` with PASS or BLOCK verdict. Exit."
- **Writes:** `architecture-review-<N>.md`.
- **Next trigger:**
  - **PASS** → Phase 4 (T).
  - **BLOCK** and `N < 3` → increment N, return to Phase 2 (re-spawn F with `architecture-review-<N>.md`).
  - **BLOCK** and `N == 3` → write `escalation.md` referencing all three reviews, pause.

### Iteration tracking — numbered files, not overwrites

Each iteration writes a **new** `architecture-review-<N>.md` (N = 1, 2, 3). A on iteration 2+ reads iteration 1's findings to verify F addressed them rather than shuffled code. On escalation, André sees all three reviews side by side. `feature-handoff.md` is **appended** (each iteration adds a `## Iteration <N>` heading) — it's a single running narrative.

### Phase 4 — Tests (T)
- **Trigger:** A returned PASS in Phase 3.
- **Spawn input:** Brief, latest `feature-handoff.md`, the diff.
- **Writes:** Tests under `tests/`, `tier-*.md` reports, `test-handoff.md` with overall PASS or BLOCK.
- **Side effects:** `test(<storyId>): …` commit, push.
- **Next trigger:**
  - **PASS** → Phase 6.
  - **BLOCK** → Phase 5.

### Phase 5 — F fix-pass for T failures (F, one-shot)
- **Trigger:** T BLOCK in Phase 4.
- **O writes:** `fix-pass-notes.md` consolidating the failing tier reports.
- **Spawn input:** `fix-pass-notes.md`.
- **F writes:** Source edits, appended `## Fix-pass` section in `feature-handoff.md`, `fix(<storyId>): address T failures` commit, push.
- **Phase 5b — A re-check after the fix-pass:** Argos re-spawns A in review mode on the new diff. Single re-check, not full F↔A. If A BLOCKs here, escalate.
- On A PASS: re-spawn T (one more time only).
  - T PASS → Phase 6.
  - T BLOCK a second time → escalate.

The asymmetry (F↔A allows 3 iterations, F→T allows 1) is deliberate: architectural drift is often a multi-step negotiation; test failures are usually narrower.

### Phase 6 — Close-out commit + spec audit (O, then S)
- **Trigger:** A PASS (final) and T PASS.
- **O writes:** `pr-body.md`. Flips `tasks.md` `[/]` → `[x]`.
- **O side effects:** `chore(<storyId>): complete`, push. **PR is not opened yet.**
- **O spawns S** with `iteration=1`, input = the diff + pointers to `docs/planning/*` and `skills/*`.
- **S writes:** `spec-audit-<M>.md` (M = 1 on first spawn).
- **Spawn prompt:** "Audit `main..story/<storyId>` against `docs/planning/*` and `skills/*`. On iteration >1, verify F addressed every `block` from `spec-audit-<M-1>.md`. Write `spec-audit-<M>.md` PASS or BLOCK. Exit."
- **Next trigger:**
  - **PASS** → Phase 7.
  - **BLOCK** and `M < 2` → Phase 6b.
  - **BLOCK** and `M == 2` → `escalation.md`, pause.

### Phase 6b — F spec-remediation (F, conditional, light rule)
- **Trigger:** S BLOCK with `M < 2`.
- **Spawn input:** `spec-audit-<M-1>.md`. F also has implicit access to `brief.md`, prior `feature-handoff.md`, `architecture-review-<N>.md` (PASS), `test-handoff.md` (PASS).
- **Spawn prompt:** "Read `spec-audit-<M-1>.md`. Address every `block`-severity finding. **Light remediation rule:** A and T already passed — don't regress them. Limit edits to spec-audit findings' scope. Append `## Spec-remediation iter <M-1>` to `feature-handoff.md`. Commit `fix(<storyId>): address spec-audit-<M-1>`, push, exit."
- **Next trigger:** Argos returns to Phase 6 to re-spawn **only S** (not A, not T). S iteration advances to M.

**Light remediation rule — justification.** A and T already passed; re-spawning them after a narrow spec-driven edit is wasteful. The light rule bets on F staying in scope; regressions get caught at PR-Agent time. Promote to full re-run only if real-world data shows the light rule causing regressions.

### Phase 7 — PR creation (O)
- **Trigger:** S PASS.
- **Side effects:** `gh pr create --base main --head story/<storyId> --body-file .argos/stories/<storyId>/pr-body.md`.
- **Next trigger:** GitHub → PR-Agent runs in CI as advisory. Argos returns to idle.

### Phase 8 — Merge & sweep (O)
- **Trigger:** Dispatch sends `Merged PR #<N>` to Argos's pane.
- **Side effects:** `git checkout main && git pull --ff-only`, updates `ORCHESTRATOR_HANDOFF.md` if the merged story unblocks others.

### Phase-by-phase summary

| Phase | Agent | Input | Output | Next trigger |
|---|---|---|---|---|
| 1 Brief | O | (planning + kickoff line) | `brief.md` | Spawn F (iter 1) |
| 2 F iter N | F | iter 1: `brief.md` · iter N>1: `architecture-review-<N-1>.md` | source + appended `feature-handoff.md` | Subprocess exit → spawn A (iter N) |
| 3 A iter N (review mode) | A | `feature-handoff.md` + diff + prior reviews | `architecture-review-<N>.md` | PASS → Phase 4 · BLOCK & N<3 → Phase 2 with N+1 · BLOCK & N=3 → escalation |
| 4 T | T | brief + `feature-handoff.md` + diff | `tier-*.md`, `test-handoff.md` | PASS → Phase 6 · BLOCK → Phase 5 |
| 5 F-fix | O then F | `fix-pass-notes.md` | source + appended `feature-handoff.md` | A re-check (5b) |
| 5b A re-check | A | new diff | `architecture-review-fix.md` | PASS → re-spawn T once · BLOCK → escalation |
| 6 Close-out + S iter M | O then S | A PASS + T PASS · S input: diff + planning + skills + prior `spec-audit-<M-1>.md` | `pr-body.md` (O); `spec-audit-<M>.md` (S) | S PASS → Phase 7 · S BLOCK & M<2 → Phase 6b with M+1 · S BLOCK & M=2 → escalation |
| 6b F spec-remediation iter M | F | `spec-audit-<M-1>.md` | source edits scoped to findings + appended `feature-handoff.md` | Subprocess exit → re-spawn S (iter M); A and T do NOT re-run |
| 7 PR creation | O | S PASS | (no new file) | `gh pr create` → GitHub triggers PR-Agent |
| 8 Merge sweep | O | merge notification | `ORCHESTRATOR_HANDOFF.md` update | Idle |

**Iteration caps:**
- F↔A loop: max **3** A iterations.
- F→T fix-pass: max **1** retry; one A re-check.
- S↔F loop: max **2** S iterations.

---

## 4. Implement loop — sequence diagram

```
┌─────────┐    ┌──────────┐    ┌──────────────────────────────────────────┐
│ André   │    │ Dispatch │    │ Uranus — tmux pane: argos                │
└────┬────┘    └────┬─────┘    └─────────────────┬────────────────────────┘
     │"Start story AUTH-001" │                   │
     │───────────────▶│                          │
     │                │ ssh + tmux send-keys     │
     │                │ "Start story AUTH-001"   │
     │                │─────────────────────────▶│
     │                │                          │
     │                │        ┌─────────────────▼──────────────────┐
     │                │        │ Argos (O) long-lived               │
     │                │        │ routes: "Start story X"            │
     │                │        │   → implement workflow             │
     │                │        └─────────────────┬──────────────────┘
     │                │                          │
     │                │     writes brief.md ─────┼──▶ .argos/stories/AUTH-001/brief.md
     │                │                          │
     │                │     N = 1                │
     │                │ ┌────────────────────────┤
     │                │ │  ╔═══════════════════╗ │
     │                │ │  ║ F ↔ A LOOP        ║ │
     │                │ │  ║ (A in review mode)║ │
     │                │ │  ╚═══════════════════╝ │
     │                │ │ spawn F(N) ────────────┼──▶┌──────────────┐
     │                │ │ wait(pid)              │   │ F            │
     │                │ │                        │   │ reads brief/ │
     │                │ │                        │   │ arch-rev-N-1 │
     │                │ │                        │   │ writes src   │
     │                │ │                        │   │ appends      │
     │                │ │                        │   │ feature-     │
     │                │ │                        │   │ handoff.md   │
     │                │ │ ◀──────────────────────┼───│ exit         │
     │                │ │                        │   └──────────────┘
     │                │ │ spawn A(N, review) ────┼──▶┌──────────────┐
     │                │ │ wait(pid)              │   │ A (review)   │
     │                │ │                        │   │ reads diff + │
     │                │ │                        │   │ prior a-r-*  │
     │                │ │                        │   │ writes       │
     │                │ │                        │   │ architecture-│
     │                │ │                        │   │ review-N.md  │
     │                │ │ ◀──────────────────────┼───│ exit         │
     │                │ │                        │   └──────────────┘
     │                │ │ verdict?               │
     │                │ │  ├ PASS ───────────────┼──▶ exit loop, spawn T
     │                │ │  ├ BLOCK & N<3 ────────┼──┐
     │                │ │  └ BLOCK & N=3 ────────┼──┼──▶ escalation.md, PAUSE
     │                │ │                        │  │
     │                │ │  N += 1 ◀──────────────┼──┘
     │                │ └────────────────────────┤
     │                │                          │
     │                │     spawn T ─────────────┼──▶┌──────────────┐
     │                │     wait(pid)            │   │ T            │
     │                │                          │   │ writes tests │
     │                │                          │   │ + tier-*.md  │
     │                │                          │   │ + test-      │
     │                │                          │   │ handoff.md   │
     │                │     ◀────────────────────┼───│ exit         │
     │                │                          │   └──────────────┘
     │                │     verdict?             │
     │                │      ├ PASS ─────────────┼──▶ Phase 6
     │                │      └ BLOCK ────────────┼──┐
     │                │                          │  │ fix-pass-notes.md
     │                │                          │  │ spawn F (one fix)
     │                │                          │  │ spawn A (one re-check)
     │                │                          │  │   ├ PASS → spawn T once
     │                │                          │  │   │     ├ PASS → Phase 6
     │                │                          │  │   │     └ BLOCK → escalation
     │                │                          │  │   └ BLOCK → escalation
     │                │                          │
     │                │ ┌────────────────────────┤
     │                │ │  ╔═══════════════════╗ │
     │                │ │  ║ S ↔ F LOOP        ║ │
     │                │ │  ║ (Phase 6 / 6b)    ║ │
     │                │ │  ╚═══════════════════╝ │
     │                │ │ M = 1                  │
     │                │ │ writes pr-body.md      │
     │                │ │ chore(...) commit+push │
     │                │ │ spawn S(M) ────────────┼──▶┌──────────────┐
     │                │ │ wait(pid)              │   │ S            │
     │                │ │                        │   │ reads diff + │
     │                │ │                        │   │ docs/planning│
     │                │ │                        │   │ + skills/    │
     │                │ │                        │   │ + prior      │
     │                │ │                        │   │ spec-audit-* │
     │                │ │                        │   │ writes       │
     │                │ │                        │   │ spec-audit-M │
     │                │ │ ◀──────────────────────┼───│ exit         │
     │                │ │                        │   └──────────────┘
     │                │ │ verdict?               │
     │                │ │  ├ PASS ───────────────┼──▶ Phase 7: gh pr create
     │                │ │  ├ BLOCK & M<2 ────────┼──┐
     │                │ │  └ BLOCK & M=2 ────────┼──┼─▶ escalation.md, PAUSE
     │                │ │                        │  │
     │                │ │ spawn F(spec-remed) ◀──┼──┘
     │                │ │ wait(pid)              │
     │                │ │                        │   reads spec-audit-M
     │                │ │                        │   scoped edits
     │                │ │                        │   appends handoff
     │                │ │ ◀──────────────────────┼─── exit
     │                │ │ M += 1 (S only; A/T not re-run)
     │                │ └────────────────────────┤
     │                │                          │
     │                │     Phase 7:             │
     │                │     gh pr create ───────▶│ GitHub → PR-Agent (advisory)
```

The F↔A box (Phases 2–3) and the S↔F box (Phases 6 / 6b) are the two iterated structures. The F-fix after T (Phase 5 + 5b) is a small two-step coda.

---

## 5. Audit loop — O → A (audit mode) → O (decomposition)

The audit loop produces architectural findings and a decomposition into actionable stories. **It does not invoke F, T, or S, does not touch source code, and does not open a PR.** Its output is two documents.

### Phase A1 — Scope (O)
- **Trigger:** Kickoff line `Audit scope <auditId>` arrives in Argos's tmux pane. The kickoff may include free-form scope description ("audit the auth subsystem", "audit everything under src/modules/dashboard", "audit all routes that bypass the rate-limiter preHandler").
- **Reads:** The kickoff message, `docs/planning/project-architecture.md`, relevant `skills/*.md` to understand which patterns A should treat as the baseline, and the existing tree under the scope.
- **Writes:** `.argos/audits/<auditId>/audit-scope.md` containing:
  - The audit ID and the date.
  - A bounded scope description: paths to walk, paths to ignore, depth of recursion, and any specific subsystems or layers in focus.
  - The set of architectural concerns to look for (drawn from `skills/*` — layering, dependency direction, naming, pattern consistency, etc.). This is A's checklist.
  - The acceptance criteria for the findings document: severity scale, expected format, prioritization rule.
- **Side effects:** Argos does **not** cut a branch. The audit loop produces no code; no branch needed. Commits the new files on `main` (or on a dedicated `audits/` branch if `main` is protected — that's a deploy detail).
- **Next trigger:** Argos spawns A in audit mode (Phase A2).

### Phase A2 — A in audit mode (A)
- **Spawn input:** `audit-scope.md`. A is **not** given a diff — there is no diff.
- **Spawn prompt:** "Audit mode. Read `.argos/audits/<auditId>/audit-scope.md` and walk the scoped subtree. Apply the checklist of architectural concerns. Write a numbered, prioritized findings list to `.argos/audits/<auditId>/findings.md`. Use the same severity levels (`block`, `warn`) as in review mode, but understand that this is a survey of existing code, not a verdict on a diff — there is no PASS/BLOCK here, just findings. Exit."
- **Reads:** Every file under the scope, plus neighboring files outside the scope when needed to understand the established pattern. Uses `Glob`, `Grep`, `Read` heavily.
- **Writes:** `findings.md` with a table along the lines of:
  | # | Severity | File:line | Drift dimension | Finding | Suggested remediation | Estimated story size |
  |---|---|---|---|---|---|---|
- **Termination:** Subprocess exits.
- **Next trigger:** Argos `wait()` returns → Phase A3.

### Phase A3 — Decomposition (O)
- **Trigger:** A exit, `findings.md` exists.
- **Reads:** `findings.md`, `docs/planning/tasks.md` (to align proposed stories with the existing backlog naming and prioritization), `docs/planning/gaps.md` (to avoid proposing stories that are already-open gaps).
- **Writes:** `.argos/audits/<auditId>/decomposition.md` — for each finding Argos decides to act on, one entry shaped as an implement-loop story brief:
  ```markdown
  ## Story <proposed-storyId>: <short title>
  **Source finding:** #<N> from findings.md
  **Severity carried over:** block | warn
  **Acceptance criteria:** …
  **Files in scope:** …
  **Required skills:** …
  **Declared test tiers:** …
  ```
  Argos may **drop** findings (e.g. duplicates, things already in `gaps.md`, things below a severity threshold) and **merge** findings into a single story (e.g. five layering violations in the same module become one refactor story). Each decision is briefly justified in the entry.
- **Side effects:** Commits `decomposition.md`. No branch cut, no PR.
- **Next trigger:** None. Audit loop ends. Argos returns to idle.

### Linkage to the implement loop

After the audit loop ends, André reads (via Dispatch) the `decomposition.md`. For each story he wants to act on, he sends Dispatch a kickoff line `Start story <proposed-storyId>` and the implement loop runs as documented in §3, with the decomposition entry as the initial input to Phase 1.

Argos does **not** auto-spawn implement loops from the decomposition. Three reasons: (1) Argos doesn't know the right ordering against `tasks.md` without André's input; (2) André may reject some entries entirely; (3) auto-spawning would let an audit silently kick off a dozen stories of work without confirmation. The decomposition is a proposal, not a queue.

### Audit-loop phase summary

| Phase | Agent | Input | Output | Next trigger |
|---|---|---|---|---|
| A1 Scope | O | kickoff `Audit scope <auditId>` + planning + skills | `audit-scope.md` | Spawn A in audit mode |
| A2 Audit | A (audit mode) | `audit-scope.md` + scoped tree | `findings.md` | Subprocess exit → Phase A3 |
| A3 Decompose | O | `findings.md` + `tasks.md` + `gaps.md` | `decomposition.md` | Loop ends; André may kick off implement loops |

### Audit-loop sequence diagram

```
┌─────────┐    ┌──────────┐    ┌──────────────────────────────────────────┐
│ André   │    │ Dispatch │    │ Uranus — tmux pane: argos                │
└────┬────┘    └────┬─────┘    └─────────────────┬────────────────────────┘
     │"Audit scope DASHBOARD-AUDIT-01" │         │
     │───────────────▶│                          │
     │                │ ssh + tmux send-keys     │
     │                │─────────────────────────▶│
     │                │                          │
     │                │        ┌─────────────────▼──────────────────┐
     │                │        │ Argos (O)                          │
     │                │        │ routes: "Audit scope Y"            │
     │                │        │   → audit workflow                 │
     │                │        └─────────────────┬──────────────────┘
     │                │                          │
     │                │  writes audit-scope.md ──┼──▶ .argos/audits/DASHBOARD-AUDIT-01/audit-scope.md
     │                │                          │
     │                │  spawn A (audit mode) ───┼──▶┌──────────────┐
     │                │  wait(pid)               │   │ A (audit)    │
     │                │                          │   │ reads scope  │
     │                │                          │   │ walks tree   │
     │                │                          │   │ Glob/Grep    │
     │                │                          │   │ writes       │
     │                │                          │   │ findings.md  │
     │                │  ◀───────────────────────┼───│ exit         │
     │                │                          │   └──────────────┘
     │                │  reads findings.md       │
     │                │  + tasks.md + gaps.md    │
     │                │  writes decomposition.md ┼──▶ .argos/audits/DASHBOARD-AUDIT-01/decomposition.md
     │                │  commits, returns idle   │
     │                │                          │
     │"Audit done?"   │                          │
     │───────────────▶│ ssh + cat decomposition.md
     │                │─────────────────────────▶│
     │                │ ◀────────────────────────│
     │ ◀──────────────│ summary of proposed stories
     │                │
     │"Start story DASHBOARD-AUDIT-01-S3"        │
     │───────────────▶│  → kicks off implement loop with decomposition entry S3
```

The audit loop has no inner iteration — A produces findings once, O decomposes once. There is no F to iterate with, no T to gate on, no S to remediate against. The only place iteration *could* be introduced is a second pass of A after O has rewritten the scope (e.g. "narrow the scope to X subsystem and re-audit"), but that's a new audit ID, not a re-entry to the existing loop.

### Audit-loop handoff schema

| File | Writer | Reader(s) | When |
|---|---|---|---|
| `audit-scope.md` | O | A (audit mode) | Phase A1 |
| `findings.md` | A (audit mode) | O (decomposition), André (via Dispatch) | Phase A2 |
| `decomposition.md` | O | André (via Dispatch), and subsequent implement-loop Phase 1 invocations | Phase A3 |
| `escalation.md` | O | André (via Dispatch) | If A's audit-mode subprocess hangs or returns malformed findings |

That's the entire artifact set. The audit loop is meant to be small and inspectable.

---

## 6. AntiGravity, claude-bridge, browser-harness — what survives

**AntiGravity is gone.** Every transient agent (F, A in either mode, T, S) is a `claude -p` subprocess spawned by Argos. The role files (`.claude/agents/feature-implementer.md`, `architecture-reviewer.md`, `test-writer.md`, eventually `orchestrator.md` and `spec-enforcer.md`) are read by the spawned subprocess at the top of its prompt.

**Workflow markdown moved.** `implementstory.md`, `verifystory.md`, `audit-tests.md` have been **copied verbatim** from `.antigravity/workflows/` to `docs/orchestrator-workflows/`. A separate pass will rewrite them to match this design. **The new `docs/orchestrator-workflows/auditarchitecture.md` is not yet authored** — it needs to be written before the audit loop can run in production. Its content will mirror the structure of `implementstory.md` but cover the three-phase audit pipeline.

**The claude-bridge is vestigial.** Argos on Uranus is already a shell process. Delete `.claude-bridge/` from active use.

**The browser-harness for Tier 2.5 still blocks.** Headless Linux has no equivalent surface. Three options from `MOVE_TO_URANUS_PLAN.md §8 risk #14` still apply. Decision required before DASH-001. Audit loop is unaffected.

---

## 7. `.argos/` handoff schema (both loops)

`.argos/` is tracked in git. Implement-loop artifacts travel with the story branch; audit-loop artifacts travel on `main` (or a dedicated audits branch).

### Namespace partition

```
.argos/
├── stories/
│   └── <storyId>/        ← implement loop (target shape; today still at .argos/<taskId>/)
│       ├── brief.md
│       ├── feature-handoff.md
│       ├── architecture-review-1.md
│       ├── architecture-review-2.md
│       ├── architecture-review-3.md       (optional)
│       ├── architecture-review-fix.md     (Phase 5b only)
│       ├── tier-1-report.md
│       ├── tier-2-report.md  or  tier-2-5-report.md
│       ├── tier-3-report.md               (UI stories only)
│       ├── screenshots/                   (UI stories only)
│       ├── test-handoff.md
│       ├── fix-pass-notes.md              (Phase 5 only)
│       ├── decisions.md                   (autonomous-decision audit trail; optional)
│       ├── pr-body.md
│       ├── spec-audit-1.md
│       ├── spec-audit-2.md                (S↔F iter 2)
│       └── escalation.md                  (reserved-conditions escalation only)
└── audits/
    └── <auditId>/        ← audit loop
        ├── audit-scope.md
        ├── findings.md
        ├── decomposition.md
        └── escalation.md                  (failure only)
```

> **Migration note.** The path `.argos/stories/<storyId>/` is the **target** shape. Today, implement-loop files live at `.argos/<taskId>/`. The move from flat `.argos/<taskId>/` → `.argos/stories/<storyId>/` is a future migration; this revision documents the target and the namespace partition but does not perform the rename. Tools that read `.argos/` need to handle both paths during the transition.

### Implement-loop schema

| File | Writer | Reader(s) | When |
|---|---|---|---|
| `brief.md` | O | F (iter 1), A, T | Phase 1 |
| `feature-handoff.md` | F (appended each iter) | A, T, O | Phases 2, 5, 6b |
| `architecture-review-<N>.md` (N = 1, 2, 3) | A (review mode) | O (gating), F (iter N+1 input) | Phase 3 — one file per iteration |
| `architecture-review-fix.md` | A (review mode) | O (gating) | Phase 5b — single re-check after T fix-pass |
| `tier-1-report.md` | T | O | Phase 4 |
| `tier-2-report.md` *or* `tier-2-5-report.md` | T | O | Phase 4 |
| `tier-3-report.md` + `screenshots/` | T | O | Phase 4 — UI stories only |
| `test-handoff.md` | T | O (gating), F (Phase 5 input via fix-pass-notes) | Phase 4 |
| `fix-pass-notes.md` | O | F | Phase 5 only |
| `decisions.md` | O (appended) | André (via Dispatch), O (later phases) | Any phase — appended whenever the autonomous-decision rule produces a non-obvious call; optional (a story with none may omit the file) |
| `pr-body.md` | O | `gh pr create --body-file`, PR-Agent, S | Phase 6 |
| `spec-audit-<M>.md` (M = 1, 2) | S | O (gating), F (iter M+1 input) | Phase 6 — one file per iteration |
| `escalation.md` | O | André (via Dispatch) | F↔A cap breach, T 2nd BLOCK, A re-check BLOCK, S↔F 2nd BLOCK, `gh pr create` failure, P0 gap, or a genuinely spec-unresolvable business-logic ambiguity — see `implementstory.md` "Escalation conditions" |

`decisions.md` and `escalation.md` are deliberately separate. `escalation.md` is a **pause** signal — Argos writes it only for the bounded set of cap breaches, pipeline faults, and spec-unresolvable ambiguities enumerated in `implementstory.md`'s "Escalation conditions" table, and the loop stops until André intervenes. `decisions.md` is a **non-pausing** audit trail — Argos appends to it whenever the autonomous-decision rule (`.claude/agents/orchestrator.md §Autonomous decision-making`) produces a non-obvious call, so a `warn`/`nit` finding on a PASS verdict is recorded and proceeded past rather than stalled on an interactive prompt the remote human cannot answer. The format and write-triggers for `decisions.md` are defined in `.claude/agents/orchestrator.md §Decision log`.

### Audit-loop schema

| File | Writer | Reader(s) | When |
|---|---|---|---|
| `audit-scope.md` | O | A (audit mode) | Phase A1 |
| `findings.md` | A (audit mode) | O (decomposition), André (via Dispatch) | Phase A2 |
| `decomposition.md` | O | André (via Dispatch), subsequent implement-loop Phase 1 | Phase A3 |
| `escalation.md` | O | André (via Dispatch) | A hang or malformed findings |

Format is markdown-by-template. Templates live in: the architecture-review template in `.claude/agents/architecture-reviewer.md` (both modes); the spec-audit template in the (future) `.claude/agents/spec-enforcer.md`; the brief and tier-report templates in `docs/orchestrator-workflows/implementstory.md` and `verifystory.md` (yet-to-be-adapted); the audit-scope, findings, and decomposition templates in `docs/orchestrator-workflows/auditarchitecture.md` (to be authored).

---

## 8. What breaks on Linux

Items that existed only to coordinate two implementers are gone. Audit loop adds no new Linux-specific failure classes.

**Must-fix:**

- **AntiGravity replacement.** F, A (in either mode), T, S are spawned via `claude -p`. Wrapper at `~/CTRFHub/.antigravity/scripts/spawn-agent.sh`, parameterized on `$AGENT_ROLE` and `$INPUT_FILE`. The mode A is in is determined by which `$INPUT_FILE` it is handed.
- **`~/.local/bin/browser-harness` (Tier 2.5).** See §6.

**Path / config drift:**

- **`docs/ai_guidance` symlink** hardcoded to macOS path. On Linux: `rm docs/ai_guidance && ln -s ~/Sites/ai_guidance docs/ai_guidance && git update-index --assume-unchanged docs/ai_guidance`.
- **`.antigravity/scripts/shell-aliases.sh`** and **`pr-review.sh`** hardcode `~/Projects/ctrfhub`; both honor `CTRFHUB_DIR=$HOME/CTRFHub`. `shell-aliases.sh` is zsh-only.
- **`pr-review.sh`** hardcodes Homebrew PATH. Drop on Linux.
- **Claude Code OAuth** and `gh auth` must be re-done fresh on Uranus.
- **`.env`** gitignored; rsync over Tailscale before the move.
- **Docker compose ghcr images** in `compose.yml` / `compose.sqlite.yml` not yet published; use `compose.dev.yml`.

**Architectural debt cleared by the new model:**

- No claude-bridge port. Argos has direct shell access.
- No worktree multiplication. One worktree at `~/CTRFHub`. Argos switches branches between stories; subprocesses only run while Argos `wait()`s on them. The audit loop doesn't switch branches at all.
- No VM. No multi-pane tmux.

---

## 9. Dispatch architecture

**Dispatch has two jobs, unchanged in shape regardless of loop:**

1. **Kickoff:** Deliver a one-line message from André to Argos's tmux pane on Uranus.
2. **Status read-back:** Read the appropriate `.argos/` subtree (stories or audits) and surface state to André.

Dispatch is **not** in the data path between Argos and any subprocess.

### Routing on kickoff

Dispatch passes through the kickoff verb unchanged — Argos does the routing on receipt. André can say:

- `Start story AUTH-001` → Dispatch sends as-is to Argos → implement workflow.
- `Audit scope DASHBOARD-AUDIT-01` → Dispatch sends as-is → audit workflow.
- `Merged PR #42` → Dispatch sends as-is → post-merge sweep on the implement loop's last active story.
- `Start story DASHBOARD-AUDIT-01-S3` (a decomposed story from a prior audit) → Dispatch sends as-is → implement workflow uses the decomposition entry as input to Phase 1.

Dispatch does **not** parse or interpret the verb. The orchestrator's routing rule is the single source of truth.

### Status read-back across both namespaces

When André asks about progress, Dispatch needs to know which namespace to look in. Two options:

1. **Explicit:** André says "what's happening with story AUTH-001?" or "what's happening with audit DASHBOARD-AUDIT-01?". Dispatch SSHes into the matching subtree.
2. **Inferred:** If André says "what's happening?" with no qualifier, Dispatch lists both `.argos/stories/` and `.argos/audits/` newest-first and reports on whichever has the most recent activity.

Either works. The simpler kickoff convention (`Start story X` / `Audit scope Y` includes the type) makes option 1 the default.

### Setup on Uranus (unchanged from prior revision)

- One dedicated user, repo at `~/CTRFHub`.
- One persistent tmux session `argos` running `claude --resume`, started by a `systemd --user` unit.
- Helper script `~/CTRFHub/.antigravity/scripts/spawn-agent.sh` parameterized on `$AGENT_ROLE` and `$INPUT_FILE` (the same script serves both A modes — only the input file differs).
- Dispatch's SSH key restricted via `~/.ssh/authorized_keys` `command=` or `ForceCommand` to a narrow allow-list.

### Dispatch's allowed operations on Uranus

```bash
# Kickoff / merge notification (any loop)
tmux send-keys -t argos "$MESSAGE" Enter

# Status read-back — implement loop
ls -t ~/CTRFHub/.argos/stories/$STORY_ID/   # (or .argos/$STORY_ID/ until migration)
cat ~/CTRFHub/.argos/stories/$STORY_ID/<filename>

# Status read-back — audit loop
ls -t ~/CTRFHub/.argos/audits/$AUDIT_ID/
cat ~/CTRFHub/.argos/audits/$AUDIT_ID/<filename>

# Liveness and PR state
tmux capture-pane -t argos -p -S -200
gh pr view <N> --json state,reviews
```

### Status interpretation — both loops

**Implement loop (under `.argos/stories/<storyId>/`):**
- `brief.md` only → Phase 1 done, F iter 1 running.
- `architecture-review-1.md` PASS, no `test-handoff.md` → T running (Phase 4).
- `architecture-review-2.md` exists → F↔A loop on iter 2.
- `architecture-review-3.md` BLOCK + no `escalation.md` → about to escalate (or already wrote it).
- `test-handoff.md` PASS + `pr-body.md` exists + no `spec-audit-*.md` → close-out commit landed, S running.
- `spec-audit-1.md` BLOCK → S↔F loop on iter 2 (F spec-remediation running).
- `spec-audit-2.md` PASS → about to open PR.
- `spec-audit-2.md` BLOCK → escalation imminent or already written.
- `escalation.md` → paused.
- GitHub PR exists → Phase 7 done, awaiting merge.

**Audit loop (under `.argos/audits/<auditId>/`):**
- `audit-scope.md` only → Phase A1 done, A walking the tree.
- `findings.md` exists, no `decomposition.md` → Phase A3 running (O reading findings, writing decomposition).
- `decomposition.md` exists → loop done; surface to André with proposed stories.
- `escalation.md` → A hung or returned malformed findings; paused.

### Kickoff flow examples

**Implement:** André: "Start story AUTH-001" → Dispatch SSHes, `tmux send-keys` → Argos routes to implement workflow, runs Phase 1, then drives F↔A → T → optional F-fix → close-out + S↔F → PR autonomously.

**Audit:** André: "Audit scope DASHBOARD-AUDIT-01" → Dispatch SSHes, `tmux send-keys` → Argos routes to audit workflow, runs Phase A1 to write `audit-scope.md`, spawns A in audit mode, then writes `decomposition.md`. Loop ends; Argos goes idle. Dispatch surfaces `decomposition.md` to André on next status query.

**Loop linkage:** After reading the decomposition, André: "Start story DASHBOARD-AUDIT-01-S3" → Dispatch sends → Argos starts a fresh implement loop using the S3 entry as the brief input.

### Why this shape

- **Argos is the only long-lived process.** F, A, T, S are all transient; A's two modes share the same process model.
- **Dispatch is stateless across loops.** It doesn't track which loop is running — `.argos/` directory listings are the truth.
- **André's UX is two kickoff phrases and one question:** "start story X", "audit scope Y", "what about Z?". The kickoff phrase tells Dispatch which subtree to look in.
- **Both loops use the same agent file for A.** No mode flag, no second agent definition — just a different input artifact at spawn time.

### Failure modes

- **Argos's tmux session dies.** `systemd --user` restarts it; `claude --resume` picks up the conversation. Both loops are resumable because all state is in `.argos/` files.
- **F / A / T / S subprocess hangs.** Per-spawn timeout (F: 45 min, A in review: 15 min, A in audit: 30 min — audit walks a larger surface, T: 30 min, S: 20 min). On timeout, Argos kills, writes `timeout-<role>.md`, pauses.
- **A in audit mode returns malformed `findings.md`.** Argos writes `escalation.md` quoting the malformed output. Dispatch surfaces to André.
- **F↔A cap breach (3rd A BLOCK).** Escalate with all three reviews.
- **T BLOCK twice.** Escalate.
- **A re-check (Phase 5b) BLOCK.** Escalate.
- **S↔F cap breach (2nd S BLOCK).** Escalate quoting both `spec-audit-*.md` and F's spec-remediation handoff.
- **F regresses A or T during spec-remediation.** PR-Agent in CI catches it. Promote light → full re-run if it becomes a real-world failure class.
- **Dispatch can't reach Uranus.** Pipeline continues; status queries fail; André gets an error.
- **`gh pr create` fails.** Argos writes `pr-create-failed.md`, pauses.

---

*Document revised 2026-05-17 with: filesystem-only inter-agent handoffs, single-implementer pipeline, two grand loops (implement and audit) sharing the same cast and Dispatch surface, A is bi-modal across the two loops (review mode in implement, audit mode in audit), audit loop is three phases (scope → audit → decompose) and produces work rather than ships it, namespace partition `.argos/stories/<storyId>/` vs `.argos/audits/<auditId>/` documented as target shape (implement-loop migration from `.argos/<taskId>/` is future work), workflow doc `docs/orchestrator-workflows/auditarchitecture.md` flagged as to-be-authored. Orchestrator's responsibilities now include kickoff routing across both loops and the audit-loop scope/decomposition phases.*
