# CTRFHub Session Handoff — 2026-05-20

> **For the next agent picking this up.** Read this top to bottom before touching anything. The project lives on Uranus (Hetzner VPS). Reconnect: `ssh uranus` → `tmux attach -t argos`.

---

## What this project is

**CTRFHub** — a case management app for CTRF (Common Test Report Format) test results. The multi-agent system (Argos orchestrator + Prometheus implementer) builds it story by story.

**Repo:** `/home/aangel/CTRFHub` on Uranus
**Argos session:** `tmux attach -t argos` (idle, waiting for your next command)
**Workflow reference:** `docs/planning/project-architecture.md`

---

## State of the codebase right now

**main @ d8c0334** (post #87 merge)

### Audit campaign status

| Order | Territory | Status |
|---|---|---|
| 1 | `audit-auth` | ✅ Done (PRs #79, #80 merged) |
| 2 | `audit-composition-root` | ✅ Done (PRs #85, #86, #87 merged) |
| 3 | `audit-ingest` | ← next up |
| 4 | `audit-persistence` | |
| 5 | `audit-artifact-storage` | |
| 6 | `audit-ai-pipeline` | |
| 7 | `audit-frontend` | |

### Open PRs

None blocking. PR #61 (Hephaestus agent docs) still open — non-blocking, merge when convenient.

### Open follow-ups from audit-composition-root

- `deployment-architecture.md` lines 54 + 139–141 still carry stale 503-during-sync framing — needs a separate authorized doc-only edit
- AUTH-002 is `[/]` in `tasks.md` — when it merges, kick off `Start story audit-auth-S2`

---

## What to do next (in order)

1. **Send Argos:** `Audit scope audit-ingest`
2. **When AUTH-002 merges → Send Argos:** `Start story audit-auth-S2`

---

## How to talk to Argos

```bash
tmux attach -t argos
# type your command and press Enter
```

**Important:** After a long run (>10 min) or a `/clear`, messages need an extra `Enter` to kick off.

---

## Locked architectural decisions

`docs/planning/architecture.md` is the canonical yardstick. Do not re-debate:
- `em.*` direct usage (no repository classes) — intentional convention
- `FastifyPluginAsync` default export — canonical route shape
- `request.em` always, never `fastify.orm.em`
- No `dark:` Tailwind variant — dark-mode only
- Eta is the template engine
- `BETTER_AUTH_SECRET` is the correct env var name (not `SESSION_SECRET`)
- No migration boot state in MVP — DB is recreated during development; `/health` 503-during-boot is not implemented

---

## Key paths on Uranus

```
/home/aangel/CTRFHub/
├── SESSION_HANDOFF.md                            ← This file
├── docs/planning/architecture.md                 ← Canonical audit yardstick
├── docs/planning/tasks.md                        ← Backlog (AUTH-002 is [/])
├── docs/planning/gaps.md                         ← Open planning questions
├── .argos/audits/audit-scoping/campaign-plan.md  ← 7-territory map
└── src/                                          ← Application code
```
