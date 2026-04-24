# AI Guidance

A centralized **source-of-truth constraint system and runbook** for AI developer agents at Performant Labs. It defines standard operating procedures, browser constraints, troubleshooting solutions, and codebase rules that AI agents adhere to before taking execution actions across our ecosystem.

## Repository Structure

```
ai_guidance/
├── agent/                  # Core AI agent rules & SOPs
│   ├── agents.md           # Agent behavior guidelines
│   ├── browser-constraints.md
│   ├── naming.md           # Naming conventions
│   ├── technical-writing.md
│   └── troubleshooting.md  # Master troubleshooting catalog
├── frameworks/
│   ├── drupal/             # Drupal best practices & theming guides
│   └── vue/                # Vue.js guidance
├── languages/
│   └── go/                 # Go language guidance
├── projects/
│   └── opencloud/          # Project-specific planning docs
├── scripts/
│   └── cli/                # Subtree automation scripts (ai:pull / ai:push)
├── snippets/               # Reusable code snippets
└── themes/                 # Shared Drupal themes (neonbyte, dripyard_base)
```

## How It Integrates with Host Projects

This repository is distributed into host projects (e.g. `pl-atk`, `opencloud-voting`) using **Git Subtrees** — not Git Submodules.

This ensures:
1. No `--recursive` clones required for external contributors.
2. Rules exist **physically** inside the host project (e.g. `docs/ai_guidance/`) — fully visible to AI agents at runtime.
3. Local edits discovered inside host projects can be pushed upstream cleanly without managing symlinks.

The standard mount point in host projects is:

```
docs/ai_guidance/
```

---

## Synchronizing Rules (Git Subtree)

### Pull the Latest (Sync Down)

Run from the **host project root**:

```bash
git subtree pull --prefix=docs/ai_guidance git@github.com:Performant-Labs/ai_guidance.git main --squash
```

### Publish Local Discoveries (Sync Up)

```bash
git subtree push --prefix=docs/ai_guidance git@github.com:Performant-Labs/ai_guidance.git main
```

> **Warning:** Always pull before pushing to avoid complex subtree merge-conflict histories.

---

## One-Touch CLI Automation (Recommended)

The `scripts/cli/` directory contains Python scripts that wrap the verbose `git subtree` commands into simple shell aliases. See [`scripts/cli/README.md`](scripts/cli/README.md) for full setup instructions.

### Quick Install

From the **root of your host project**:

```bash
./docs/ai_guidance/scripts/cli/install.sh
```

After installation, reload your shell:

```bash
source ~/.zshrc
```

### Usage

| Command | What it does |
|---------|-------------|
| `ai:pull` | Pulls latest from `Performant-Labs/ai_guidance` into `docs/ai_guidance/` (squash merge) |
| `ai:push` | Pushes local changes back upstream |
| `ai:pull --model opus` | Uses a specific Claude model for the post-pull change summary |

Both commands check for a clean working tree before proceeding and optionally summarize changes using Claude CLI.

### Prerequisites

| Tool | Required | Install |
|------|----------|---------| 
| **git** | ✅ | Xcode CLT or [git-scm.com](https://git-scm.com/) |
| **uv** | ✅ | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| **Claude CLI** | Optional | `npm install -g @anthropic-ai/claude-code` → `claude` → `/login` |

---

## Key Documentation

| File | Purpose |
|------|---------|
| [`agent/troubleshooting.md`](agent/troubleshooting.md) | Master catalog of known issues, hangs, and gotchas |
| [`agent/browser-constraints.md`](agent/browser-constraints.md) | Headless browser priority rules |
| [`agent/agents.md`](agent/agents.md) | Agent behavior guidelines |
| [`agent/claude-bridge.md`](agent/claude-bridge.md) | File-drop protocol for running host-only commands (ddev, drush, curl, Chrome) from a sandboxed agent |
| [`agent/naming.md`](agent/naming.md) | Naming conventions (kebab-case, file taxonomy) |
| [`agent/technical-writing.md`](agent/technical-writing.md) | Documentation style guide |
| [`frameworks/drupal/best-practices.md`](frameworks/drupal/best-practices.md) | Drupal development best practices |
| [`frameworks/fastify/conventions.md`](frameworks/fastify/conventions.md) | Fastify + TypeScript + Zod conventions (CTRFHub) |
| [`frameworks/mikro-orm/conventions.md`](frameworks/mikro-orm/conventions.md) | MikroORM v7 dual-dialect (PostgreSQL + SQLite) conventions |
| [`frameworks/better-auth/conventions.md`](frameworks/better-auth/conventions.md) | Better Auth setup, API tokens, route protection |
| [`frameworks/htmx/conventions.md`](frameworks/htmx/conventions.md) | HTMX + Alpine.js + Eta conventions, HTMX 4.0 forward-compat rules |
| [`frameworks/tailwind/conventions.md`](frameworks/tailwind/conventions.md) | Tailwind CSS v4 + Flowbite conventions |

---

## License

Content in this repository is proprietary to Performant Labs unless otherwise noted.
