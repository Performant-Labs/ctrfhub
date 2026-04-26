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
**Status:** ✅ **Resolved** — `chore(spec): align ingest auth + endpoint references with product.md`. project-plan.md L63 reworded to match `product.md §Feature 4` (artifacts co-uploaded with the run; no separate `/api/artifact`). Same PR also fixed the parallel drift on L70 (`Authorization: Bearer` → `x-api-token`, `/api/ingest` → `/api/v1/projects/:slug/runs`) and the long-standing inconsistency in `skills/better-auth-session-and-api-tokens.md` flagged by the joint INFRA-001/002/004 spec-audit Finding #2.

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
**Status:** ✅ **Resolved** — `ai-features.md` line 47 already shows the correct model name `claude-haiku-4-5-20251001`; the fix was applied to the doc prior to this gaps.md status flip and the Open status was stale. Confirmed during AI-001 brief preparation (2026-04-25).

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

### G-P1-006 — `RETENTION_CRON_SCHEDULE` default differs between architecture.md and deployment-architecture.md
**Source:** Surfaced by CI-002 spec-audit (2026-04-25), Finding #2
**Affects:** CI-002 `.env.example`, retention cron implementation (future story), any deployer reading either doc
**Question:** `architecture.md` line 261 documents the default as `0 2 * * *` (02:00 UTC). `deployment-architecture.md` line 233 documents the default as `0 3 * * *` (03:00 UTC) and includes a rationale paragraph about UTC trigger time vs org-TZ cutoff calculation.
**Canonical source:** `architecture.md` line 272 explicitly declares `deployment-architecture.md §Environment variables` the canonical list. CI-002's `.env.example` follows the canonical source (`0 3 * * *`).
**Required action:** Reconcile `architecture.md` line 261 to match `deployment-architecture.md` line 233 (`0 3 * * *`), or — if `architecture.md`'s 02:00 was the intended value — flip it on the deployment-architecture side and update `.env.example` in a follow-up. Either way, both docs should agree and the rationale paragraph should sit with the canonical entry.
**Status:** Open — Argos surfaces, André to decide which value is correct. Implementation in CI-002 not blocked.

---

### G-P1-007 — `run.ingested` vs `run.created` event-name reconciliation
**Source:** Surfaced by CTRF-002 spec-audit (2026-04-25); feature-implementer also flagged in handoff
**Affects:** CTRF-002 (current), AI-002 (subscribes to `run.ingested`), SSE-001 (publishes UI updates), and any future story emitting or consuming run lifecycle events
**Question:** `tasks.md §CTRF-002`, `product.md §Feature 1`, `architecture.md §350`, and `ai-features.md §A1` all use **`run.ingested`** (the AI pipeline trigger). `testing-strategy.md §Example` line 159 and `database-design.md §SSE` line 1076 use **`run.created`** for the SSE UI notification stream. CTRF-002 ships `run.ingested` per the canonical sources.
**Required action:** Decide whether these are (a) the same event under inconsistent names — in which case the SSE/testing-strategy references should be normalized to `run.ingested` — or (b) two distinct events: one for the AI pipeline trigger (`run.ingested`) and one for SSE UI updates (`run.created`). If (b), CTRF-002 needs a follow-up commit adding a `RunEvents.RUN_CREATED` constant and a second `eventBus.publish()` call; if (a), update the two stale references and close.
**Status:** ✅ **Resolved** — `chore(spec): normalize run.created → run.ingested across testing-strategy.md and database-design.md` (PR #26). André chose option (a) on 2026-04-25: MVP has no streaming-aggregation use case, so `run.ingested` is the canonical name across the AI pipeline trigger, the SSE notification stream, and integration-test fixtures. `parking-lot.md`'s `run.created` reference is preserved for the post-MVP streaming feature where the name may diverge again.

---

### G-P1-008 — DD-012 / DD-019 token model assumes a `project_tokens` table that does not exist
**Source:** Surfaced by CTRF-002 feature-handoff decisions (1) and (2) (2026-04-25)
**Affects:** Future token-management UI (likely SET-001 / project settings tab), CTRF-002's deferred `?on_duplicate=replace|error` modes, any rate-limit-by-token surface
**Question:** DD-012 specifies per-token rate limits via `project_tokens.rate_limit_per_hour`; DD-019 specifies `?on_duplicate=replace|error` modes gated on `ingest:replace` permission bits on tokens. Both designs assume a `project_tokens` table that doesn't exist. AUTH-001 established Better Auth's `apikey` table as the canonical token store, with metadata in `apikey.metadata` (JSON). CTRF-002 simplified to a global 120 req/hour keyed on the `x-api-token` header value, and deferred the `?on_duplicate=` modes entirely.
**Required action:** When the token-management UI story is designed (likely as part of SET-001 project settings, or a dedicated token-management story), confirm whether per-token limits and permissions live in `apikey.metadata` (JSON shape to be defined), in a new dedicated `project_tokens` table, or in some hybrid. Then: rewire CTRF-002's `keyGenerator` to read from the agreed source, and unblock the deferred `?on_duplicate=` modes by adding the corresponding permission check.
**Status:** ✅ **Resolved** — `chore(spec): align DD-012/DD-019/§4.20/SET-001 with Better Auth apikey as canonical token store` (PR #27). André chose option (b′) on 2026-04-25: per-token policy (rate limits, permissions) inlines into `apikey.metadata` JSON; `project_tokens` table marked DEPRECATED. CTRF-002's keyGenerator wiring (read `metadata.rateLimit?.perHour`) is a small future follow-up; SET-001's eventual brief picks up the token-management UI implementation.

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
**Status:** ✅ **Partially Resolved** — schema-side fix landed in CTRF-001 (`CtrfStatusSchema` includes `'other'`; tests guard against regression at test level, retry-attempt level, and step level — see `.argos/CTRF-001/spec-audit.md`). The `test_runs.other` counter rollup remains for CTRF-002 (ingest route + service); will close fully when that lands.

---

## How to use this file

- **Before starting any story:** Check whether the story ID appears in the "Affects" field of any P0 or unresolved P1 item above.
- **If a P0 gap affects your story:** Halt and document the blocker in the handoff note. Do not guess.
- **If a P1 gap affects your story:** Use `docs/planning/product.md` or `docs/planning/architecture.md` as the authoritative source over the conflicting doc. Flag the conflict in the handoff note.
- **Closing a gap:** When a human reviewer resolves a gap, mark it `✅ Closed` with the resolution. Do not remove P0 items until they are closed.
