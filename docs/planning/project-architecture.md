# CTRFHub — Project Architecture

> How the multi-session, human-in-the-loop agent workflow is designed to work. This is the shared reference between André and any agent working on CTRFHub. Every architectural piece is listed in the checklist at the bottom; as each is completed it moves from ⬜ to ✅.

---

## 1. Intent

CTRFHub is built by a team of **specialized Claude agents** coordinated across **separate sessions** by a human operator (André). There is no autonomous agent-to-agent dispatch. André verifies every handoff and every PR. Each session:

1. Loads its role file
2. Reads the inputs André provides (brief, handoff note, etc.)
3. Produces its outputs (code, tests, audit report, etc.)
4. Ends

The next session starts fresh with its own inputs. The filesystem is the memory.

The trade-off is real: manual relay is slower than autonomous dispatch, but every step is inspected by a human who can stop a drift before it propagates. André is the gate.

---

## 2. Actors

| Name (Codename) | Role | Model | Reads (per session) | Writes |
|---|---|---|---|---|
| **André** | Human operator, PR reviewer, gap arbiter | — | Everything | Merges, gap decisions, escalation responses |
| **Argos** | Orchestrator — assigns, gates, never codes | Opus 4.7 | `ORCHESTRATOR_HANDOFF.md`, `docs/planning/tasks.md`, `docs/planning/gaps.md`, relevant planning sections | Task Briefs, `tasks.md` status transitions, session notes |
| **Feature-implementer** | Writes application code | Opus 4.7 | Task Brief, required skills, planning docs named in brief | Code in `src/`, migrations, commits on story branch, feature-handoff note |
| **Test-writer** | Runs T1/T2/T3, writes tests | Opus 4.7 | Feature handoff, `test-writer.md`, `page-verification-hierarchy.md`, `vitest-three-layer-testing.md` | Test files in `src/__tests__/` and `e2e/`, commits on story branch, tier reports, test-handoff note |
| **Spec-enforcer** | Read-only audit | Opus 4.7 (Opus 4.6 on `high-stakes` label) | Diff vs `main`, all `skills/`, `docs/planning/*` | PASS/BLOCK audit report only |
| **PR-Agent (cloud)** | Automated PR review | Kimi K2.6 default / Opus 4.6 on `high-stakes` | Diff, `CLAUDE.md`, `skills/`, `docs/planning/tasks.md` | PR comments, inline review |
| **Human reviewer** | Final merge gate | — (André again) | PR diff, PR-Agent findings, handoff notes | Merge / bounce |

---

## 3. Session flow for a single story

```
 André      Argos         Feature-impl     Test-writer      Spec-enforcer      PR-Agent      André (reviewer)
   │           │                │                │                  │               │                │
   │ assign ─►│ reads tasks,    │                │                  │               │                │
   │          │ writes Brief,   │                │                  │               │                │
   │          │ flips [ ]→[/]   │                │                  │               │                │
   │ ◄────────│ "brief at X"    │                │                  │               │                │
   │                            │                │                  │               │                │
   │ ─ opens new session ─────►│ reads brief,    │                  │               │                │
   │                            │ creates branch, │                  │               │                │
   │                            │ writes code,    │                  │               │                │
   │                            │ commits, writes │                  │               │                │
   │                            │ feature-handoff │                  │               │                │
   │ ◄──────────────────────────│ "ready for T1"  │                  │               │                │
   │                                             │                  │               │                │
   │ ─ opens new session ───────────────────────►│ runs T1, T2,      │               │                │
   │                                             │ writes tests,     │               │                │
   │                                             │ runs T3 if UI,    │               │                │
   │                                             │ commits, writes   │               │                │
   │                                             │ test-handoff      │               │                │
   │ ◄───────────────────────────────────────────│ "tiers green"     │               │                │
   │                                                                 │               │                │
   │ ─ opens new session ──────────────────────────────────────────►│ audits diff,   │                │
   │                                                                 │ writes PASS/   │                │
   │                                                                 │ BLOCK report  │                │
   │ ◄───────────────────────────────────────────────────────────────│ "verdict"      │                │
   │                                                                                                   │
   │ (if PASS) opens Argos session ─► flips [/]→[x] on story branch, names next stories               │
   │                                                                                                   │
   │ gh pr create ──────────────────────────────────────────────────────────────────►│ review on open │
   │                                                                                 │ (or /review)   │
   │ ◄───────────────────────────────────────────────────────────────────────────────│ comments posted│
   │                                                                                                   │
   │ ─ review diff + PR-Agent + handoffs, either merge or bounce ────────────────────────────────────►│
   │                                                                                                   │
   │ (merge lands [x] flip on main along with the story)                                              │
```

