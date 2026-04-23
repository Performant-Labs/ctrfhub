# CTRFHub — Merged Design Gap Review

Combined output of two independent reviews of `/docs/planning`.
Date: 2026-04-22.

Severity key:

- **P0** — blocks implementation decisions; likely rework if left unresolved.
- **P1** — factually wrong or internally contradictory; will mislead implementers.
- **P2** — undesigned surface area that will be needed soon.
- **P3** — nit / small contradiction / low risk.

Origin tag:

- **[Both]** — flagged by both reviews.
- **[Me]** — only in the first review (this assistant).
- **[Other]** — only in the second review (Gap Review #2).

---

## Part 1 — What the other review caught that I missed

These are the items I want explicitly called out so they don't get lost in the merged list. All five were verified against the actual files before inclusion here.

1. **[Other, P0] Tailwind 4 + Flowbite ↔ `[data-theme]` custom-property integration is undefined.**
   `architecture.md` line 40–41 specifies Tailwind CSS 4 with CSS-first `@theme` config, plus Flowbite for pre-built components. `project-plan.md` line 19 repeats this. But `theme-design.md` is pure CSS custom properties keyed on `data-theme="midnight" | "slate" | "dim" | "cloud" | "warm" | "sky"`, with **zero mention of Tailwind or Flowbite**. None of the following is specified: whether Tailwind utility classes consume `--color-*` via an `@theme` block; whether Flowbite's hard-coded palette is overridden or stays; whether a class like `bg-primary` reflects the active `data-theme` at runtime; how dark-mode variants (Tailwind's `dark:` prefix) relate to the six-theme system. This has real downstream implementation risk — needs a decision before any component work.

2. **[Other, P1] `/api/artifact` reference in `project-plan.md` line 63.**
   The line reads: *"Upload and associate screenshots, videos, traces, and logs with tests (via `/api/artifact` or embedded in CTRF)."* But DD-014 and `product.md` state clearly there is no separate artifact endpoint — artifacts are always part of the multipart ingest payload. Delete or rewrite this line.

3. **[Other, P1] camelCase vs snake_case in `theme-design.md`.**
   The auto-mode JavaScript (lines 206–217) uses `userSettings.darkTheme` / `userSettings.lightTheme` (camelCase). The documented JSON storage shape (lines 229–232) uses `"dark_theme": "midnight"` / `"light_theme": "cloud"` (snake_case). Pick one and fix the other.

4. **[Other, P2] Custom Fields API routes are undesigned.**
   `settings-architecture.md` §2.6 (lines 185–203) describes full CRUD over unlimited custom fields, dropdown options, display order via drag-to-reorder, required toggle, per-project enable/disable. No corresponding API routes (`GET/POST/PATCH/DELETE /org/custom-fields`, `PATCH /org/custom-fields/:id/reorder`, `PATCH /projects/:id/custom-fields/:id`) exist anywhere in the docs.

5. **[Other, P2] Slack DM per-user notification channel has no OAuth design.**
   `settings-architecture.md` §1.3 (lines 77–85) lists "Slack DM" alongside Email for per-user notifications. But §2.7 (line 214) defines org-level Slack as a single *OAuth app install or incoming webhook URL* — one connection per org. Per-user DMs require each member to OAuth-connect their own Slack account (or the org app has `chat:write` DM scopes and looks members up by email). Neither path is documented, the `user_slack_connections` table isn't in `database-design.md`, and the consent/revoke flow is undefined.

