# Flow Guide — for André

You are the human in this multi-agent setup. Argos plans and gates; Daedalus and Talos build; PR-Agent reviews. **None of them talk to each other directly.** You are the only path between them. This file is your operational playbook — what to do at each step of a story's lifecycle, common phrases to use, decision points only you can resolve, and the gotchas this project has hit.

For the design of the multi-session workflow itself, see `docs/planning/project-architecture.md`. For Argos's operational state, see `ORCHESTRATOR_HANDOFF.md`. For per-role definitions, see `agents.md` + `.antigravity/agents/<role>.md`. This file is the *human's* perspective.

---

## Who does what

| Agent | Where | Does | Doesn't |
|---|---|---|---|
| **Argos** | Cowork (this conversation) | Plans stories, writes briefs, runs spec-audits, opens PRs, manages git ops via the bridge, updates `tasks.md` and `gaps.md` | Writes app code or tests; merges PRs; decides spec conflicts unilaterally |
| **Daedalus** | AntiGravity on the bare-metal Mac | Implements features, writes tests, runs Tier 1/2/2.5 verification on its workspace | Plans stories; writes briefs; opens PRs; merges PRs |
| **Talos** | AntiGravity in the macOS VM | Same as Daedalus, in parallel on a different story | Same as Daedalus |
| **PR-Agent** | GitHub Actions | Runs automated spec-enforcer review on PRs (advisory; not a merge gate) | Anything else |
| **You (André)** | Wherever | Relay between Argos and AntiGravity sessions; decide spec conflicts; assign stories to workspaces; click merge | Implementation work (let the agents do that) |

---

## Standard story lifecycle (the happy path)

```
Argos cuts branch + writes brief on story branch
            ↓ [you copy the assignment line]
Daedalus or Talos: pulls, reads brief, implements + tests, writes feature-handoff
            ↓ [you tell Argos "story X has a feature-handoff"]
Argos: reads feature-handoff, runs spec-audit, writes verdict to story branch
            ↓ [you tell Argos "the spec audit is ready"]
Argos: PASS? → close-out + open PR    BLOCK? → write remediation note
            ↓ [PASS path: PR-Agent runs in CI; you click merge when satisfied]
Argos: post-merge sweep (delete branch, sync main, suggest next story)
```

Most stories take ~3–6 of your interactions over a few hours. Spec-audit bounces (BLOCK verdict) add one more cycle.

---

## What you say at each step

Drop these into your Argos session verbatim — they trigger the right next move without thinking about it.

### Starting a fresh Argos session
> "Resume from where you left off."  
> *(Argos reads its memory + the latest state and reports the next action.)*

### After Argos has written a brief
Tell Daedalus or Talos directly in their AntiGravity session:
> "Pull `story/<taskId>` and follow `.argos/<taskId>/brief.md`."

If you reassign (e.g., Argos suggested Daedalus but Talos is freer):
> "Argos: Talos is taking `<taskId>` instead of Daedalus."

### After an implementer signals done (handoff exists)
> "<workspace> finished `<taskId>`. Spec audit ready in `.argos/<taskId>/`."  
> *or just:*  
> "Spec audit is ready in `story/<taskId>`."

Argos pulls the audit, reads it, decides PASS or BLOCK.

### After Argos says "verdict PASS, opening PR"
Open the PR in your browser, glance at the diff, decide if you trust it. Click **Squash and merge**.

Then in Argos:
> "Merged PR #<N>."  
> *(Argos sweeps the branch and reports next.)*

### After Argos says "verdict BLOCK, remediation pushed"
Tell the implementer:
> "Pull `story/<taskId>` and read `.argos/<taskId>/remediation.md`. Argos resolved the open questions; finish the fixes and let me know when you're done."

### When you want to assign a story
> "Write the brief for `<taskId>`."

If you have a workspace preference:
> "Write the brief for `<taskId>` and assign it to `<Daedalus|Talos>`."

If you want two in parallel:
> "Write briefs for `<taskA>` and `<taskB>` so they can run in parallel."

### When you spot a spec conflict or ambiguity
> "Argos: there's a conflict between `<docA>` and `<docB>` on `<thing>`. Which is authoritative?"

Argos checks the precedence rule (`product.md` > `architecture.md` > `project-plan.md`) and proposes a resolution. You confirm.

---

## Decisions only you can make

These never go to an agent — Argos will surface them to you and wait for your call.

### 1. Spec conflicts
Two docs say different things. Example from this project: `tasks.md` said HTMX response should be 200; `skills/better-auth-session-and-api-tokens.md` said 401. Argos asks, you decide which wins, the loser gets corrected as part of the remediation. Argos will give a recommendation; you can accept it or override.

### 2. Workspace assignment for a new story
Argos's brief includes a "You are <Daedalus|Talos>" line as a recommendation, but you're the actual relay — you decide who picks up. If both are free, follow Argos's recommendation. If one is busy, give it to the free one and just say "Argos: <other workspace> is taking it."

