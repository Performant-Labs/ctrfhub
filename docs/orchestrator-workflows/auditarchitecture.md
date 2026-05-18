# Workflow: Audit architecture — `Audit scope <auditId>`

> **Audience.** This file is reference reading for the Orchestrator (Argos). Argos reads it when handling a kickoff line matching its trigger phrase. F, T, and S are not involved in this workflow.

## Purpose

The audit loop produces architectural findings and a decomposition into actionable stories. **It does not invoke F, T, or S, does not touch source code, and does not open a PR.** Its output is two documents under `.argos/audits/<auditId>/`:

1. `findings.md` — the Architecture Reviewer's numbered, prioritized list of architectural issues already present in the codebase.
2. `decomposition.md` — Argos's translation of those findings into implement-loop story briefs, one per finding worth acting on.

The full design is in `AGENT_LOOP_ON_URANUS.md §5`.

## Kickoff

A kickoff line `Audit scope <auditId>` arrives in Argos's tmux pane via Dispatch. The kickoff may include free-form scope description, for example:

- `Audit scope DASHBOARD-AUDIT-01: audit src/modules/dashboard`
- `Audit scope AUTH-AUDIT-02: audit all routes that bypass the rate-limiter preHandler`
- `Audit scope INGEST-AUDIT-03: audit the auth subsystem under src/modules/auth`

The free-form scope text becomes the seed for Phase A1's `audit-scope.md`.

## Preconditions

Before starting, Argos verifies:

1. **No implement loop is in flight.** The audit loop and implement loop share a single worktree. If a story is mid-execution (a `.argos/stories/<storyId>/` exists without a closing `pr-body.md` or `escalation.md`), pause the audit kickoff and surface the conflict to André via Dispatch.
2. **The `<auditId>` is unique.** `.argos/audits/<auditId>/` does not already exist. If it does, this is either a re-kickoff or a duplicate ID — surface to André.
3. **The scope is bounded.** If the kickoff phrases the scope as "audit everything," push back via Dispatch and ask for a directory or subsystem. An unbounded audit produces a findings list nobody will action.

---

## Phase A1 — Scope (Argos)

**Executed by:** Orchestrator (Argos).
**Reads:**
- The kickoff message (free-form scope description).
- `docs/planning/project-architecture.md` (baseline patterns).
- Relevant `skills/*.md` for the subsystems in scope — these encode the patterns A should treat as the established baseline.
- The existing tree under the proposed scope (`ls`, `find`, light `Grep`) to understand size.

**Writes:** `.argos/audits/<auditId>/audit-scope.md`. Use this template verbatim:

```markdown
# Audit Scope — <auditId>

**Date:** <ISO date>
**Kickoff line:** `Audit scope <auditId>` <verbatim free-form scope text from André>

## Scope

**Paths to walk:**
- `src/<subdirectory>/` (recurse)
- `src/<other path>` (single file or directory)

**Paths to ignore (within walk):**
- `src/<subdirectory>/__tests__/` (tests audited only structurally, not by content)
- `src/<subdirectory>/migrations/` (auto-generated; flagged by S not by A)
- `<any explicit exclusion>`

**Depth of recursion:** <unlimited | N levels | only top-level>

**Specific subsystems or layers in focus:** <e.g. "the route → handler → service → repository chain inside src/modules/auth", or "all preHandler hooks for rate-limiting consistency">

## Architectural concerns — the audit checklist

A walks the scope with these dimensions in mind (cite the skill / planning section that defines the baseline pattern):

- **Layering:** route → handler → service → repository → entity. Does code respect the existing layer boundaries? — `docs/planning/architecture.md §Layering`
- **Dependency direction:** low-level → high-level only; modules go through shared seams rather than reaching into each other. — `docs/planning/project-architecture.md §Module boundaries`
- **Naming and file structure:** new file/module/function names and directory placement match the cadence already in `src/`.
- **Pattern consistency:** error handling, Zod-schema location, route registration, MikroORM repository usage solved one way across the codebase.
- **Cross-cutting concerns:** logging, error handling, validation, transaction boundaries consistent with the rest of the codebase.
- **Abstraction level:** code at the same abstraction altitude as its neighbors; over- and under-abstraction both count as drift.

(Add or trim items based on the scope. For an auth-subsystem audit, expand layering and dependency direction. For a routes-only audit, expand pattern consistency.)

## Acceptance criteria for `findings.md`

- Each finding has: `#`, `severity` (`block` | `warn`), `file:line`, `drift dimension`, `finding` (1–3 sentences), `suggested remediation`, `estimated story size` (XS <1 hr / S 1–4 hr / M half-day / L full day+).
- Findings prioritized by severity then by leverage (a single root cause that fans out to multiple files ranks higher than a one-off nit).
- Themes section groups findings that share a root cause — these turn into single decomposed stories.
- No PASS/BLOCK verdict on the file itself. The list is the result.
- "Out of scope but noticed" section captures things outside the walk worth a future audit.

