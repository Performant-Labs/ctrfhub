# Move CTRFHub Development from Mac to Uranus — Plan

**Status:** Draft (planning only — no changes made to Mac or Uranus while producing this)
**Date drafted:** 2026-05-17
**Scope:** Relocate primary development of `Performant-Labs/ctrfhub` from `/Users/andreangelantoni/Projects/ctrfhub` (Mac) to `/home/aangel/CTRFHub` on the Linux server `uranus`. After the move, the Mac will be offline; Uranus must be the host for all future development.

> Read the whole plan before executing anything. The pre-move checklist is the only place loose ends get tied; if you skip it, work-in-progress on the Mac (stashes, untracked files, the worktree fleet) will become unreachable.

---

## 1. Project summary

CTRFHub is a self-hosted, open-source, CTRF-native test-reporting dashboard ("ReportPortal for the CTRF era"). Stack: Node.js 22 LTS, Fastify, TypeScript (strict), Zod, MikroORM v7 against Postgres (prod) or SQLite (single-node), HTMX 2.x + Alpine.js 3, Tailwind 4 + Flowbite, Eta templates, Better Auth, Chart.js. Locally it runs three ways: native `npm run dev` (tsx-watched Fastify on :3000), `docker compose -f compose.dev.yml up` (Fastify + Postgres with source bind-mounted for hot-reload), or `docker compose -f compose.sqlite.yml up -d` (single container, SQLite, uses a ghcr.io image that **does not exist yet** — built later by story CI-001). Active work is the Phase 2 MVP backlog under `docs/planning/tasks.md`, driven by the Argos/Daedalus/Talos multi-agent workflow.

---

## 2. Runtime requirements on Uranus

| Requirement | Detail | Source |
|---|---|---|
| **Node.js** | 22 LTS (the `.nvmrc` pins `22`; `package.json` `engines.node >=22.0.0`) | `.nvmrc`, `package.json` |
| **npm** | 10+ (Node 22 LTS ships with npm 10) | `DEVELOPER_SETUP.md` workspace readiness |
| **Docker + Docker Compose v2** | Required for `compose.dev.yml` (recommended path) and for the `db` Postgres sidecar | `compose.dev.yml` |
| **Git + GitHub CLI (`gh`)** | `gh` is used by `.antigravity/scripts/pr-review.sh` and the workflows | `DEVELOPER_SETUP.md` |
| **Claude Code CLI (`claude`)** | Powers the local Argos PR-review path (`pr-review.sh`) | `.antigravity/scripts/pr-review.sh` |
| **Build toolchain** | `python3`, `make`, `g++`, `wget` — required to compile `better-sqlite3` native bindings | `Dockerfile`, `Dockerfile.dev` |
| **PostgreSQL 16** | Runs as a container via compose; no host install needed if Docker is present | `compose.yml`, `compose.dev.yml` |
| **SQLite** | Bundled with `better-sqlite3` (native); no host install needed | `package.json` |
| **`tsx`, `tailwindcss CLI`, `mikro-orm CLI`, `vitest`, `playwright`** | All resolved by `npm install` — no separate host install | `package.json` |
| **Ports** | `3000` (Fastify dev server, configurable via `PORT`), `5432` (Postgres exposed to host by `compose.dev.yml`). **Coolify on Uranus likely already binds 80/443/8000**; CTRFHub dev needs 3000 + 5432 free. | `compose.dev.yml` |
| **Tailscale** | Mac↔Uranus over Tailscale (already in use; the move plan assumes `ssh uranus` works) | user-stated |
| **`~/Sites/ai_guidance` clone** | The repo has a symlink `docs/ai_guidance -> /Users/andreangelantoni/Sites/ai_guidance`. On Uranus the home is `/home/aangel`, so the absolute target won't resolve — must be replaced with a symlink to `~/Sites/ai_guidance` (which itself must be cloned). See §8 for the gotcha. | `DEVELOPER_SETUP.md` |

**External services**: For MVP, none are required. The compose files spec a Postgres container only. Redis is **optional** (used only for `EVENT_BUS=redis` and BullMQ scale-out, neither needed for MVP). No external SaaS dependencies — managed-provider AI keys are off by default (`AI_PROVIDER` unset).

**Disk**: ~2 GB working set (node_modules ~700 MB, `.git` ~200 MB, source ~50 MB, plus Postgres volume growth). Comfortable headroom is 10 GB.

---

