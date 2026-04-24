# CTRFHub — Open Planning Gaps

Sourced from `docs/planning/gap-review-merged.md`. Items that require human decision before implementation can proceed safely.

Severity: **P0** = blocks implementation; **P1** = factual error / contradiction; **P2** = undesigned surface; **P3** = nit.

---

## P0 — Blockers (human approval required before implementing affected stories)

### G-P0-001 — Tailwind 4 + Flowbite ↔ `[data-theme]` integration undefined
**Source:** `gap-review-merged.md #1`
**Affects:** Any story that renders UI with themed colors (DASH-001 and later)
**Question:** `architecture.md` specifies Tailwind 4 CSS-first `@theme`; `theme-design.md` uses `[data-theme="midnight|slate|dim|cloud|warm|sky"]` CSS custom properties with no mention of Tailwind. How do these compose?
- Does `@theme` define default token values and `[data-theme]` overrides them at runtime?
- Do Tailwind utilities like `bg-[--color-brand]` automatically pick up `[data-theme]` overrides?
- Should `[data-theme]` selectors be in `input.css` or a separate theme file?
**Proposed resolution:** `@theme` defines defaults; `[data-theme]` selectors override the same `--color-*` variables at runtime. No Tailwind rebuild required for theme switching. `input.css` hosts both blocks.
**Status:** Proposed (needs human sign-off before DASH-001 starts)

---

### G-P0-002 — Template engine: Eta vs Nunjucks conflict
**Source:** `gap-review-merged.md #2`
**Affects:** INFRA-003 and every story with HTML templates
**Question:** `architecture.md` specifies Eta; `deployment-architecture.md` references Nunjucks; `parking-lot.md` references a `.njk` file.
**Required action:** Confirm Eta is the winner. Purge all `.njk` and Nunjucks references from `deployment-architecture.md` and `parking-lot.md`.
**Status:** Awaiting human confirmation. Infrastructure assumes Eta — do not start INFRA-003 until confirmed.

---

### G-P0-003 — Missing DB table schemas for settings surface
**Source:** `gap-review-merged.md #3`
**Affects:** SET-001, SET-002, SET-003
**Question:** `settings-architecture.md §New DB Tables Required by Settings` lists 29 tables. Several (`user_notification_preferences`, `sso_configurations`, `project_custom_field_settings`) are named but lack column definitions in `database-design.md`.
**Required action:** Human reviewer must fill in column definitions for the three tables before Set-003 and SET-002 can be implemented.
**Status:** Blocked — cannot design migrations without schema.

---

### G-P0-004 — AI pipeline restart-recovery semantics
**Source:** `gap-review-merged.md #4`
**Affects:** AI-002, AI-003
**Resolution:** RESOLVED in `ai-features.md §Durability and restart recovery` — the `ai_pipeline_log` table with reserve-execute-commit pattern and boot-time recovery query is the canonical design. This gap is now closed.
**Status:** ✅ Closed — implementation can proceed.

---

## P1 — Factual Errors (fix in docs before implementing affected code)

### G-P1-001 — `/api/artifact` reference in project-plan.md L63
**Source:** `gap-review-merged.md #5`
**Affects:** CTRF-003
**Fix:** Delete the line "via `/api/artifact`" from `project-plan.md`. The authoritative spec (`product.md §Feature 4`) is clear: no separate artifact endpoint.
**Status:** Open — doc fix needed (does not block CTRF-003, which uses `product.md` as spec)

---

### G-P1-002 — `userSettings.darkTheme` camelCase vs `dark_theme` snake_case in theme-design.md
**Source:** `gap-review-merged.md #6`
**Affects:** SET-003 (personal settings theme toggle)
**Fix:** Pick one convention (recommend `dark_theme` snake_case to match SQL column naming) and fix the other.
**Status:** Open

---

### G-P1-003 — Wrong Anthropic model name `claude-haiku-3-5`
**Source:** `gap-review-merged.md #8`
**Fix:** Replace with `claude-haiku-4-5-20251001` (Haiku 4.5). In `ai-features.md` default models table.
**Status:** Open — fix before AI-001

---

### G-P1-004 — SSE path inconsistency
**Source:** `gap-review-merged.md #11`
**Affects:** SSE-001
**Fix:** Pin SSE endpoint to `/org/:orgId/events` (used in `settings-architecture.md §System`). Remove the `/org/:id/settings/events` variant.
**Status:** Open — fix before SSE-001

---

### G-P1-005 — `MAX_PAYLOAD_SIZE=10mb` vs 100 MB video uploads
**Source:** `gap-review-merged.md #13`
**Fix:** Document the split: `MAX_PAYLOAD_SIZE` applies to the JSON body only; artifact file parts bypass this limit and are governed by the per-file size limits table in `product.md §Feature 4`.
**Status:** Open

---

## P2 — Missing Surface Area (document before implementing the affected feature)

### G-P2-001 — Custom Fields API routes undesigned
**Source:** `gap-review-merged.md #14`
**Affects:** SET-001 (if custom fields are in scope; deferred to later sprint per task backlog)
**Status:** Deferred — not in MVP task backlog

---

### G-P2-002 — Per-user Slack DM notification: no OAuth design
**Source:** `gap-review-merged.md #15`
**Affects:** SET-003 (notifications tab shows Slack DM column hidden until PL-009)
**Status:** Deferred per `settings-architecture.md §1.3` — Slack DM column is hidden in MVP

---

### G-P2-003 — AI Settings operational surface
**Source:** `gap-review-merged.md #16`
**Affects:** AI-004 and beyond
**Items needed:** provider status card, token-consumption meter (rolling 30-day from `ai_pipeline_log`), per-feature enable/disable (A1…A5), BYOK override for Business Edition
**Status:** Partially addressed by `ai-features.md §Privacy and consent` (two-gate consent model). Full UI design needed before AI-004 can implement the settings tab.

---

### G-P2-004 — CTRF `other` status unhandled
**Source:** `gap-review-merged.md #27`
**Affects:** CTRF-001, CTRF-002
**Fix needed:** `CtrfReportSchema` must accept `status: 'other'`; `test_runs.other` counter must be incremented during rollup.
**Status:** Addressed in CTRF-001 acceptance criteria — implementer must handle `other` status.

---

## How to use this file

- **Before starting any story:** Check whether the story ID appears in the "Affects" field of any P0 or unresolved P1 item above.
- **If a P0 gap affects your story:** Halt and document the blocker in the handoff note. Do not guess.
- **If a P1 gap affects your story:** Use `docs/planning/product.md` or `docs/planning/architecture.md` as the authoritative source over the conflicting doc. Flag the conflict in the handoff note.
- **Closing a gap:** When a human reviewer resolves a gap, mark it `✅ Closed` with the resolution. Do not remove P0 items until they are closed.
