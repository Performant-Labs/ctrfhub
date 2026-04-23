# Developer Setup

Prerequisites and one-time configuration for working on CTRFHub.

---

## Self-Hosted GitHub Actions Runner

The Argos Spec-enforcer PR review runs on a **self-hosted runner** on your local machine
(inside Tailscale). This runner must be running for the `argos-local-review` job to execute.

### Why tmux, not a LaunchAgent service

The runner must run **inside a user login session** to access macOS Keychain, where
`claude`'s OAuth tokens are stored. If you install it as a `launchd` service
(`./svc.sh install`), the LaunchAgent starts outside the login session — Keychain is
locked, `claude -p` fails with exit code 1, and no API key is required or desired.

**tmux keeps the runner alive in a background session while remaining inside your user
context**, so Keychain is accessible and `claude` works without needing `ANTHROPIC_API_KEY`.

### First-time setup

```bash
# 1. Register the runner (one-time — follow the URL from GitHub Settings → Actions → Runners)
cd ~/Projects/actions-runner
./config.sh --url https://github.com/Performant-Labs/ctrfhub --token <registration-token>
# When prompted for labels: tailscale,claude
# (self-hosted is added automatically)

# 2. Authenticate claude and gh (one-time per machine)
claude auth login
gh auth login

# 3. Start the runner in a persistent tmux session
tmux new-session -d -s gh-runner './run.sh'
```

### Starting the runner (after a reboot)

```bash
cd ~/Projects/actions-runner
tmux new-session -d -s gh-runner './run.sh'
```

Or add it to your shell login profile (`~/.zprofile`) to start automatically:

```zsh
# Auto-start GitHub Actions runner if not already running
if ! tmux has-session -t gh-runner 2>/dev/null; then
  (cd ~/Projects/actions-runner && tmux new-session -d -s gh-runner './run.sh')
fi
```

### Checking on the runner

```bash
tmux ls                   # confirm 'gh-runner' session is present
tmux attach -t gh-runner  # view live output
```

When you're done watching, **press `Ctrl-B D` to detach** — this leaves the session running in the background. Then you can safely close the terminal window.

> **Do not just close the terminal while attached** — detach first with `Ctrl-B D`, then close. Force-closing usually works but isn't guaranteed.

### Stopping the runner

```bash
tmux kill-session -t gh-runner
```

### Required labels

The workflow dispatches to runners tagged `[self-hosted, tailscale, claude]`.
Verify in **GitHub → repo → Settings → Actions → Runners** that all three labels
are present. To fix labels: click the runner name → Edit.

---

## PR Review Workflow

Two review methods fire automatically when a PR is opened or updated:

| Method | Runner | Model | Cost |
|---|---|---|---|
| **PR-Agent** (cloud) | `ubuntu-latest` | Kimi K2 (default) / Opus 4.6 (`high-stakes` label) | OpenRouter (`OPENROUTER_API_KEY` in GH secrets) |
| **Argos local review** | Self-hosted (this Mac) | `claude -p` via OAuth session | None — uses your Claude subscription |

### Running Argos review manually

From the repo root (where `CLAUDE.md` lives), in any normal terminal:

```bash
# Print review to stdout
.antigravity/scripts/pr-review.sh <PR-number>

# Print and post as a GitHub PR comment
.antigravity/scripts/pr-review.sh <PR-number> --post
```

This works in an interactive terminal session because Keychain is accessible.
OAuth tokens are used — no API key needed.

### Readiness check

```bash
cd /Users/andreangelantoni/Projects/ctrfhub
.antigravity/scripts/check-pr-review-readiness.sh
```

---

## GitHub Secrets Required

| Secret | Used by |
|---|---|
| `OPENROUTER_API_KEY` | PR-Agent cloud job (Kimi K2 / Opus 4.6 via OpenRouter) |

`ANTHROPIC_API_KEY` is **not** stored in GitHub secrets — Argos uses the local
OAuth session on the self-hosted runner instead.

---

## Tailscale

All machines (MacBook runner + any future CI nodes) are on the same Tailscale network.
Ensure Tailscale is connected before the runner processes PRs.

```bash
tailscale status   # confirm 'Running'
```
