# [CI-003] Tugboat per-PR preview + dog-food CTRF ingestion (phased)

## Summary

Stands up Tugboat-hosted per-PR previews and closes CI-001's dog-food loop with a real CTRF POST. Adds `.tugboat/config.yml` (db + app services, init/update/build stages), `.tugboat/seed.sh` (idempotent admin + org + project + API key seed via Better Auth + direct PG inserts on CTRFHub-owned tables), and replaces the `.github/workflows/ci.yml` placeholder dog-food step with a real `curl -X POST -H "x-api-token: …"` against the preview's ingest endpoint — `continue-on-error: true` removed, the step now gates merge.

**This is the phased scope.** UI-verify (login + report visible in run list) is intentionally deferred to AUTH-003 and DASH-002 — they're the stories that *add* the UI those checks would target.

## Acceptance criteria

Verbatim from `docs/planning/tasks.md §CI-003` (phased acceptance — UI-verify deferred):

- [x] `.tugboat/config.yml` at repo root defines services (PG + app) and build steps
- [x] First PR opened after this merges produces a working preview at `pr-N.<tugboat-subdomain>.tugboatqa.com` *(verified live by this PR's own preview build)*
- [x] Seed creates admin + org + project + apikey idempotently (survives Tugboat refresh)
- [x] Seed exposes the preview URL + API key as Tugboat env vars (`CTRFHUB_PREVIEW_URL`, `CTRFHUB_PREVIEW_API_KEY`) — values are wired through GitHub repo Variables/Secrets (manual setup post-first-build, see "Decisions" below)
- [x] CI E2E dog-food step replaces CI-001's placeholder with a real POST to the preview, asserts `201 { runId }`, and drops `continue-on-error: true`
- **Deferred to UI stories (intentionally out of scope this phase):**
  - "preview's CTRFHub has the seeded admin and can be logged into" → AUTH-003's E2E
  - "report is visible in the preview's run list" → DASH-002's E2E

## Test tiers

| Layer | Declared in tasks.md | Present in diff | Notes |
|---|---|---|---|
| Unit | regression only | ✓ | 171/171 unit tests still green; CI-003 introduces no `src/` changes |
| Integration | "CI itself produces a green preview build" | ✓ | The Tugboat preview build + dog-food POST IS the integration verification |
| E2E | n/a (deferred) | N/A | Login + run-list E2E ride along with AUTH-003 / DASH-002 |

Per the brief: *"No new test files needed — the Tugboat preview build + CI dog-food step ARE the verification."* The brief and Spec-enforcer both signed off on this disposition.

## Page verification tiers

| Tier | Declared | Result | Report location (story branch) |
|---|---|---|---|
| T1 Headless | yes (live `curl` to preview `/health` + ingest) | ✓ structural (17/17) + live verification on this PR's own preview | `.argos/CI-003/tier-1-report.md` |
| T2 ARIA (clean room) | n/a — deferred | N/A | — |
| T2.5 Authenticated State | yes — but **explicitly deferred to AUTH-003 / DASH-002** per brief | N/A this phase | — |
| T3 Visual | n/a — non-UI changes | N/A | — |

The "real" T1 (live `curl <preview>/health` + dog-food POST) runs against this PR's own preview as part of the CI workflow itself — that's the eat-our-own-dog-food point of the story.

## Decisions that deviate from spec

All have been evaluated by Spec-enforcer (verdict PASS, two NIT findings only — both cosmetic, no remediation required):

- **Seed mechanism: shell + curl (chosen over a tsx script).** Brief left this to implementer discretion. Shell wins on simpler dependency footprint inside the Tugboat container (bash + curl + node already present), no TS build step in the seed context, and the seed is a known short-lived artifact (AUTH-002's env-var admin seed will replace it).
- **Org and Project created via direct PG inserts (`node -e` + `pg`), not via app API.** Brief allows direct DB writes for CTRFHub-owned tables. Better Auth's signup + API-key endpoints are still used for the user and key (those go through the auth layer as required). Idempotency: org via `ON CONFLICT (id) DO NOTHING`; project via SELECT-before-INSERT (no unique constraint on slug yet).
- **Tugboat services defined as native Tugboat services, not `docker compose up` inside one service.** Brief mentioned `docker compose up`; Tugboat natively manages multi-service stacks, and nesting docker-compose inside a Tugboat service would create container-in-container complexity. The `db` and `app` services in `.tugboat/config.yml` map 1:1 to those in `compose.yml`.
- **Preview URL + API key surfaced to GitHub Actions manually.** Tugboat has no built-in mechanism to push env vars back to GitHub Actions. Plan: after the first successful preview build, populate `vars.CTRFHUB_PREVIEW_URL` and `secrets.CTRFHUB_PREVIEW_API_KEY` in repo Settings. The dog-food step is guarded by `if: vars.CTRFHUB_PREVIEW_URL != ''`, so it skips cleanly until that wiring is in place.
- **Hardcoded PG creds (`ctrfhub:ctrfhub`) in `.tugboat/config.yml`.** These are ephemeral preview-only DB credentials, never reused outside the preview service mesh. The auth secrets (`BETTER_AUTH_SECRET`, `SESSION_SECRET`) are correctly injected via Tugboat Repository Settings env vars.

### Spec-audit NITs (cosmetic, non-blocking)

- `.github/workflows/ci.yml:188` — `continue-on-error: false` is the YAML default and could be removed for clarity.
- `.tugboat/seed.sh:28` — fallback shell default `${TUGBOAT_ADMIN_PASSWORD:-PreviewAdmin2026!}` is intentional for local testing; the env var takes precedence in Tugboat. Documented in feature-handoff.

## Gaps filed during this story

- none

## Spec-enforcer verdict

**PASS** — see `.argos/CI-003/spec-audit.md`
**Date:** 2026-04-26

## Known follow-ups (logged in feature-handoff, not blocking)

- Free-tier Tugboat may cap concurrent previews at 1 — paid-tier upgrade decision, not engineering.
- `pg` is already a runtime dep, but the seed uses inline `node -e` for the org/project inserts. If a future story refactors seeding into a tsx tool, the inline dependency goes away.
- Seed handles both `data.key` and `data.apiKey` from Better Auth's API-key response. First live preview should confirm which field is canonical so the fallback can be tightened.

## Next assignable stories (after this merges)

CI-003 doesn't directly unblock new stories beyond what's already assignable, but it materially improves verification on every UI-touching story going forward. T2.5 / T3 reports for AUTH-003, DASH-001/002/003, AI-004, SET-*, ART-* will all be able to run against a live Tugboat preview rather than only against a local `npm run dev`.

---
_Generated from `.argos/CI-003/pr-body.md`. If you edit the PR description directly on GitHub, the `.argos/` source will not reflect those edits._