## Notes for the reviewer

<Any context A needs to interpret the scope correctly. Example: "Treat src/modules/auth/legacy/ as deprecated — flag dependencies on it as warn rather than block.">
```

**Side effects:**
- Argos does **not** cut a branch. The audit loop produces no code; no branch is needed.
- Argos commits `audit-scope.md` on `main` (or on a dedicated `audits/` branch if `main` is protected).

**Next trigger:** Argos spawns the Architecture Reviewer in audit mode (Phase A2).

---

## Phase A2 — Audit (Architecture Reviewer, audit mode)

**Executed by:** Architecture Reviewer (A) — same agent file as the implement loop's review-mode A (`.claude/agents/architecture-reviewer.md`), spawned via the Task tool with `subagent_type: architecture-reviewer`. The **mode is determined by the input artifact**: handing A `audit-scope.md` (and no diff) puts it in audit mode.

**Argos spawns A** with a prompt along these lines (paraphrase, not a literal incantation):

> "Audit mode. Read `.argos/audits/<auditId>/audit-scope.md` and walk the scoped subtree. Apply the checklist of architectural concerns. Write a numbered, prioritized findings list to `.argos/audits/<auditId>/findings.md`. Use severity levels `block` and `warn`, but understand that this is a survey of existing code, not a verdict on a diff — there is no PASS/BLOCK. Exit when the file is written."

**A reads:**
1. `.argos/audits/<auditId>/audit-scope.md` — its charter.
2. Every file under the scope, prioritizing entry points (routes, top-level module files) first.
3. Neighboring files outside the scope when needed to evidence the established pattern (a finding "this module diverges from the convention" needs the convention as evidence).
4. `docs/planning/project-architecture.md` and any skills the scope file cites.

**A writes:** `.argos/audits/<auditId>/findings.md`. The template lives in `.claude/agents/architecture-reviewer.md §Mode 2 — Audit mode`. Headline shape:

```markdown
# Architecture audit — <auditId>

**Reviewer:** architecture-reviewer (Claude Opus 4.7) — audit mode
**Date:** <ISO date>
**Scope:** <one-line summary of audit-scope.md>
**Files examined:** <count>
**Patterns baseline:** <list of skill/planning docs that informed the baseline>

## Summary

<3–5 sentences. Headline themes — what kind of drift dominates this scope, and where the highest-leverage fixes are.>

## Findings

| # | Severity | File:line | Drift dimension | Finding | Suggested remediation | Estimated story size |
|---|---|---|---|---|---|---|
| 1 | block | `src/modules/auth/service.ts:120` | layering | Direct DB call from service bypasses repository layer | Move query to `AuthRepository`; service depends on repo, not Mikro EntityManager | S |
| 2 | warn  | `src/modules/dashboard/routes.ts:45` | naming | `setupRoutes` vs codebase convention `register<Module>Routes` | Rename to `registerDashboardRoutes` | XS |

## Themes

<Group findings by theme. "Three layering violations in the auth subsystem all stem from <root cause>." This is where decomposition gets its leverage — themes turn into single stories that fix multiple findings at once.>

## Out of scope but noticed

<Anything that fell outside the scope file but is worth flagging for a future audit. Do not put fix-it suggestions here; just note "X looked off, recommend a separate audit of Y.">

## Files examined