Key property: every arrow that crosses a role boundary is a **new session** opened by André, who has decided the previous step is complete.

---

## 4. Session playbook

Each subsection describes one session type. Entry = what André pastes. Reads = what the agent needs to pull in on top of auto-loaded CLAUDE.md. Produces = the artifacts the agent creates. Exit = the short status message the agent ends with.

### 4.1 Argos — story assignment

- **Entry.** André opens a session in the ctrfhub repo. Claude Code auto-loads `CLAUDE.md`, which directs Argos to read `ORCHESTRATOR_HANDOFF.md`. André says "Assign `<taskId>`" (e.g. "Assign INFRA-001").
- **Reads.** `ORCHESTRATOR_HANDOFF.md`, the `<taskId>` section of `docs/planning/tasks.md`, `docs/planning/gaps.md` (for P0 check), the planning doc sections named in the acceptance criteria.
- **Produces.**
  - A branch `story/<taskId>` cut from current `main`.
  - A Task Brief at `.argos/<taskId>/brief.md` (gitignored — does not commit).
  - A commit on `story/<taskId>` that flips `<taskId>` from `[ ]` to `[/]` in `tasks.md`, message: `chore(<taskId>): assign`.
  - A short summary message back to André: "Branch `story/<taskId>` cut, status flipped to `[/]`. Brief at `.argos/<taskId>/brief.md`. Open a new session, paste `feature-implementer.md` as the first message, then the Brief."
- **Exit.** Above message.

### 4.2 Feature-implementer — implementation

- **Entry.** New session. First message: full contents of `.antigravity/agents/feature-implementer.md`. Second message: contents of `.argos/<taskId>/brief.md`. André has already checked out `story/<taskId>` (Argos cut it at 4.1).
- **Reads.** All `skills/` listed in the Brief; all `docs/planning/` sections listed in the Brief.
- **Produces.**
  - One or more commits on `story/<taskId>`, messages `feat(<taskId>): …` / `refactor(<taskId>): …` / `fix(<taskId>): …`.
  - A feature-handoff note at `.argos/<taskId>/feature-handoff.md` covering: what was built, commands run (migrations, dev server start), any decision not specified in planning docs.
- **Exit.** "Implementation on `story/<taskId>`. Handoff at `.argos/<taskId>/feature-handoff.md`. Next: Test-writer."

### 4.3 Test-writer — verification + tests

- **Entry.** New session. First message: `.antigravity/agents/test-writer.md`. Second message: `.argos/<taskId>/feature-handoff.md`.
- **Reads.** `skills/page-verification-hierarchy.md`, `skills/vitest-three-layer-testing.md`, planning docs from the Brief, all skills touched by the diff.
- **Produces (in order, gated per skill):**
  1. `.argos/<taskId>/tier-1-report.md` — T1 Headless (Fastify inject / curl) outputs.
  2. `.argos/<taskId>/tier-2-report.md` — T2 ARIA structural assertions. **Required before T3.**
  3. Unit / integration / E2E test files per the story's declared tiers, committed to `story/<taskId>`.
  4. `.argos/<taskId>/tier-3-report.md` + `screenshots/` — T3 visual (UI stories only).
  5. `.argos/<taskId>/test-handoff.md` — summary.
