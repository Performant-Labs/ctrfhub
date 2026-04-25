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

## AntiGravity workspace readiness check

Run this once on each new AntiGravity workspace (Daedalus on the bare-metal Mac, Talos in the macOS VM, any future workspace) to confirm it's provisioned to handle CTRFHub feature-implementer / test-writer work. Re-run any time after a major OS / toolchain change.

**How to use:**

1. Open a fresh AntiGravity session in the workspace you want to verify.
2. Paste **the entire prompt block below** as your first message.
3. AntiGravity's Claude will execute the checks and produce a structured report.
4. Paste the report back into your Argos (orchestrator) session. Argos will reply with `READY` or with a list of what's blocking.

**The prompt** (paste everything between the `~~~prompt-start` / `~~~prompt-end` markers — those markers are just visual delimiters for copy-paste, they aren't part of the prompt):

~~~prompt-start
You are an AntiGravity workspace being onboarded to the CTRFHub project. Argos (the orchestrator session that André interacts with separately) needs to confirm you can perform feature-implementer and test-writer work on this codebase. Run the checklist below by executing the listed shell commands in your terminal. Capture each command's output. Don't skip any check; if a command isn't available, that itself is the result. When done, produce a single structured report (template at the end) that André will paste back to Argos.

## Checks

### 1. Repo clone present and current
- `ls -d ~/Projects/ctrfhub` — confirm the directory exists. If it doesn't, the clone hasn't happened yet; everything below is N/A.
- `git -C ~/Projects/ctrfhub status --short --branch` — should be clean and on `main`.
- `git -C ~/Projects/ctrfhub fetch origin --quiet && git -C ~/Projects/ctrfhub status -uno` — report whether local main is up-to-date with origin/main (or behind by N).
- `git -C ~/Projects/ctrfhub rev-parse --short HEAD` — capture the SHA.

### 2. git identity configured
- `git -C ~/Projects/ctrfhub config user.name`
- `git -C ~/Projects/ctrfhub config user.email`
Both must be set, and the email should match the GitHub account that owns the OAuth token (else pushes are rejected as authorless).

### 3. GitHub CLI authenticated with push access
- `gh auth status` — should report "Logged in to github.com" without errors.
- `gh api repos/Performant-Labs/ctrfhub --jq .permissions.push` — should print `true`.

### 4. Node.js + npm versions
- `node --version` — Node 22 LTS or higher.
- `npm --version` — npm 10 or higher.

### 5. Dependencies install cleanly
- `cd ~/Projects/ctrfhub && npm install` — report exit code and any warnings/errors. (First run on a new VM may take 1-3 min.)

### 6. Toolchain works end-to-end
- `cd ~/Projects/ctrfhub && npx tsc --noEmit` — must exit 0.
- `cd ~/Projects/ctrfhub && npm test` — must exit 0; report the `Test Files X passed (X)` / `Tests Y passed (Y)` summary line.

### 7. Skills + agents discovery
Confirm these files exist in the clone (each is essential context the implementer reads before writing code):
- `CLAUDE.md`, `agents.md`
- `.antigravity/agents/feature-implementer.md`, `test-writer.md`, `spec-enforcer.md`
- `.antigravity/workflows/implementstory.md`
- At least 14 files under `skills/`
- `docs/planning/` containing at least: `project-architecture.md`, `project-plan.md`, `architecture.md`, `product.md`, `database-design.md`, `tasks.md`, `gaps.md`

### 8. Argos scratchpad gitignored
- `cd ~/Projects/ctrfhub && git check-ignore .argos/` — should print `.argos/`. This confirms the briefs / handoffs you'll write to that directory don't leak into commits.

### 9. Browser harness (optional — only needed for T2.5 Authenticated State on auth-gated UI stories)
- `ls -l ~/.local/bin/browser-harness 2>/dev/null` — note whether present. If missing, that's fine for stories without auth-gated UI (CTRF-001 and most early stories); flag it so it can be set up before the first auth-gated UI verification story (DASH-001 onwards).

## Report format

Reply to André with this structured report. No narrative — Argos parses it directly:

```
### Workspace readiness report

**Workspace name (Daedalus / Talos / new):** _____
**Hostname:** <output of `hostname`>
**Date (UTC):** <output of `date -u +%Y-%m-%dT%H:%M:%SZ`>

| # | Check | Result | Notes |
|---|---|---|---|
| 1 | Repo clone present + current | PASS / FAIL / WARN | <short HEAD, ahead/behind status> |
| 2 | git identity configured | PASS / FAIL | <user.name + user.email> |
| 3 | gh CLI auth + push perms | PASS / FAIL | <authenticated user> |
| 4 | Node 22+ / npm 10+ | PASS / FAIL | <node v, npm v> |
| 5 | npm install clean | PASS / FAIL / WARN | <exit code, deprecation/warning summary> |
| 6 | tsc --noEmit + npm test | PASS / FAIL | <test files / tests passed counts> |
| 7 | Skills + agents files present | PASS / FAIL | <missing files if any> |
| 8 | .argos/ gitignored | PASS / FAIL | — |
| 9 | browser-harness present | PASS / WARN | <only WARN if missing> |

### Overall
**Verdict:** READY / NOT READY
**Blocking issues (if any):** ...
**Open questions for Argos (if any):** ...
```

Conventions:
- Any FAIL → verdict is NOT READY.
- WARN-only outcomes still permit READY but are surfaced.
- If a check raises a question (e.g., "should I install browser-harness now or wait?"), put it under "Open questions for Argos."
~~~prompt-end

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
