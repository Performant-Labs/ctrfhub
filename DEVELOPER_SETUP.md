# Developer Setup

Prerequisites and one-time configuration for working on CTRFHub.

---

## Prerequisites

Install on your Mac (Homebrew for `gh`; Claude Code via Anthropic's installer):

```bash
brew install gh
# Claude Code: follow https://docs.anthropic.com/en/docs/claude-code
```

Authenticate both CLIs (one-time per machine):

```bash
gh auth login             # GitHub OAuth
claude auth login         # Claude Code OAuth (tokens stored in macOS Keychain)
```

---

## PR Review Workflow

Two review paths are available. They complement each other.

| Method | Where it runs | Model | Cost | When it fires |
|---|---|---|---|---|
| **PR-Agent (cloud)** | GitHub Actions `ubuntu-latest` | Kimi K2 (default) / Opus 4.6 (`high-stakes` label) | OpenRouter API (GH secret `OPENROUTER_API_KEY`) | Automatic on PR open / reopen / `ready_for_review` / **any push to the branch** (`synchronize`), or on `/review` comment |
| **Argos local review** | Your Mac terminal | `claude -p` (Opus 4.7 default) via your Claude Code OAuth session | None — uses your Claude Code subscription | **Manual** — you run it whenever you want a deeper read |

Argos local review is deliberately not automated. An earlier design ran it on a self-hosted GitHub Actions runner, but macOS Keychain tokens aren't reachable from a LaunchAgent, which would force fallback to `ANTHROPIC_API_KEY` and per-token charges on every PR push. The manual path keeps OAuth working and keeps the cost at zero. Use it on high-stakes PRs, when PR-Agent's cloud review is flaky, or when you want a second opinion.

### PR-Agent's auto-refresh-on-push behavior

Every push to an open PR (including force-pushes from amend + `--force-with-lease`) triggers a fresh PR-Agent review against the new HEAD. Two settings keep this cheap and quiet:

- `.github/workflows/pr-review.yml` → `concurrency.cancel-in-progress: true` — if you push three commits in a minute, only the last one actually completes a review; the earlier in-flight runs are cancelled before they bill.
- `.pr_agent.toml` → `persistent_comment = true` — PR-Agent updates the existing review comment instead of posting a new one. The PR stays readable; you don't accumulate N copies of the review across N pushes.

Combined, the steady-state cost is one review per PR (plus at most one per Spec-enforcer bounce) at ~$0.02–$0.05 on Kimi K2.6. Rapid iteration during authoring costs nothing extra.

If the auto-refresh ever misses a HEAD (e.g., the `synchronize` event is queued but the run doesn't fire), `/review` is still available as a manual trigger.

### Running an Argos review manually

From the repo root (where `CLAUDE.md` lives):

```bash
# Print review to stdout
.antigravity/scripts/pr-review.sh <PR-number>

# Print AND post as a GitHub PR comment
.antigravity/scripts/pr-review.sh <PR-number> --post
```

### Shell alias for a shorter command: `pr:review`

The repo ships a zsh aliases file that defines a `pr:review` function so you can invoke the review from any directory, not just the repo root. To enable it, add one line to your `~/.zshrc`:

```bash
echo 'source ~/Projects/ctrfhub/.antigravity/scripts/shell-aliases.sh' >> ~/.zshrc
source ~/.zshrc     # apply to the current shell
```

Now from anywhere:

```bash
pr:review 3                           # print review to stdout
pr:review 3 --post                    # post to PR
pr:review 3 --model claude-sonnet-4-6 # override model
```

The function enters the repo in a subshell before invoking `pr-review.sh`, so your current working directory is unchanged after the call returns.

**If your repo lives somewhere other than `~/Projects/ctrfhub`**, export a custom base path before sourcing the aliases file:

```bash
# in ~/.zshrc — put this BEFORE the `source …shell-aliases.sh` line
export CTRFHUB_DIR="$HOME/code/ctrfhub"
```

**Bash note.** `pr:review` is a zsh function. The colon in the name is a bash parse error, so `shell-aliases.sh` should only be sourced from zsh. If you're on bash and want the shortcut, either switch to zsh (macOS default since Catalina) or copy the function body into a bash-legal name in your `~/.bashrc` (e.g. `pr_review`).

### Model defaults

| Path | Default model | Config location | How to override |
|---|---|---|---|
| PR-Agent (cloud) | `openrouter/moonshotai/kimi-k2.6` | `.pr_agent.toml` → `[config] model` | Edit that line, or apply the `high-stakes` label to a PR for Opus 4.6 |
| Argos (local) | `claude-opus-4-7` | `pr-review.sh` → `ARGOS_MODEL` fallback | Per-call: `--model <name>` · Session-wide: `export ARGOS_MODEL=<name>` in your profile |

### Readiness check

```bash
cd ~/Projects/ctrfhub
.antigravity/scripts/check-pr-review-readiness.sh
```

Verifies: `.pr_agent.toml` present, PR-Agent workflow file present, `claude` and `gh` CLIs installed and authenticated, `pr-review.sh` executable, `shell-aliases.sh` present.

---

## GitHub Secrets

| Secret | Used by |
|---|---|
| `OPENROUTER_API_KEY` | PR-Agent cloud workflow |

`ANTHROPIC_API_KEY` is intentionally not stored anywhere — the Argos local path uses your OAuth session, not an API key.