### 3. Whether to merge despite advisory warnings
PR-Agent's review is advisory now (the `pr-agent` status check was removed from the ruleset). When PR-Agent returns "Partially compliant" or other soft warnings, you decide if they're real issues or noise. If a warning sounds real, ask Argos to investigate. Otherwise, click merge.

### 4. Whether to keep going or stop for the night
Long sessions accumulate fatigue and meta-debt. If you're tired, "stop here for the night" is always a valid response. Argos won't be hurt.

### 5. Whether to undo / rewind / abort
If something feels wrong (a PR you wish you hadn't opened, a commit on the wrong branch, an edit you want to revert), tell Argos. Argos can rewind safely as long as you describe the desired end state. Force-pushes to `main` work but require Argos to disable the ruleset briefly — this is fine when intentional, but flag it in case you want to use a forward-only `git revert` instead.

---

## Common gotchas (things this project has hit)

### Branch state confusion
Argos's bridge (the script-drop protocol it uses to drive `git` on the Mac) sometimes leaves your working tree on a story branch instead of `main`. Symptom: `git status` shows you on a branch you didn't expect. Fix: `git checkout main && git pull`.

### Talos's VM working tree is independent
Talos lives in a macOS VM with its own filesystem. Files Argos writes to `~/Projects/ctrfhub/` on the bare-metal Mac don't appear in the VM. Briefs and handoffs travel via git (`.argos/` is now tracked, was originally gitignored). When in doubt: `git pull` on the VM side.

### `.argos/` files showing as "untracked"
`.argos/` is **tracked** as of PR #17. If `git status` shows `??` for files in `.argos/`, the workspace is on an old commit — `git pull origin main` to refresh, or check the ruleset wasn't reverted.

### Force-push to `main` blocked
The "Protect Main" ruleset has `non_fast_forward` enabled. Argos can disable it briefly for a rewind, then re-enable. It's a one-shot operation that requires your confirmation; not something to do casually.

### PR-Agent silently skipping
PR-Agent's GitHub Action wrapper used to skip `synchronize` events (every force-push got a misleading green check in ~30 s without a real review). Fixed via `pr_actions` in `.pr_agent.toml` (PR #13). If you ever bump the pinned `qodo-ai/pr-agent` SHA in `.github/workflows/pr-review.yml`, smoke-test by pushing a trivial commit to a test PR and confirming pr-agent posts a real ~3-min review (not a 6-second no-op). See `~/.auto-memory/pr_agent_synchronize_silent_skip.md` for full diagnostic.

### Spec-enforcer false positives on chore PRs
PR-Agent's review tries to match every PR against a `tasks.md` story. Pure chore PRs (docs, gitignore, CI config) don't tie to a story, so PR-Agent flags them "Not compliant" against unrelated tickets. The substance of the review is fine; the "Not compliant" label is just the model getting confused. Look at the actual findings, not the badge.

### Long Kimi-K2.6 wall times
PR-Agent's reviews are typically 2–4 minutes via Kimi K2.6 (default model). Sometimes Kimi has a slow hour and reviews take 7–8 minutes. Not actionable; just wait.

### Working tree edits disappearing on branch switch
If you make uncommitted edits and then Argos's bridge switches branches, the edits travel with you (untracked) or get stashed. Argos's bridges try to handle this defensively, but if you ever lose work, check `git stash list` and `git reflog`.

---

## Tooling shortcuts (zsh)

These help when you want to act independently of Argos.

```bash
# Pull latest main
cd ~/Projects/ctrfhub && git checkout main && git pull --ff-only

# Run an Argos local PR review (Opus 4.7, your OAuth, no token cost)
pr:review <PR-number>          # to stdout
pr:review <PR-number> --post   # post to PR

# Check PR-review setup is healthy
.antigravity/scripts/check-pr-review-readiness.sh

# Merge a PR from the CLI (squash-merge, conversation-resolved required by ruleset)
gh pr merge <PR-number> --squash --delete-branch

# Tail a workflow run
gh run watch <run-id>
```

The `pr:review` zsh function is set up via `~/.zshrc` per `DEVELOPER_SETUP.md` "Shell alias for a shorter command".

---

## When to update this file

Add a row under "Common gotchas" any time you hit something twice. The Argos session can also propose additions; tell it "add this to FLOW.md" and it'll write the chore PR.

This file is for *operational* gotchas — repeat-class issues you've personally hit. Big-picture changes go in `docs/planning/project-architecture.md` instead.

---

## Cross-references

- **`docs/planning/project-architecture.md`** — the workflow's design
- **`ORCHESTRATOR_HANDOFF.md`** — what Argos reads at session start
- **`agents.md`** — role definitions index
- **`AGENTS_README.md`** — agent-oriented overview
- **`HANDOFF.md`** — frozen Phase 1→2 snapshot (historical)
- **`DEVELOPER_SETUP.md`** — workspace prerequisites + readiness check + PR review workflow
- **`CLAUDE.md`** — entry point any agent in this repo reads
- **`~/.auto-memory/MEMORY.md`** — Argos's persistent memory across Cowork sessions