- **Exit.** "All tiers green. Handoff at `.argos/<taskId>/test-handoff.md`. Next: Spec-enforcer."

### 4.4 Spec-enforcer — audit

- **Entry.** New session. First message: `.antigravity/agents/spec-enforcer.md`. Second message: `.argos/<taskId>/test-handoff.md`.
- **Reads.** Diff of `story/<taskId>` vs `main`, all `skills/`, `docs/planning/*`.
- **Produces.** `.argos/<taskId>/spec-audit.md` — PASS or BLOCK with findings. **No other writes.**
- **Exit.** "Verdict: PASS" or "Verdict: BLOCK — see `.argos/<taskId>/spec-audit.md`."

### 4.5 André opens the PR

- `gh pr create --base main --head story/<taskId> --title "[<taskId>] <summary>" --body-file .argos/<taskId>/pr-body.md`
- PR template prefills the body; André fills in from the handoff notes.

### 4.6 PR-Agent cloud review

- Fires on PR open via `.github/workflows/pr-review.yml`.
- Default model Kimi K2.6. Apply `high-stakes` label to route to Opus 4.6 for auth / migration / security diffs.

### 4.7 André reviews and merges

- Reads PR diff + PR-Agent comments + `.argos/<taskId>/` handoffs.
- Outcomes:
  - **Merge** (squash). Story branch auto-deletes.
  - **Bounce to Feature-implementer** with remediation (`high-stakes` label if structural).
  - **Bounce to Test-writer** if T-tier gaps found.

### 4.8 Argos closes the story (runs before 4.5, not after)

Because the status flip ships with the PR, Argos runs **between Spec-enforcer PASS and `gh pr create`**:

- New Argos session. Checks out `story/<taskId>` locally.
- Reads `.argos/<taskId>/spec-audit.md` — verifies PASS.
- Commits `[/]` → `[x]` in `tasks.md` on the story branch, message `chore(<taskId>): complete`. This is the last commit on the branch before the PR opens.
- Names the next assignable stories in the summary message back to André.

After PR merges to `main`, the `[x]` flip lands along with the story. No post-merge Argos pass is needed.

---

## 5. Artifact layout

```
ctrfhub/
├── .argos/                         ← GITIGNORED scratchpad (ephemeral per-story work)
│   └── <taskId>/
│       ├── brief.md                ← Argos writes at 4.1
│       ├── feature-handoff.md      ← Feature-implementer writes at 4.2
│       ├── tier-1-report.md        ← Test-writer writes at 4.3
│       ├── tier-2-report.md
│       ├── tier-3-report.md        (UI stories only)
│       ├── test-handoff.md
│       ├── spec-audit.md           ← Spec-enforcer writes at 4.4
│       ├── pr-body.md              ← André generates at 4.5 from handoffs
│       └── screenshots/            (UI stories only — T3 outputs)
```

**Lifecycle.** `.argos/` is gitignored. Files live on disk during the story. The PR description (preserved forever on GitHub) is the audit trail that survives merge. If a session crashes mid-story, the next session of the same role can pick up by re-reading the handoff notes.

---

## 6. Branch / commit / PR conventions

| Convention | Rule |
|---|---|
| **Branch name** | `story/<taskId>` — e.g. `story/INFRA-001` |
| **Commit prefix** | Conventional Commits with story ID: `feat(INFRA-001): …`, `test(INFRA-001): …`, `fix(INFRA-001): …` |
| **Who commits** | Feature-implementer commits application code. Test-writer commits tests. Argos commits `tasks.md` transitions **on the story branch**, so the status flip ships with the story in the merge. |
| **PR title** | `[<taskId>] <summary>` — e.g. `[INFRA-001] Project scaffold and toolchain` |
| **PR body** | Generated from `.argos/<taskId>/pr-body.md`. Must include: Story ID link, tier-completion checkboxes, one-line summary of each declared acceptance criterion, decisions-that-deviate-from-spec section |
| **Merge strategy** | Squash-merge. PR body becomes the merge commit message; `main` history stays readable |
| **Branch protection** | `main` requires: PR-Agent review passed, PR approved by André, "Require conversations to be resolved" |