## 3. Coolify consideration — deploy through it, or plain docker-compose?

Uranus already runs Coolify. The choice splits along two **different** axes that are easy to conflate:

**Axis A: Active development environment.** This means `npm run dev` (tsx watch on :3000) or `docker compose -f compose.dev.yml up` — what you sit in front of all day and Claude Code drives. Coolify is the wrong tool for this. Coolify rebuilds an image on every git push to do a fresh deploy; the inner-loop edit→reload cycle is broken by that model. Daily dev wants tsx-watch on hot-reloaded source, which is exactly what `compose.dev.yml` provides.

**Axis B: A deployed/preview CTRFHub instance.** This is what PL-020 in `docs/planning/parking-lot.md` is actually about — using Coolify on this same server to replace Tugboat for per-PR previews once Tugboat's free tier becomes a bottleneck. PL-020 is currently deferred but the eventual target is "Coolify on André's existing self-hosted server" — i.e. Uranus.

**Recommendation:** Run plain `docker compose -f compose.dev.yml` in `~/CTRFHub` for active development. Leave Coolify untouched for now. **Later** (when PL-020 promotes — the trigger is Tugboat's 3-preview ceiling biting), set up CTRFHub as a Coolify-managed app pointed at the GitHub repo's `main` branch, on a different port/domain. The two coexist cleanly: dev on :3000, Coolify-managed preview on its own subdomain via Coolify's Traefik. This matches the parking-lot-documented design rather than diverging from it.

Port-conflict check: Coolify's Traefik uses :80/:443; the Coolify admin UI uses :8000 by default. CTRFHub dev binds :3000 and exposes :5432 for the Postgres GUI — verify on Uranus that those two are free (`ss -tlnp | grep -E ':(3000|5432)\s'`). If anything is already on :3000, set `PORT=3001` in `.env`.

---

## 4. What to transfer

### Comes from `git clone` (no manual copy)
- All tracked source, docs, planning, skills, agent definitions, scripts, compose files, Dockerfiles, `package*.json`, `.husky/`, `.github/`, `.argos/` (tracked since PR #17), `.antigravity/`, `.tugboat/`, `.pr_agent.toml`, `.mergify.yml`, etc.
- **Remote URL:** `https://github.com/Performant-Labs/ctrfhub` (origin). There is also an `ai_guidance` remote pointing at `git@github.com:Performant-Labs/ai_guidance.git` — that's the same remote you'll re-add to `~/Sites/ai_guidance` on Uranus.

### Non-git artifacts to copy explicitly from Mac → Uranus
| Item | Path on Mac | Why |
|---|---|---|
| `.env` (secrets) | `~/Projects/ctrfhub/.env` (832 bytes) | Gitignored. Holds `SESSION_SECRET`, `POSTGRES_PASSWORD`, any AI keys. Cannot be regenerated — must be physically moved. |
| `.intent/config.json` (and `.intent/.gitignore`) | `~/Projects/ctrfhub/.intent/` | These are **untracked but load-bearing** for the local "Intent" tooling. Already a known loose end — should be committed before the move (see §5) or copied alongside `.env`. |
| `~/Sites/ai_guidance` (the whole clone) | `~/Sites/ai_guidance` | The CTRFHub repo has a `docs/ai_guidance` symlink pointing at this absolute path. On Uranus the symlink will point at `/Users/andreangelantoni/Sites/ai_guidance` which doesn't exist — clone `Performant-Labs/ai_guidance` into `/home/aangel/Sites/ai_guidance` and replace the symlink (workspace-local, don't commit). |
| `~/.claude` (Claude Code OAuth state, optional) | `~/.claude` on Mac | Strictly speaking, re-authenticate on Uranus with `claude auth login`. Copying OAuth state Mac→Linux is unreliable; just plan to re-auth. |
| GitHub credentials | `gh auth status` on Mac | Same — re-auth on Uranus with `gh auth login` (web browser flow over SSH works; or paste a PAT). |

### Deliberately NOT copy
| Item | Reason |
|---|---|
| `node_modules/` | Regenerated by `npm install`; ~700 MB; native modules differ across macOS/Linux ABI. |
| `.claude-bridge/` | 124 result spool files (~864 KB) from prior bridge calls. Gitignored. Historical only — no need to move. |
| `.claude/settings.local.json` | Per-workspace local Claude Code state. Regenerate on Uranus. |
| `.conductor/` (empty) and `.intent/` runtime state files (other than `config.json` / `.gitignore`) | Local-only tool state. |
| `dist/`, `src/assets/tailwind.css`, `e2e/test-results/`, `e2e/ctrf/`, `.tsbuildinfo`, etc. | All build artifacts, regenerated. |
| The **git worktrees** at `~/conductor/workspaces/ctrfhub/hong-kong`, `~/intent/workspaces/ctrfhub-web/ctrfhub*` (5 worktrees total) | They all reference branches that already exist on `origin`. If any of them has uncommitted work, address it in the pre-move checklist (§5); otherwise they evaporate cleanly. |
| `.DS_Store` (in `docs/` and possibly elsewhere) | macOS-only. |
| `~/Library/.../local-agent-mode-sessions/...` | Cowork session state — that's where this plan is being authored; ephemeral. |

---

## 5. Pre-move checklist (do these on the Mac BEFORE going offline)

Treat each item as a hard gate. The state of the Mac right now (as observed during this audit) makes the loose ends explicit:

- **Current branch:** `main`, **behind `origin/main` by 2 commits** (`AI-003 #69`, `INFRA-003 #65`). Pull before doing anything else: `git checkout main && git pull --ff-only`.
- **There is one stash:** `stash@{0}: WIP on story/CTRF-004: 6f11e94 feat(CTRF-004): scaffold reporter packages, workspaces, and CI examples`. Decide: drop, apply-and-commit, or carry as a stash entry (stashes don't travel with git clone — they live in the local `.git/`). Recommendation: check out `story/CTRF-004`, `git stash pop`, commit-or-discard, push.
- **There are 5 git worktrees** (`hong-kong`, the chat-intro detached, `story/AI-003`, `story/AUTH-002`, `story/CTRF-004`). For each: `cd` in, run `git status` — if dirty, commit and push or discard intentionally. Once the main checkout is gone, these worktrees are dead weight.
- **`.intent/` is untracked** at the repo root (`.intent/.gitignore`, `.intent/config.json`). The internal `.gitignore` inside it says "Only config.json is tracked in git" — but neither file is currently tracked. Recommended: `git add .intent/.gitignore .intent/config.json && git commit -m "chore: track .intent config" && git push`. If you'd rather not commit, copy them in §6 step 3.
- **All open story branches pushed?** Run `git branch -vv` and confirm none of the local branches have unpushed commits. Specifically check: `aangelinsf/chat-intro`, `chore/*`, `story/AI-003`, `story/AUTH-002`, `story/CTRF-004`, `story/INFRA-003`, `story/CTRF-003-opus`, `story/CTRF-003-qwen`, `chore/lint-001-opus`, `chore/lint-001-qwen` etc. The audit shows several worktree-checked-out story branches; push anything not on origin.
- **Pause Argos sessions cleanly.** This plan was drafted from a Cowork session; if Argos is mid-orchestration (e.g. has just written a brief or remediation), commit whatever's in `.argos/<taskId>/` and push so Uranus picks it up via `git pull`.
- **Confirm `.env` is present and complete.** `cat .env` and verify `SESSION_SECRET`, `POSTGRES_PASSWORD`, `PUBLIC_URL` are non-empty. (Don't paste contents into the plan.)
- **`~/Sites/ai_guidance`** — confirm clean: `cd ~/Sites/ai_guidance && git status && git log -1`. Push any uncommitted local commits there too, since the CTRFHub `docs/ai_guidance` symlink will point at the Uranus re-clone of that repo.
- **GitHub CLI auth** — confirm `gh auth status` returns "Logged in to github.com" so you know the GitHub side is healthy before you cut the Mac off.
- **Save a copy of `.env` somewhere you can reach from Uranus** (1Password, encrypted email to yourself, or rely on the rsync over Tailscale in §6). Belt-and-braces — the move is reversible right up until the Mac is off, but only if you can re-fetch the secrets.
- **(Optional) Snapshot tasks/gaps state.** `git log -5 -- docs/planning/tasks.md docs/planning/gaps.md` so you know exactly where work paused.

When all of the above are green, the Mac can go offline.

---

## 6. Move steps (Uranus)

Run each step in order. Most are one-liners. The whole sequence is ~30–60 minutes assuming reasonable network.

### Step 1 — Install system prerequisites
```bash
# (on Uranus, via `ssh uranus`)
sudo apt update
sudo apt install -y git curl build-essential python3 make g++ wget rsync
# Docker — if Coolify is installed, Docker is already present. Verify:
docker --version && docker compose version
# GitHub CLI
type -p curl >/dev/null || sudo apt install -y curl
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
  && sudo chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
  | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
  && sudo apt update && sudo apt install -y gh
```

### Step 2 — Install Node 22 LTS via nvm (so `.nvmrc` works)
```bash
# Install nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
# Activate in current shell
export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
# Install + select the version pinned by .nvmrc (22)
nvm install 22 && nvm alias default 22
node --version && npm --version    # expect v22.x and 10.x+
```

### Step 3 — Install Claude Code CLI
```bash
# Official installer (linux-x64 / linux-arm64 auto-detected)
curl -fsSL https://claude.ai/install.sh | bash
# Auth (opens browser flow — works fine via SSH; copy/paste the URL/code)
claude /login
# Verify
claude --version
```
If the `curl | bash` installer isn't current at the time of the move, the npm fallback also works: `npm install -g @anthropic-ai/claude-code`. Anthropic's docs page (https://docs.claude.com/en/docs/claude-code/) is the source of truth for the install one-liner.

### Step 4 — Authenticate GitHub CLI
```bash
gh auth login
# Choose: GitHub.com → HTTPS → "Login with a web browser"
# Copy the one-time code, open the URL in your local browser, complete auth.
gh auth status    # confirm: Logged in to github.com as aangelinsf
```

### Step 5 — Clone CTRFHub and `ai_guidance`
```bash
mkdir -p ~/CTRFHub && cd ~/CTRFHub
# Clone via the same HTTPS remote the Mac uses
git clone https://github.com/Performant-Labs/ctrfhub.git .
# (Alternatively: gh repo clone Performant-Labs/ctrfhub .)

# Set git identity (or rely on gh's credential helper — either works)
git config user.name  "André Angelantoni"
git config user.email "aangel@performantlabs.com"

# Clone ai_guidance so the docs/ai_guidance symlink resolves
mkdir -p ~/Sites && cd ~/Sites
git clone https://github.com/Performant-Labs/ai_guidance.git
```

> **Path note:** the brief asks for `/home/aangel/CTRFHub` (capital). The Mac uses `/Users/andreangelantoni/Projects/ctrfhub` (lowercase). I've kept the brief's `~/CTRFHub` — that's fine, but be aware some scripts in `.antigravity/scripts/shell-aliases.sh` and `pr-review.sh` hardcode `~/Projects/ctrfhub`. Override before sourcing: `export CTRFHUB_DIR="$HOME/CTRFHub"` then `source ~/CTRFHub/.antigravity/scripts/shell-aliases.sh` (`DEVELOPER_SETUP.md` "PR Review Workflow → Shell alias" documents this exact override).

### Step 6 — Fix the `docs/ai_guidance` symlink
The committed symlink is absolute (`/Users/andreangelantoni/Sites/ai_guidance`), which won't resolve on Linux. Replace it locally (don't commit):
```bash
cd ~/CTRFHub
ls -l docs/ai_guidance     # confirm: broken (target /Users/andreangelantoni/...)
rm docs/ai_guidance
ln -s ~/Sites/ai_guidance docs/ai_guidance
ls docs/ai_guidance/       # should list ai_guidance subdirs
# This file shows as modified to git — leave it modified locally; do NOT commit.
git update-index --assume-unchanged docs/ai_guidance   # optional: hide the diff
```

### Step 7 — Copy the `.env` (and `.intent/` if you didn't commit it in §5) over Tailscale
From the Mac (while it's still online):
```bash
# Mac → Uranus
rsync -avz ~/Projects/ctrfhub/.env uranus:~/CTRFHub/.env
# Optional: only if you didn't commit .intent/ in the pre-move checklist
rsync -avz ~/Projects/ctrfhub/.intent/ uranus:~/CTRFHub/.intent/
# Verify on Uranus
ssh uranus 'ls -la ~/CTRFHub/.env ~/CTRFHub/.intent 2>/dev/null'
```
If the Mac is already offline, fall back to whatever side-channel you stashed `.env` in during §5.

### Step 8 — `npm install` and build
```bash
cd ~/CTRFHub
npm install            # first run ~1–3 min; compiles better-sqlite3 against host glibc
npx tsc --noEmit       # typecheck
npm test               # unit + integration tests
npm run build          # tsc + tailwind CLI minify
```
If `better-sqlite3` fails to compile, double-check `python3`, `make`, `g++` are installed (step 1).

### Step 9 — Pick a runtime mode and start

**Mode A — Native Node (fastest inner loop, no container)**
Requires Postgres available somewhere. Easiest: run only the `db` from compose:
```bash
docker compose -f compose.dev.yml up -d db
# Then run the app natively:
npm run dev          # tsx watch on :3000
# Tailwind watch (second terminal or tmux pane)
npm run css:dev
```

**Mode B — Full compose dev stack** (closer to CI parity)
```bash
docker compose -f compose.dev.yml up
# App on :3000 (port forwarded), Postgres on :5432
```

**Mode C — SQLite single-container** (only after CI-001 publishes `ghcr.io/ctrfhub/ctrfhub`; not yet)
```bash
docker compose -f compose.sqlite.yml up -d
```
Skip mode C for now. The image hasn't been built — `compose.yml` and `compose.sqlite.yml` both reference an image that CI-001 hasn't produced.

### Step 10 — (Optional) Shell aliases for Argos PR review
```bash
echo 'export CTRFHUB_DIR="$HOME/CTRFHub"'                            >> ~/.bashrc
# pr:review uses a zsh-specific colon-in-name function; if you want it,
# install zsh and source the file from ~/.zshrc instead:
# echo 'source ~/CTRFHub/.antigravity/scripts/shell-aliases.sh' >> ~/.zshrc
```

---

## 7. Post-move verification

Run the workspace readiness check that `DEVELOPER_SETUP.md` ships specifically for this purpose. The full prompt is in that file between the `~~~prompt-start` / `~~~prompt-end` markers; the essentials to satisfy on Uranus are:

```bash
cd ~/CTRFHub
# 1. Repo clean + on main + up-to-date
git status --short --branch
git fetch origin --quiet && git status -uno
git rev-parse --short HEAD

# 2. Tooling
node --version    # v22.x
npm --version     # 10+
gh auth status    # Logged in; check permissions.push:
gh api repos/Performant-Labs/ctrfhub --jq .permissions.push   # → true
claude --version

# 3. Toolchain
npx tsc --noEmit
npm test          # Test Files passed / Tests passed

# 4. Skills + agents present
ls skills/ | wc -l                                          # ≥ 14
ls .antigravity/agents/                                     # 4 files
ls .antigravity/workflows/                                  # 3 files
ls docs/planning/{project-architecture,project-plan,architecture,product,database-design,tasks,gaps}.md

# 5. .argos/ tracked (not gitignored)
git check-ignore .argos/ && echo IGNORED || echo TRACKED    # → TRACKED

# 6. docs/ai_guidance resolves
ls docs/ai_guidance/ | head -3                              # lists subdirs

# 7. App boots
docker compose -f compose.dev.yml up -d db
npm run dev &                                               # or compose dev
sleep 5
curl -s http://localhost:3000/health                        # → 200 with {"status":"ok"} once migrations done
```

If `/health` returns 200 with `{"status":"ok"}` and `npm test` passes, the move is complete. Smoke-test the Argos PR-review path on an existing PR:
```bash
~/CTRFHub/.antigravity/scripts/pr-review.sh <some-PR-number>   # stdout only, no --post
```
A successful run prints a structured review without errors.

---

## 8. Risks, gotchas, and open questions

| # | Risk / question | Mitigation / decision needed |
|---|---|---|
| 1 | **AntiGravity is macOS-only.** Daedalus and Talos run inside the AntiGravity IDE on the Mac and in a macOS VM respectively. The multi-agent workflow (briefs in `.argos/<taskId>/`, parallel story branches, the Argos↔Daedalus↔Talos relay) was designed around two AntiGravity workspaces. On Uranus, you'll be driving everything through Claude Code via SSH — no AntiGravity, no Daedalus/Talos as separate workspaces. **Decide:** collapse to a single-agent flow where Argos and the feature-implementer are the same Claude Code session, or keep two SSH sessions (one as Argos, one as feature-implementer) and rely on the existing `.argos/<taskId>/` git-based handoff? The git-based handoff still works; only the IDE-affordance disappears. |
| 2 | **`docs/ai_guidance` symlink is absolute.** Hardcoded to `/Users/andreangelantoni/Sites/ai_guidance`. Step 6 handles it but you must remember not to `git add` the modified symlink — committing it would break it on the Mac for anyone who comes back to the Mac. |
| 3 | **Hardcoded `~/Projects/ctrfhub`** in `.antigravity/scripts/shell-aliases.sh` and possibly elsewhere. Override via `CTRFHUB_DIR=$HOME/CTRFHub`. If you'd rather not override, clone the repo at `~/Projects/ctrfhub` instead of `~/CTRFHub` — the brief asks for `~/CTRFHub` but `~/Projects/ctrfhub` would minimise drift. |
| 4 | **Claude Code OAuth doesn't move.** macOS Keychain tokens won't read on Linux. Plan to `claude /login` fresh on Uranus. Same with `gh auth`. |
| 5 | **Two commits behind on `main` + one stash on `story/CTRF-004`.** Pre-move checklist (§5) covers them. If you skip it, the stash is lost forever. |
| 6 | **5 git worktrees, several with story branches.** They reference remote branches, so the branch names survive. Anything **uncommitted inside a worktree** does not. Check each before going offline. |
| 7 | **`.intent/` untracked.** Not load-bearing for CTRFHub itself (it's local IDE/tool integration), but worth deciding once and for all: commit it (recommended — `.intent/.gitignore` says config.json should be tracked anyway), or carry by rsync each time. |
| 8 | **`compose.yml` / `compose.sqlite.yml` reference `ghcr.io/ctrfhub/ctrfhub:latest` which doesn't exist yet** (CI-001 will publish it). Only `compose.dev.yml` builds from source. Treat the SQLite container path as "not available until CI-001 ships." |
| 9 | **Coolify port conflicts.** Coolify ships its admin UI on :8000 and routes via Traefik on :80/:443. CTRFHub dev wants :3000 and exposes Postgres on :5432. Almost certainly fine — but `ss -tlnp` before first `npm run dev` to confirm. If :3000 is taken, set `PORT=3001` in `.env`. |
| 10 | **PR-Agent on GitHub Actions doesn't care where you develop.** PR reviews continue to run in CI regardless of host. No change there. |
| 11 | **Local PR-review path requires `claude` + `gh` + a current OAuth.** Both are step 3/4 of the move. The `.husky/pre-push` hook also assumes Node 22 and `npm`. All present after step 2/8. |
| 12 | **Tailscale-specific gotcha.** `rsync` over SSH-over-Tailscale works the same as plain SSH. If `ssh uranus` works, `rsync` works. No magic flag needed. |
| 13 | **Coolify-as-deployment-target is documented (PL-020) but not promoted.** Don't conflate "move dev to Uranus" with "promote PL-020." PL-020 has its own gating criteria (Tugboat preview ceiling biting); the dev relocation is independent. |
| 14 | **Browser harness for T2.5 Authenticated State tests.** `~/.local/bin/browser-harness` is documented in `skills/page-verification-hierarchy.md §T2.5` as macOS-specific (CDP into developer's Chrome). On Linux you'll need a different posture: either a headless Playwright session as the "harness," or skip T2.5 on Uranus and run those tests only in CI. Decide before the first auth-gated UI story (DASH-001+). Not blocking the move itself. |
| 15 | **SSH-from-phone ergonomics.** The brief says you'll likely drive Claude Code from a phone/laptop. Worth installing `tmux` and starting Claude inside a tmux session so dropped SSH sessions don't kill mid-task work. |

---

## Appendix — fast reference (commands you'll re-use)

```bash
# On Mac, before going offline:
cd ~/Projects/ctrfhub && git checkout main && git pull --ff-only
git stash list                                    # decide what to do with stash@{0}
git worktree list                                 # 5 worktrees — clean each
git status                                        # → only .intent/ should be untracked
# Decide: commit .intent/ or rsync it across (see §5/§7)

# On Uranus, post-move daily-driver loop:
cd ~/CTRFHub
git pull --ff-only
docker compose -f compose.dev.yml up -d db
npm run dev                                       # :3000
# (in second terminal/pane)
npm run css:dev

# Run an Argos local PR review:
~/CTRFHub/.antigravity/scripts/pr-review.sh <PR-num>
~/CTRFHub/.antigravity/scripts/pr-review.sh <PR-num> --post
```

---

*Plan generated from a read-only audit of `~/Projects/ctrfhub` on 2026-05-17. No files were modified on the Mac or Uranus during this audit. Remote URL confirmed: `https://github.com/Performant-Labs/ctrfhub`. Current HEAD on Mac main: `696fe70 [CTRF-003] Artifact co-upload with ingest (#63)`, 2 commits behind `origin/main` (AI-003 #69 and INFRA-003 #65).*
