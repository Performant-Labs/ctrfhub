# CHORE-LINT-001 — Head-to-Head: Qwen3.6-27B vs Opus 4.6

**Date:** 2026-04-30
**Setup by:** Argos (orchestrator)

## Purpose

Both agents receive the same brief (`brief.md` in this directory) and independently implement the fix on separate branches. Argos evaluates both diffs to determine which produced the better result.

## Contestants

| Agent | Model | IDE | Branch |
|---|---|---|---|
| **Hephaestus** | Qwen3.6-27B (bf16, vLLM on RunPod A100) | Roo Code | `chore/lint-001-qwen` |
| **Daedalus** | Claude Opus 4.6 (Anthropic API) | AntiGravity | `chore/lint-001-opus` |

## Rules

1. **Same brief.** Both agents read `.argos/CHORE-LINT-001/brief.md` — the task description is identical.
2. **Branch suffix.** Heph works on `chore/lint-001-qwen`, Daedalus on `chore/lint-001-opus`. Neither touches the other's branch.
3. **No peeking.** Neither agent should see the other's diff before completing their own work.
4. **Same acceptance bar.** Both must pass all four acceptance criteria from the brief: lint 0 warnings, typecheck clean, all tests pass, small diff.
5. **Human relay.** André gives each agent the brief and monitors. No inter-agent communication.

## Evaluation Rubric (Argos judges)

Argos reviews both diffs against these criteria, scored 1–5 each:

### 1. Correctness (weight: 3×)
- Does the module augmentation match the actual decoration signatures in `src/app.ts`?
- Are all 14 `as any` casts removed?
- Do `npm run lint`, `npm run typecheck`, and `npm test` all pass?
- No `eslint-disable` or `as unknown as X` workarounds?

### 2. Type Fidelity (weight: 2×)
- Are the augmented types precise (not widened to `string` or `unknown`)?
- Does the `BootState` type match the actual union from app.ts?
- Is the `MikroORM` import path correct for this project?

### 3. Minimality (weight: 2×)
- Is the diff small and focused (only the necessary changes)?
- No gratuitous reformatting, import reordering, or whitespace changes?
- No files touched outside scope?

### 4. Code Style (weight: 1×)
- Does the augmentation file follow project conventions (file naming, import style)?
- Is the placement of the `.d.ts` file sensible?
- Clean commit message per the brief's template?

### 5. Autonomy (weight: 1×)
- How many human interventions were needed?
- Did the agent handle ambiguity well or get stuck?
- How many tool-call round trips to complete?

## Scoring

Total = (Correctness × 3) + (Type Fidelity × 2) + (Minimality × 2) + (Code Style × 1) + (Autonomy × 1)

Max score: 45. Winner is the higher total. Ties broken by Minimality, then Autonomy.

## Execution Order

Both can run in parallel — Heph uses RunPod (remote), Daedalus uses Anthropic API (remote). André runs both IDE clients on the Mac simultaneously.

## Post-Evaluation

Argos will:
1. Diff both branches against main
2. Score each against the rubric
3. Declare a winner with reasoning
4. The winning branch gets the PR; the losing branch is deleted

---

*— Argos, 2026-04-30*