---

## 7. State tracking

| State | Location | Writer | When |
|---|---|---|---|
| `[ ]` → `[/]` | `docs/planning/tasks.md` | Argos (on `story/<taskId>` branch) | At task assignment (4.1), first commit on the branch |
| `[/]` → `[x]` | `docs/planning/tasks.md` | Argos (on `story/<taskId>` branch, just before PR opens) | After all tiers pass + Spec-enforcer PASS, as the final commit before `gh pr create` |
| New gap | `docs/planning/gaps.md` | Argos or agent that spotted it | Anytime |
| P0 gap resolution | `docs/planning/gaps.md` | Argos after human sign-off | When André decides |
| Per-story work | `.argos/<taskId>/` | All roles | During story |
| Audit trail | PR description on GitHub | André | At PR open |

---

## 8. Escalation paths

| Trigger | Action |
|---|---|
| Any tier fails twice | Test-writer halts, writes a BLOCK report, Argos surfaces to André |
| Spec-enforcer returns BLOCK | Argos routes back to Feature-implementer with remediation; session 4.2 repeats from the top |
| Feature-implementer makes a decision not in planning docs | Flag in `feature-handoff.md`; Spec-enforcer evaluates; if unresolved, André decides |
| TypeScript errors at 4.2 handoff | Feature-implementer must resolve before Test-writer session starts |
| P0 gap blocks a story | Argos halts assignment, surfaces to André, waits for sign-off |
| Agents disagree on a rule | Precedence: `docs/planning/product.md` > `docs/planning/architecture.md` > `docs/planning/project-plan.md` > skills |
| André wants to intervene mid-story | André can edit files directly; next session of whichever role reads the new state from disk |

---

## 9. Architecture Checklist

Track the build of this system here. Each row is an atomic piece of the architecture. Update status as we complete each item.