**Also worth noting — framing where the other review was broader than mine:** I raised the "no BYOK override for AI providers" gap narrowly (my #13); the other review framed it as a whole missing AI Settings operational surface (status card, token-consumption meter, enable/disable by feature, cost caps, model override). The broader framing is more useful and is folded into the merged list below.

---

## Part 2 — Merged master list

Severity first, then grouped by doc. Each item tagged with origin.

### P0 — Blockers

| # | Doc | Tag | Gap |
|---|---|---|---|
| 1 | `architecture.md` / `theme-design.md` | [Other] | Tailwind 4 + Flowbite ↔ `data-theme` custom-property integration undefined. See Part 1 item 1. |
| 2 | `architecture.md` / `deployment-architecture.md` | [Me] | Template engine conflict: `architecture.md` specifies **Eta**; `deployment-architecture.md` specifies **Nunjucks**; `parking-lot.md` references a `.njk` file. Pick one and purge references to the other. |
| 3 | `database-design.md` | [Me] | Several tables named in `settings-architecture.md` have no schema in `database-design.md` or are only mentioned in the table inventory without column definitions: `user_notification_preferences`, `sso_configurations`, `project_custom_field_settings` (partial), plus any new table needed for per-user Slack DM (see P2-#14). |
| 4 | `ai-features.md` / `deployment-architecture.md` | [Me] | No restart-recovery semantics for A2 (Root Cause Correlation) and A3 (Run Narrative) in-flight jobs. If the AI worker crashes mid-pipeline, state is lost and runs will appear "analyzing" forever. Needs idempotent job record + re-enqueue on boot. |

### P1 — Factual errors and internal contradictions

| # | Doc | Tag | Gap |
|---|---|---|---|
| 5 | `project-plan.md` L63 | [Other] | `/api/artifact` is not a real endpoint. See Part 1 item 2. |
| 6 | `theme-design.md` L206–217 vs L229–232 | [Other] | `userSettings.darkTheme` (camelCase) vs `"dark_theme"` (snake_case). See Part 1 item 3. |
| 7 | `project-plan.md` | [Me] | Ingest endpoint description and auth header are out of date relative to `product.md` / DD-003. `project-plan.md` treats API token model as final; reconcile with current spec. |
| 8 | `ai-features.md` | [Me] | Wrong Anthropic model name `claude-haiku-3-5`. Correct strings are `claude-haiku-4-5-20251001` (Haiku 4.5) or `claude-sonnet-4-6` / `claude-opus-4-6`. |
| 9 | `database-design.md` | [Me] | Duplicate section numbers 4.8 and 4.9 (two different subjects share each heading). Renumber. |
| 10 | `database-design.md` / `ai-features.md` / UI copy | [Me] | `test_runs.status` ENUM, the run-rollup logic, and the UI's status labels are a three-way mismatch. ENUM and rollup code disagree on whether "blocked" is a terminal state; UI shows a counter for `blocked` that no writer ever increments. Either remove `blocked` or wire it through. |
| 11 | SSE path | [Me] | SSE path is documented as `/orgs/:orgId/events` in one place and `/org/:id/settings/events` in another. Pin one. |
| 12 | `ai-features.md` | [Me] | Anthropic model name aside (see #8), the prompt catalog shows a system prompt that leaks the CTRF schema to the model — this is fine, but make sure it's what you want. |
| 13 | `deployment-architecture.md` | [Me] | `MAX_PAYLOAD_SIZE=10mb` in example env vs. 100 MB videos mentioned elsewhere as upload targets. Either raise the limit or document the artifact-vs-ingest size split explicitly. |

### P2 — Missing or under-designed surface

| # | Doc | Tag | Gap |
|---|---|---|---|
| 14 | `settings-architecture.md` | [Other] | Custom Fields API routes undesigned. See Part 1 item 4. |
| 15 | `settings-architecture.md` / `database-design.md` | [Other] | Per-user Slack DM notification channel has no OAuth design. See Part 1 item 5. |
| 16 | `settings-architecture.md` / `ai-features.md` | [Both — other broader] | AI Settings operational surface. Needs: status card (provider reachable, last error), token-consumption meter (rolling 30-day), per-feature enable/disable (A1…A5), cost caps, and **BYOK override** so self-hosters on Business Edition can substitute their own API key for the managed provider. |
| 17 | `settings-architecture.md` | [Me] | Per-feature ON/OFF routes and permissions aren't documented — e.g. who can toggle the milestone feature or the retention policy. |
| 18 | `ai-features.md` / legal | [Me] | Privacy/consent gap around stack traces sent to third-party LLM providers. For self-hosters this is a compliance consideration; needs a per-org "AI uses third-party provider" acknowledgement and a way to disable the cloud pipeline entirely. |
| 19 | Search | [Me] | No global search surface designed. Users will expect to search across runs, tests, and comments; no endpoint, index plan, or UI. |
| 20 | `database-design.md` / `product.md` | [Me] | `assigned_to` lifecycle is undefined — when is a test result auto-unassigned, can multiple users be assigned, what happens when the assignee is removed from the org. |
| 21 | `load-testing-strategy.md` | [Me] | No AI-pipeline load-test scenario — large AI-categorisation bursts under p95 latency targets aren't exercised. |
| 22 | `deployment-architecture.md` | [Me] | SQLite + AI writer contention: SQLite's single-writer model plus the AI pipeline writing categorisations + narrative rows concurrently with ingest is not sized. At `compose.sqlite.yml` scale this is probably fine, but needs a documented limit. |
| 23 | Ingest | [Me] | No CORS policy documented for `trace.playwright.dev` hitting artifact URLs from the dashboard — the Playwright trace viewer will be blocked without explicit CORS headers on the artifact CDN / proxy. |
| 24 | `deployment-architecture.md` | [Me] | Migration healthcheck race window — if the healthcheck returns 200 before migrations complete, the LB can route traffic to a broken instance. Document the `/healthz` contract so it fails while migrations are running. |
| 25 | CI / tokens | [Me] | Slug change breaks CI tokens — if a project's slug is renamed, prior reporter configs with the old slug will silently 404. Either pin tokens to a stable ID in URLs or document the rename break + a redirect. |
| 26 | CTRF mapping | [Me] | CTRF field-to-column mapping isn't documented — which CTRF fields land in which table columns, and which are stored as raw JSON. Important for partner reporter authors. |
| 27 | CTRF handling | [Me] | CTRF `other` status is unhandled — valid CTRF per the spec but no rollup or display rule documented. |

### P3 — Nits and smaller cleanups

| # | Doc | Tag | Gap |
|---|---|---|---|
| 28 | `deployment-architecture.md` | [Me] | Nunjucks vs Eta references (also feeds P0-#2). Ensure all `.njk` extensions are purged if Eta wins. |
| 29 | `parking-lot.md` | [Me] | `.njk` file reference — same issue. |
| 30 | `project-plan.md` | [Me] | Section ordering claims "auth before ingest" for the MVP plan but later text assumes ingest is first. Minor but confusing. |
| 31 | `theme-design.md` | [Me] | Dim theme `--color-text-muted` on bg is 4.5:1 — passes WCAG AA *exactly*. Any rendering gamma shift will drop it under. Consider nudging slightly lighter. |

---

## Part 3 — What I caught that the other review did not

For symmetry:

- Template engine conflict: Eta vs. Nunjucks vs. `.njk` in parking-lot.md (P0-#2).
- SSE path inconsistency (P1-#11).
- Duplicate section numbers 4.8/4.9 in `database-design.md` (P1-#9).
- `test_runs.status` ENUM ↔ rollup ↔ UI three-way mismatch, including orphaned `blocked` counter (P1-#10).
- Wrong Anthropic model name `claude-haiku-3-5` (P1-#8).
- Missing AI pipeline restart recovery for A2/A3 (P0-#4).
- SQLite + AI writer contention (P2-#22).
- No CORS design for Playwright trace viewer (P2-#23).
- `MAX_PAYLOAD_SIZE=10mb` vs 100 MB video uploads (P1-#13).
- Migration healthcheck race window (P2-#24).
- Slug-change breaks CI tokens (P2-#25).
- CTRF field-to-column mapping undocumented (P2-#26).
- CTRF `other` status unhandled (P2-#27).
- No global search surface (P2-#19).
- `assigned_to` lifecycle undefined (P2-#20).
- No AI-pipeline load-test scenario (P2-#21).
- Privacy/consent gap for third-party LLM providers (P2-#18).

---

## Recommended order of work

1. Decide Tailwind/theme integration (P0-#1) — write the integration doc into `theme-design.md`.
2. Resolve Eta vs Nunjucks (P0-#2) — single-line change in each affected file.
3. Fill the missing tables in `database-design.md` (P0-#3) so the settings surface is buildable.
4. Address restart-recovery for AI jobs (P0-#4) — design the `ai_jobs` table and re-enqueue-on-boot semantics.
5. Sweep the P1s. Most are one-line or one-paragraph edits; several I can apply directly on request (`/api/artifact` removal, camelCase↔snake_case pick, duplicate section renumbers, model-name fix).
6. Work the P2 backlog as the relevant feature slices come up.
