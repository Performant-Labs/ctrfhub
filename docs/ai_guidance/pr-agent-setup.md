# PR-Agent Setup Guide

How to wire up **Qodo PR-Agent** as the automated Spec-enforcer for CTRFHub pull requests.

## What this gives you

- Automated review on every `opened` / `reopened` / `ready_for_review` / `synchronize` PR event (~60 s after the last commit lands)
- On-demand actions via PR comments: `/review`, `/improve`, `/describe`, `/ask <question>`, `/update_changelog`
- Enforcement posture: **required status check, human can override** — configured via branch protection (below)
- Default model: **Kimi K2.6 Thinking via OpenRouter** (~$0.02–$0.03 per 200-line PR, near-Opus-4.6 quality)
- Fallback: **Opus 4.6 via OpenRouter** (engages automatically on rate-limit or provider error)
- Label-based model bump: add the `high-stakes` label to a PR to force Opus 4.6 as primary for that review
- Model-provider agnostic — swap Kimi for DeepSeek, Ollama, direct Anthropic, a local LiteLLM proxy, or anything else LiteLLM supports by changing one line in `.pr_agent.toml`

## Files produced

| File | Purpose |
|---|---|
| `CLAUDE.md` | Pointer document PR-Agent (and any other Claude-family agent) reads to understand project context, authoritative specs, and forbidden patterns |
| `.pr_agent.toml` | PR-Agent's primary config — model, prompt instructions (the Spec-enforcer role), output format |
| `.github/workflows/pr-review.yml` | GitHub Actions workflow — wires up the trigger, secrets, and label-based model routing |
| `docs/ai_guidance/pr-agent-setup.md` | This file |

## One-time setup

### 1. Create an OpenRouter API key

1. Sign in at <https://openrouter.ai>.
2. Create a key: <https://openrouter.ai/keys>.
3. Fund the key — $10 covers several hundred reviews at the default model.
4. Confirm current model IDs at <https://openrouter.ai/models>. Specifically verify that **Kimi K2.6 Thinking** is still reachable at `moonshotai/kimi-k2-thinking` — if the ID has drifted (e.g., `moonshotai/kimi-k2-0929`), update both `.pr_agent.toml` and `.github/workflows/pr-review.yml` accordingly.

### 2. Add repository secrets

GitHub → **Settings → Secrets and variables → Actions → New repository secret**:

| Name | Value |
|---|---|
| `OPENROUTER_API_KEY` | The key from step 1 |

That's the only secret required. `GITHUB_TOKEN` is provided automatically by GitHub Actions.

Optional, only if you later swap to a direct provider:

| Name | Used when |
|---|---|
| `ANTHROPIC_API_KEY` | Direct-Anthropic fallback instead of Opus 4.6 via OpenRouter |
| `DEEPSEEK_API_KEY` | Switching the default model to DeepSeek V3.2 direct |

### 3. Create the `high-stakes` label

Settings → Labels → **New label**:

- **Name:** `high-stakes`
- **Color:** red (`#d73a4a` works well)
- **Description:** "Force Opus 4.6 primary review. Apply to PRs touching auth, migrations, artifact storage, security headers, rate limiter, or public API contract."

### 4. Open a throwaway PR to confirm the workflow runs

- Branch off `main`, make a trivial change (README typo), push, open the PR.
- Within ~60–90 s you should see a review comment from `qodo-ai[bot]` (or `github-actions[bot]` depending on your app install). If nothing appears, check Actions → `PR-Agent Spec Review` for errors. Common first-run issues:
  - `OPENROUTER_API_KEY` missing or misspelled
  - Model ID drift — run `curl https://openrouter.ai/api/v1/models | jq '.data[] | select(.id | contains("kimi"))'` to see current Kimi IDs
  - PR-Agent action pinned to a tag that's moved — `qodo-ai/pr-agent@main` is what we use; pin to a specific SHA later once the workflow is stable

### 5. Configure branch protection

Settings → Branches → **Branch protection rules → Add rule** for `main`:

- ✅ Require a pull request before merging
- ✅ Require approvals: **1** (you can relax to 0 if you're solo and the AI review is your only review)
- ✅ Dismiss stale pull request approvals when new commits are pushed
- ✅ Require status checks to pass before merging
  - After the first workflow run, search for `pr-agent` and check it
- ✅ **Require conversations to be resolved before merging** — this is the mechanism that lets humans override: a flagged concern becomes a blocking conversation, you resolve it to merge
- ❌ Do **not** check "Do not allow bypassing the above settings" — that would remove override ability

This gives you: every PR gets reviewed by PR-Agent, each flagged concern creates a conversation thread, and you can merge only after all conversations are resolved (either because the code changed or because you explicitly resolved the thread).

## Daily use

### Automatic behavior

On any non-draft PR, PR-Agent posts a review within ~60 s of the last commit. Structure:

- **Verdict line** — `BLOCKING` / `NITS` / `CLEAN`
- **Summary of changes**
- **Spec-drift findings** — each one citing the skill file or spec section it derives from
- **Test-tier audit** — declared vs. present for unit / integration / e2e and T1 / T2 / T3 where applicable
- **Inline comments** — line-specific violations
- **Code suggestions** — only for drift remediation (per our `extra_instructions` config)

### Slash commands in PR comments

| Command | Effect |
|---|---|
| `/review` | Rerun the full review (useful after pushing fixes) |
| `/improve` | Code-suggestion pass only (no full review) |
| `/describe` | Rewrite the PR description based on the diff |
| `/ask <question>` | Ask a specific question about the diff |
| `/update_changelog` | Append relevant notes to the changelog |
| `/add_docs` | Suggest docstring additions |

### Cost monitoring

- Per-PR cost visible at <https://openrouter.ai/activity>.
- Expected range: $0.02–$0.05 per PR at the Kimi K2.6 default; $0.45–$0.70 per `high-stakes` PR at Opus 4.6.
- If monthly spend crosses $10 without an obvious cause (runaway loop, giant PRs, too many `high-stakes` labels), investigate. Usual suspect: a PR with 2000+ changed lines triggering repeated full reviews on every push — split it up.

## Failure modes and how to tune

### False positive (flags correct code as drift)

1. Respond in the PR with `/ask why did you flag <exact line>?` to see its reasoning.
2. If the cited skill is misread, either:
   - Sharpen the "Good example" / "Bad example" section of that skill so the rule is unambiguous.
   - Or clarify the "How to apply" section.
3. If the skill is right but this case is a legitimate exception, resolve the conversation and merge. Note the exception in `docs/ai_guidance/gaps.md` so it's on the radar for future skill refinement.

### False negative (misses a real drift)

1. Write a one-line addition to the relevant `skills/*.md` making the rule more explicit.
2. Optionally add the missed pattern to `CLAUDE.md`'s "Forbidden patterns" list so it becomes a fast-fail.
3. Open a test PR reproducing the missed pattern and confirm it gets flagged this time.

### Systematically noisy on a class of PR

Tune `.pr_agent.toml` → `[pr_reviewer]` → `extra_instructions`. Usually the fix is sharpening the BLOCKING vs. NIT distinction for that class.

### Review is slow or hits the 15-minute timeout

- Check diff size. PRs > 1500 changed lines benefit from splitting.
- If model-latency on OpenRouter spikes, switch `CONFIG.MODEL` env in the workflow to a direct-provider variant temporarily.

## Future: change the model with one edit

The workflow uses LiteLLM under the hood (via PR-Agent), which supports 100+ providers in a single interface. To change the default model, edit one line in `.pr_agent.toml`:

| Destination | `model =` value | Secret needed |
|---|---|---|
| Kimi K2.6 via OpenRouter (current default) | `openrouter/moonshotai/kimi-k2-thinking` | `OPENROUTER_API_KEY` |
| DeepSeek V3.2 direct | `deepseek/deepseek-chat` | `DEEPSEEK_API_KEY` |
| Anthropic Opus 4.6 direct | `anthropic/claude-opus-4-6` | `ANTHROPIC_API_KEY` |
| Local Ollama (requires self-hosted GHA runner) | `ollama/qwen3:72b-instruct` + set `OLLAMA_API_BASE=http://localhost:11434` | none (runner must reach the Ollama server) |
| Self-hosted LiteLLM proxy | `openai/<alias-in-proxy>` + set `OPENAI_API_BASE=https://your-proxy` | `OPENAI_API_KEY=<proxy-key>` |

No changes to `.github/workflows/pr-review.yml` are needed for a provider swap — the env vars in the workflow remain the same; only the model string in `.pr_agent.toml` changes. The high-stakes step can also be reconfigured independently.

## Graduation path

This setup (PR-Agent + OpenRouter) is the recommended starting point. Two reasons to graduate later:

1. **You want parallel sub-reviewers** (Spec-enforcer + Test-auditor + Security-reviewer, synthesized). Replace the PR-Agent step with a custom matrix workflow that runs three `claude` / `llm` invocations in parallel and posts one consolidated review. Much more engineering work, but unlocks the "Code Agent Orchestra" pattern.
2. **You need air-gapped / zero-egress review**. Add a self-hosted GHA runner on a machine that can reach only a local Ollama or vLLM instance. Change one model-id line in `.pr_agent.toml` and you're air-gapped. The GitHub Action itself still runs via GitHub's infrastructure — only the model traffic is local.

Neither is a one-way door from this config. Stay here as long as it works.
