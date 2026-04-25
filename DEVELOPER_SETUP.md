# Developer Setup

Prerequisites and one-time configuration for working on CTRFHub. Two flavors of workspace are supported:

- **Bare-metal Mac** — your daily-driver machine where you run `git`, `gh`, the Argos orchestrator session, and one AntiGravity instance (Daedalus).
- **macOS VM** — a second AntiGravity instance (Talos), set up so two stories can run in parallel without sharing a working tree (the parallel-session collision class — see `CLAUDE.md` "Agent names").

Most of the setup below is identical between the two; differences are called out where they matter.

---

## Prerequisites

Install on each machine (bare-metal Mac and any VM you spin up):

```bash
# Homebrew if it isn't already there — https://brew.sh
brew install gh
# Claude Code: follow https://docs.anthropic.com/en/docs/claude-code
```

**On a fresh macOS VM specifically:** Homebrew installs to `/opt/homebrew/bin` (Apple Silicon) but doesn't always add itself to your shell's PATH. If `which gh` returns nothing after `brew install gh`, add this line to `~/.zshrc` and re-source:

```bash
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zshrc
source ~/.zshrc
```

This single line puts `node`, `npm`, `gh`, and `npx` on PATH. Skipping it forces every command (yours and the AntiGravity Claude's) to be prefixed with `PATH="/opt/homebrew/bin:$PATH"`, which is brittle and easy to forget.

Authenticate both CLIs (one-time per machine):

```bash
gh auth login             # GitHub OAuth — must have push access to Performant-Labs/ctrfhub
claude auth login         # Claude Code OAuth (tokens stored in macOS Keychain)
```

The bare-metal Mac authenticates `claude` for the local Argos PR-review path. VMs running Talos don't strictly need `claude` (the AntiGravity instance has its own model bundled), but installing it there keeps both workspaces symmetric.

---

## AntiGravity workspace readiness check

Run this once on each new AntiGravity workspace (Daedalus on the bare-metal Mac, Talos in the macOS VM, any future workspace) to confirm it's provisioned to handle CTRFHub feature-implementer / test-writer work. Re-run any time after a major OS / toolchain change or when something feels off.

**How to use:**

1. Open a fresh AntiGravity session in the workspace you want to verify.
2. Paste **the entire prompt block below** as your first message.
3. AntiGravity's Claude will execute the checks and produce a structured report.
4. Paste the report back into your Argos (orchestrator) session. Argos identifies the workspace from the report's identifiers (you don't have to tell it which one) and replies with `READY` or with a list of what's blocking.

