# CHORE-LINT-001 — Orchestrator Pre-Flight Checklist

**For:** Argos (orchestrator) — run this before André kicks off the two agents.

## What Argos set up

1. **Two branches** pushed to GitHub, both from `0e85de9` (current main tip):
   - `chore/lint-001-qwen` → Hephaestus (Qwen3.6-27B via Roo Code on RunPod)
   - `chore/lint-001-opus` → Daedalus (Opus 4.6 via AntiGravity)

2. **Brief:** `.argos/CHORE-LINT-001/brief.md` — unchanged, same for both agents.

3. **Evaluation rubric:** `.argos/CHORE-LINT-001/head-to-head.md` — five weighted criteria, max 45 points.

## Please verify

- [ ] Both branches exist on GitHub and point to the same commit as `main`
- [ ] The brief is agent-neutral enough for both contestants (the "Owner: Hephaestus" line is cosmetic — does it matter?)
- [ ] The rubric criteria and weights are fair — no bias toward either model's strengths
- [ ] The workflow section in `brief.md` says branch name `chore/lint-001-eliminate-any-in-health-test` — each agent should use their assigned branch instead (`-qwen` / `-opus`). Flag if this could confuse them.
- [ ] Acceptance criteria are objective and binary (pass/fail), not subjective

## Potential issues to flag

1. The brief's "Workflow" section (line 148) hardcodes a branch name. Each agent needs to know to use their assigned branch instead. Should we update the brief, or tell each agent verbally?

2. The brief says "Owner: Hephaestus" and mentions Continue.dev. Daedalus might find this confusing. Worth scrubbing, or irrelevant?

3. The "Autonomy" rubric dimension (how many human interventions) — are we tracking this consistently for both agents? André should note intervention count for each.

## What André needs to do

For **Hephaestus** (Roo Code):
1. Switch local checkout to `chore/lint-001-qwen`
2. Open Roo Code, point it at the brief: "Read `.argos/CHORE-LINT-001/brief.md` and implement CHORE-LINT-001. Use branch `chore/lint-001-qwen`."
3. Note how many approvals / interventions needed

For **Daedalus** (AntiGravity):
1. Switch to `chore/lint-001-opus` (or have Daedalus do it)
2. Give same instruction: "Read `.argos/CHORE-LINT-001/brief.md` and implement CHORE-LINT-001. Use branch `chore/lint-001-opus`."
3. Note how many approvals / interventions needed

Both run in parallel — remote LLMs, no local resource conflict.

## When both are done

Tell Argos. Argos will:
1. `git diff main..chore/lint-001-qwen` and `git diff main..chore/lint-001-opus`
2. Score both against the rubric in `head-to-head.md`
3. Declare winner with reasoning
4. Winning branch gets the PR; losing branch gets deleted

---

*— Argos, 2026-04-30*