<List the files A read in full (not just grep'd). Argos uses this to estimate the audit's coverage when writing decomposition.>
```

**No verdict.** Audit mode produces findings; the next phase (decomposition) acts on them.

**Termination:** A's subprocess exits. Argos's `wait()` returns.

**Failure modes:**
- A returns malformed `findings.md` (e.g. missing the table, no severity column) → Argos writes `escalation.md` quoting the malformed output, pauses, surfaces to André via Dispatch.
- A hangs past the per-spawn timeout (audit-mode budget = 30 min; longer than review-mode because A walks a larger surface) → Argos kills the subprocess, writes `timeout-architecture-reviewer.md`, pauses.

---

## Phase A3 — Decompose (Argos)

**Executed by:** Orchestrator (Argos).

**Trigger:** A exited; `.argos/audits/<auditId>/findings.md` exists and is well-formed.

**Reads:**
- `findings.md` from Phase A2.
- `docs/planning/tasks.md` — to align proposed stories with the existing backlog's naming and prioritization, and to avoid proposing a story for a finding that's already a backlog item.
- `docs/planning/gaps.md` — to avoid proposing stories that are already-open gaps awaiting human resolution.

**Writes:** `.argos/audits/<auditId>/decomposition.md`. For each finding worth acting on, one entry shaped as an implement-loop story brief.

```markdown
# Decomposition — <auditId>

**Date:** <ISO date>
**Source:** `.argos/audits/<auditId>/findings.md`
**Findings input:** <N>
**Stories proposed:** <M>
**Findings dropped or merged:** <K> (see Disposition table below)

## Disposition of findings

| Finding # | Disposition | Justification |
|---|---|---|
| 1 | → Story `<auditId>-S1` | Standalone block-severity layering violation; clean refactor scope. |
| 2 | merged into `<auditId>-S2` | Same root cause as #5 and #7 (naming-convention drift in auth subsystem). |
| 3 | dropped | Already tracked as `G-P1-014` in `gaps.md`; opening a story would duplicate. |
| 4 | dropped | `warn` severity, below threshold; not worth a story's overhead. |
| … | … | … |

## Proposed stories

For each story, the entry uses the implement-loop brief shape so the entry can be handed to Argos as the kickoff brief when André sends `Start story <storyId>`:

### Story `<auditId>-S1`: <short title>

**Source findings:** #<N> [, #<N>, …] from `findings.md`
**Severity carried over:** block | warn
**Estimated size:** XS | S | M | L

**Acceptance criteria:**
- <criterion 1, derived from the finding's "suggested remediation">
- <criterion 2 — e.g. an existing pattern is now used at the cited file:line>
- <criterion 3 — e.g. no regression in T1/T2 for routes touching the changed module>

**Files in scope:**
- `src/<path>` — primary edit
- `src/<adjacent path>` — likely follow-on edit

**Required skills:**
- `skills/<name>.md` — <one-line why this skill applies here>
- …

**Required planning sections:**
- `docs/planning/<file>.md §<section>` — <one-line why this section applies>

**Declared test tiers:**
- Unit: yes | no
- Integration: yes | no
- E2E: yes | no
- Page verification: T1 + (T2 *or* T2.5, per route's auth posture) + T3 if UI-touching

**Dependencies:**
- Blocks: <list other proposed stories or backlog items, or "none">
- Blocked by: <list other proposed stories or backlog items, or "none">

**Implementer notes:**
- <Any context F should have. Often: "this is a narrowly-scoped refactor; don't expand surface area.">

### Story `<auditId>-S2`: …

(repeat per proposed story)

## Out of scope but noticed (carried over from `findings.md`)

<Re-list any items A flagged as outside scope but worth a future audit. André may choose to spawn a separate audit-loop for them.>

## Next action (André, via Dispatch)

For each proposed story you want to act on, send Argos a kickoff line:

```
Start story <auditId>-S1
```

Argos will use this `decomposition.md` entry as the input to Phase 1 of the implement loop. **Argos does not auto-spawn implement loops from decomposition entries.** Three reasons: (1) Argos doesn't know the right ordering against `tasks.md` without your input, (2) you may reject some entries entirely, (3) auto-spawning would let an audit silently kick off a dozen stories.

You may also choose to drop a proposed story entirely (no kickoff), or to re-scope it before kicking off (edit the entry on `main`, commit, then kick off).
```

**Decisions Argos may make at decomposition time:**

- **Drop a finding** if it's a duplicate of an open `gaps.md` item, a `warn`-severity nit below the threshold for an entire story, or a known-deprecated module.
- **Merge findings into a single story** if they share a root cause (e.g. five layering violations in the same module become one refactor story).
- **Promote a `warn` to `block` priority** if a theme analysis reveals the warn is actually load-bearing for a block elsewhere.
- **Demote a `block` to `warn`** if the established pattern is itself inconsistent enough that the finding is more "preference" than "drift" — note this in the Disposition justification.

Each decision is briefly justified in the Disposition table.

**Side effects:**
- Argos commits `decomposition.md` on `main` (or the audits branch).
- No branch cut. No PR.

**Next trigger:** None. The audit loop ends. Argos returns to idle.

---

## Phase-by-phase summary

| Phase | Agent | Input | Output | Next trigger |
|---|---|---|---|---|
| A1 Scope | Argos (Orchestrator) | kickoff `Audit scope <auditId>` + planning + skills | `.argos/audits/<auditId>/audit-scope.md` | Spawn A in audit mode |
| A2 Audit | Architecture Reviewer (audit mode) | `audit-scope.md` + scoped tree | `.argos/audits/<auditId>/findings.md` | Subprocess exit → Phase A3 |
| A3 Decompose | Argos | `findings.md` + `tasks.md` + `gaps.md` | `.argos/audits/<auditId>/decomposition.md` | Loop ends; André may kick off implement loops |

The audit loop has no inner iteration — A produces findings once, Argos decomposes once. There is no F to iterate with, no T to gate on, no S to remediate against. If the audit needs a follow-up at a narrowed scope, that is a **new `<auditId>`** with a new `audit-scope.md` — not a re-entry to the existing loop.

---

## Handoff schema

| File | Writer | Reader(s) | When |
|---|---|---|---|
| `audit-scope.md` | Argos | A (audit mode) | Phase A1 |
| `findings.md` | A (audit mode) | Argos (decomposition), André (via Dispatch) | Phase A2 |
| `decomposition.md` | Argos | André (via Dispatch), and subsequent implement-loop Phase 1 invocations | Phase A3 |
| `escalation.md` | Argos | André (via Dispatch) | If A hangs, returns malformed findings, or the scope is unworkable |

---

## Linkage to the implement loop

The audit loop's `decomposition.md` is shaped so each entry can become the input to the implement loop's Phase 1. The implement loop runs as documented in `docs/orchestrator-workflows/implementstory.md`, with the decomposition entry as Phase 1's seed brief.

The two loops are **linked but not coupled**:
- The audit loop produces work; the implement loop ships it.
- André chooses which proposed stories to kick off and in what order against `tasks.md`.
- Argos does **not** spawn implement loops automatically from decomposition entries.

---

## Failure modes

| Condition | Action |
|---|---|
| Scope text is unbounded ("audit everything") | Argos surfaces to André via Dispatch; does not write `audit-scope.md` until the scope is narrowed. |
| `<auditId>` collides with an existing `.argos/audits/<auditId>/` | Surface to André; the existing directory is either an old audit (rename to allow the new one) or a re-kickoff (need explicit instruction). |
| A in audit mode returns malformed `findings.md` | Argos writes `escalation.md` quoting the malformed output. Dispatch surfaces to André. |
| A's audit-mode subprocess hangs past 30 min | Argos kills, writes `timeout-architecture-reviewer.md`, pauses. |
| `findings.md` has zero block-severity findings and all warns below threshold | Argos still writes a `decomposition.md` — short, marking all findings as "dropped: below threshold." Audit ends cleanly; no follow-on work. |
| `findings.md` has block findings but every one duplicates an existing `gaps.md` or `tasks.md` row | `decomposition.md` lists each duplicate in the Disposition table with the matching ID; no new stories proposed. |

The audit loop is meant to be small, fast, and inspectable. The artifact set is fixed at three files — anything else means a failure mode was hit.