**The prompt** (paste everything between the `~~~prompt-start` / `~~~prompt-end` markers — those markers are just visual delimiters for copy-paste, they aren't part of the prompt):

~~~prompt-start
You are an AntiGravity workspace being onboarded to the CTRFHub project. Argos (the orchestrator session that André interacts with separately) needs to confirm you can perform feature-implementer and test-writer work on this codebase. Run the checklist below by executing the listed shell commands in your terminal. Capture each command's output. Don't skip any check; if a command isn't available, that itself is the result. When done, produce a single structured report (template at the end) that André will paste back to Argos.

## Workspace identification (do not skip)

Before the checks themselves, gather these identifiers so Argos can tell which workspace this is. **Don't try to guess your workspace name** (Daedalus / Talos / etc) — Argos infers it from these facts:

- `hostname`
- `whoami`
- `gh api user --jq .login 2>/dev/null` — gh-authenticated GitHub login
- `git -C ~/Projects/ctrfhub log -1 --format='%ae'` — email on the most recent commit (proxy for git identity)
- `date -u +%Y-%m-%dT%H:%M:%SZ` — timestamp

## PATH setup (do not skip)

If `node`, `npm`, `gh`, or `npx` aren't in your default PATH, every check below will fail spuriously. **Before running the checks**, try `which node` and `which gh`:

- If both resolve, you're fine.
- If either is missing, search the standard locations (`/opt/homebrew/bin`, `/usr/local/bin`, `~/.nvm/versions/node/*/bin`, `~/.volta/bin`) and prepend whichever is found to PATH for this session.
- **Whether or not you needed a PATH override, say so in the report** under "PATH overrides used" — Argos uses this to recommend a permanent `~/.zshrc` fix (commonly: `eval "$(/opt/homebrew/bin/brew shellenv)"`).

## Checks

### 1. Repo clone present and current
- `ls -d ~/Projects/ctrfhub` — confirm the directory exists. If it doesn't, the clone hasn't happened yet; everything below is N/A.
- `git -C ~/Projects/ctrfhub status --short --branch` — should be clean and on `main`. **List any untracked files** (`??` lines) — they need disposition (gitignore? rescue to a branch? delete?).
- `git -C ~/Projects/ctrfhub fetch origin --quiet && git -C ~/Projects/ctrfhub status -uno` — report whether local main is up-to-date with `origin/main` (or behind by N).
- `git -C ~/Projects/ctrfhub rev-parse --short HEAD` — capture the SHA.

### 2. git identity resolves
- `git -C ~/Projects/ctrfhub config user.name`
- `git -C ~/Projects/ctrfhub config user.email`
- If either is empty, fall back to: `git -C ~/Projects/ctrfhub log -1 --format='%ae %an'` — if past commits show the right author, identity resolves via credential helper (e.g., osxkeychain) and pushes will work.

**PASS** if either explicit gitconfig OR credential helper provides a working identity. **FAIL** only if no identity surfaces from either path.

### 3. GitHub CLI authenticated with push access
- `gh auth status` — should report "Logged in to github.com" without errors.
- `gh api repos/Performant-Labs/ctrfhub --jq .permissions.push` — should print `true`.

### 4. Node.js + npm versions
- `node --version` — Node 22 LTS or higher.
- `npm --version` — npm 10 or higher.

### 5. Dependencies install cleanly
- `cd ~/Projects/ctrfhub && npm install` — report exit code and any warnings/errors. (First run on a fresh workspace may take 1-3 min.)

### 6. Toolchain works end-to-end
- `cd ~/Projects/ctrfhub && npx tsc --noEmit` — must exit 0.
- `cd ~/Projects/ctrfhub && npm test` — must exit 0; report the `Test Files X passed (X)` / `Tests Y passed (Y)` summary line.

### 7. Skills + agents discovery
Confirm these files exist in the clone (each is essential context the implementer reads before writing code):

- `CLAUDE.md` (required)
- `agents.md` at repo root (referenced by CLAUDE.md and `.pr_agent.toml`; **known to currently be absent** — flag as WARN with note "known gap, see chore PR queue", not as FAIL)
- `.antigravity/agents/feature-implementer.md`, `test-writer.md`, `spec-enforcer.md`, `orchestrator.md`
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

**Identification (Argos uses these to determine which workspace this is):**
- Hostname: `<hostname>`
- User: `<whoami>`
- gh login: `<gh user>`
- Recent commit author email: `<email>`
- Date (UTC): `<timestamp>`

**Untracked files in ~/Projects/ctrfhub:** (list each, or "none")

**PATH overrides used:** (e.g., "PATH=/opt/homebrew/bin:$PATH for checks 3, 4, 5, 6", or "none")

| # | Check | Result | Notes |
|---|---|---|---|
| 1 | Repo clone present + current | PASS / FAIL / WARN | <short HEAD; ahead/behind status; untracked surfaced separately above> |
| 2 | git identity resolves | PASS / FAIL | <explicit gitconfig OR "via credential helper, last commit by X"> |
| 3 | gh CLI auth + push perms | PASS / FAIL | <authenticated user; permissions.push value> |
| 4 | Node 22+ / npm 10+ | PASS / FAIL | <node v, npm v> |
| 5 | npm install clean | PASS / FAIL / WARN | <exit code; deprecation/warning summary> |
| 6 | tsc --noEmit + npm test | PASS / FAIL | <test files / tests passed counts> |
| 7 | Skills + agents files present | PASS / FAIL / WARN | <missing files if any; agents.md missing → WARN "known gap"> |
| 8 | .argos/ gitignored | PASS / FAIL | — |
| 9 | browser-harness present | PASS / WARN | <only WARN if missing> |

### Overall
**Verdict:** READY / NOT READY
**Blocking issues (if any):** ...
**Open questions for Argos (if any):** ...
```

## Conventions

- Any **FAIL** → verdict is **NOT READY**.
- **WARN**-only outcomes still permit **READY** but are surfaced.
- A missing `agents.md` at repo root is a known gap (the per-role files at `.antigravity/agents/*.md` cover the same content); flag as WARN, not FAIL.
- If a check raises a question (e.g., "should I install browser-harness now or wait?"), put it under "Open questions for Argos."

## Common WARN remediations (apply to your workspace if relevant)

| WARN | Quick fix on the workspace |
|---|---|
| Homebrew binaries not in default PATH | Add to `~/.zshrc`: `eval "$(/opt/homebrew/bin/brew shellenv)"` then `source ~/.zshrc` |
| `git config user.name` / `user.email` empty (but past commits work) | Optional but recommended: `git config --global user.name "Your Name"` and `git config --global user.email "you@example.com"` — makes the implicit identity explicit |
| `agents.md` at repo root missing | Known gap — no workspace-side fix; Argos creates the file in a separate chore PR. Continue with the per-role files at `.antigravity/agents/*.md` |
| `browser-harness` missing | Defer until first auth-gated UI story (DASH-001 onwards). Install location: `~/.local/bin/browser-harness`. See `skills/page-verification-hierarchy.md §T2.5` for setup |
~~~prompt-end

---

## PR Review Workflow

Two review paths are available. They complement each other.

| Method | Where it runs | Model | Cost | When it fires |
|---|---|---|---|---|
| **PR-Agent (cloud)** | GitHub Actions `ubuntu-latest` | Kimi K2.6 (default) / Opus 4.6 (`high-stakes` label) | OpenRouter API (GH secret `OPENROUTER_API_KEY`) | Automatic on PR `opened` / `reopened` / `ready_for_review` / **any push to the branch** (`synchronize`), or on `/review` comment |
| **Argos local review** | Your Mac terminal | `claude -p` (Opus 4.7 default) via your Claude Code OAuth session | None — uses your Claude Code subscription | **Manual** — you run it whenever you want a deeper read |

Argos local review is deliberately not automated. An earlier design ran it on a self-hosted GitHub Actions runner, but macOS Keychain tokens aren't reachable from a LaunchAgent, which would force fallback to `ANTHROPIC_API_KEY` and per-token charges on every PR push. The manual path keeps OAuth working and keeps the cost at zero. Use it on high-stakes PRs, when PR-Agent's cloud review is flaky, or when you want a second opinion.

### PR-Agent's auto-refresh-on-push behavior

Every push to an open PR (including force-pushes from amend + `--force-with-lease`) triggers a fresh PR-Agent review against the new HEAD. **Three** settings make this work and keep it cheap:

- `.github/workflows/pr-review.yml` → `pull_request: types: [..., synchronize]` — GitHub Actions fires the workflow on every push.
- `.pr_agent.toml` → `[github_action_config] pr_actions = [..., "synchronize"]` — PR-Agent's Action wrapper *acts* on synchronize. **Without this, the workflow runs but pr-agent silently no-ops in ~6 seconds and posts no review** (the action's default `pr_actions` list omits `synchronize`; we explicitly add it). If you ever bump the pinned `qodo-ai/pr-agent` SHA in the workflow, smoke-test by force-pushing to a test PR and confirming pr-agent posts a real ~3-min review (not a 6-second skip).
- `.github/workflows/pr-review.yml` → `concurrency.cancel-in-progress: true` — if you push three commits in a minute, only the last one actually completes a review; the earlier in-flight runs are cancelled before they bill.
- `.pr_agent.toml` → `persistent_comment = true` — PR-Agent updates the existing review comment in place instead of posting a new one. The PR stays readable; you don't accumulate N copies of the review across N pushes.

Combined, the steady-state cost is one review per PR (plus at most one per Spec-enforcer bounce) at ~$0.02–$0.05 on Kimi K2.6. Rapid iteration during authoring costs nothing extra.

If a re-review is ever missed (concurrency race, transient GH Actions hiccup, etc.), `/review` as a PR comment is the manual fallback.

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

### PR-review readiness check (different from the workspace readiness check above)

The workspace readiness check above verifies your AntiGravity instance can do feature-implementer work end-to-end. This separate script verifies your **bare-metal Mac** has the local-Argos PR-review path wired correctly:

```bash
cd ~/Projects/ctrfhub
.antigravity/scripts/check-pr-review-readiness.sh
```

Verifies: `.pr_agent.toml` present, PR-Agent workflow file present, `claude` and `gh` CLIs installed and authenticated, `pr-review.sh` executable, `shell-aliases.sh` present.

Only relevant on the bare-metal Mac (where Argos local-review runs). VMs running Talos don't need this — they don't run local Argos reviews.

---

## Agent roster reference

Each workspace has a name. The canonical roster lives in `CLAUDE.md` "Agent names" table. Quick reference:

- **Argos** — orchestrator (Claude Opus 4.7 in Cowork mode); writes briefs, runs spec-audits, opens PRs.
- **Daedalus** — feature-implementer (AntiGravity in `~/Projects/ctrfhub` on the bare-metal Mac).
- **Talos** — feature-implementer (AntiGravity in the macOS VM); enables parallel story execution without working-tree collisions.
- **Hermes** — André's personal manager agent (separate project, not CTRFHub).

The two AntiGravity workspaces (Daedalus, Talos) are **physically separate** — different machines, different working trees. They never share files; they only share the GitHub remote. This is the entire reason Talos exists (see PR #16 history for the parallel-session collision that motivated the split).

---

## GitHub Secrets

| Secret | Used by |
|---|---|
| `OPENROUTER_API_KEY` | PR-Agent cloud workflow |

`ANTHROPIC_API_KEY` is intentionally not stored anywhere — the Argos local path uses your OAuth session, not an API key.