| # | Piece | Tier | Status | Where it lives | Notes |
|---|---|---|---|---|---|
| 1 | Agent role docs | A | ✅ | `.antigravity/agents/*.md` | 4 files, one per role |
| 2 | Workflow docs | A | ✅ | `.antigravity/workflows/*.md` | `implementstory`, `verifystory`, `audit-tests` |
| 3 | Skills library | A | ✅ | `skills/*.md` | 14 skills; each cites its source |
| 4 | Task backlog with declared tiers | A | ✅ | `docs/planning/tasks.md` | 28 stories, all fields populated |
| 5 | Gap registry | A | ✅ | `docs/planning/gaps.md` | 4 P0, plus P1/P2 |
| 6 | `CLAUDE.md` project pointer | A | ✅ | `CLAUDE.md` | Auto-read by every session |
| 7 | **This architecture document** | A | ✅ | `docs/planning/project-architecture.md` | Where all the above get composed into a system |
| 8 | `.argos/` gitignored + directory conventions | A | ✅ | `.gitignore` + this doc §5 | `.argos/` added to `.gitignore` |
| 9 | Branch / commit / PR naming conventions | A | ✅ | This doc §6 | Documented; enforcement via PR template / hooks is in items 18 / 26 |
| 10 | `ORCHESTRATOR_HANDOFF.md` points at this doc | A | ✅ | `ORCHESTRATOR_HANDOFF.md` | "Workflow reference" note at top |
| 11 | `CLAUDE.md` references this doc in the reading order | A | ✅ | `CLAUDE.md` | Now item 1 under "Authoritative context" |
| 12 | Task Brief template | B | ✅ | `implementstory.md` §1.2 | Full brief template with preconditions, story, reading list, next-action |
| 13 | Feature-handoff template | B | ✅ | `feature-implementer.md` §Feature-handoff template | Branch, commits, what-was-built, commands, decisions, next-action |
| 14 | Tier-report templates (T1/T2/T3) | B | ✅ | `test-writer.md` §Tier 1/2/3 report templates | Three tables, backdrop-contrast gate baked into T2 |
| 15 | Test-handoff template | B | ✅ | `test-writer.md` §Test-handoff template | Tier summary, tests added, coverage, next-action |
| 16 | Spec-audit template | B | ✅ | `spec-enforcer.md` §Spec-audit template | Findings / Coverage / Conformance / Forbidden-pattern / Verdict |
| 17 | PR body template (`.argos/<taskId>/pr-body.md`) | B | ✅ | `implementstory.md` §Phase 8 | Acceptance checkboxes, tier results, deviations, gaps, next-stories |
| 18 | GitHub PR template | B | ✅ | `.github/pull_request_template.md` | Structurally aligned with the Phase 8 template; overridden by `--body-file` when Argos opens the PR |
| 19 | `high-stakes` GitHub label | B | ✅ | GitHub repo (applied via `gh` over the bridge) | Color `#B60205`, description routes PR-Agent to Opus 4.6 |
| 20 | Branch protection on `main` | B | ✅ | GitHub ruleset "Protect Main" (id 15490272) | Enforces: no deletion, no force-push, conversations resolved, `pr-agent` status check green, squash-only. Required to flip repo to public (2026-04-24) to unlock rulesets on GitHub Free. |
| 21 | PR-Agent cloud review | B | ✅ | `.github/workflows/pr-review.yml` | Confirmed working |
| 22 | Claude bridge | B | ✅ | `~/Sites/ai_guidance/agent/claude-bridge.sh` | Host-side command execution |
| 23 | `tasks.md` transition protocol (single-line rule) | B | ⬜ | This doc §7 | Already described; no extra wiring needed |
| 24 | Session-resume convention | C | ⬜ | Short section in each role file | "Re-read .argos/<taskId>/ files on resume" |
| 25 | Optional `STATE.md` observability file | C | ⬜ | Repo root, gitignored | Running log of in-flight stories |
| 26 | Commit-msg hook validating story ID | C | ⬜ | `.husky/commit-msg` or similar | Cheap drift insurance |
| 27 | Self-hosted runner + Tailscale (local `claude -p` review path) | D | ⬜ | GitHub Settings + `.antigravity/scripts/pr-review.sh` | Optional; cloud path already works |
| 28 | CI workflow for unit / integration / E2E tests | D | ⬜ | `.github/workflows/ci.yml` | Story CI-001 in the backlog |
| 29 | Dog-food CTRF loop (CI runs CTRF reports back into CTRFHub) | D | ⬜ | CI workflow additions | Blocked on CTRFHub being alive |
| 30 | Self-hosted deployment for CTRFHub staging (for dog-food) | D | ⬜ | Infra not yet chosen | Deferred |

**Legend.** ✅ = done. ⬜ = not yet. 🟡 = in progress.

**Tier legend.**
- **A** — blocks any story kickoff. Must be ✅ before INFRA-001 can begin.
- **B** — blocks the first PR from cleanly merging.
- **C** — quality of life; build as needed.
- **D** — parallel or deferred; grows alongside implementation.

---

## 10. What "done" looks like for the architecture

Tier A is fully ✅. Tier B is fully ✅. At that point the workflow is operational end-to-end and André can run `/implementstory INFRA-001` (by opening an Argos session and saying "Assign INFRA-001"), relay through the sessions, open the PR, merge, and mark the story done — without ambiguity at any step.

Tier C and D grow as needed, without blocking forward motion.
