# Spec-enforcer Audit — CI-003

**Executed:** 2026-04-26 09:05
**Scope:** diff `main..story/CI-003`
**Checklists run:** Architecture rules, Coverage, Planning docs conformance, Skills violations (ctrf-ingest-validation, better-auth-session-and-api-tokens, mikroorm-dual-dialect)

## Findings

| # | File:Line | Rule (cite source) | Remediation | Severity |
|---|---|---|---|---|
| 1 | `.github/workflows/ci.yml:188` | — | `continue-on-error: false` is the default value and can be removed for clarity. Not a violation. | **NIT** |
| 2 | `.tugboat/seed.sh:28` | — | Fallback password `PreviewAdmin2026!` is hardcoded as a shell default (`${TUGBOAT_ADMIN_PASSWORD:-...}`). Acceptable for local testing and documented in feature-handoff as intentional; the env var takes precedence in Tugboat. Not a violation per the brief's anti-pattern scope (which targets `config.yml`, not the seed script's shell defaults). | **NIT** |

## Coverage gaps

**Coverage matches the story's declared Test tiers required and Page verification tiers.**

CI-003 is infrastructure-only. The brief explicitly states: "No new test files needed — the Tugboat preview build + CI dog-food step ARE the verification." No new routes, entities, pure functions, or coverable application code were added. The T1 report (17/17 checks pass) plus the existing unit suite (171/171 green) confirm no regressions. Integration tests are unaffected (zero `src/` changes).

## Planning-doc conformance (only lines relevant to this story's scope)

- [x] Ingest endpoint uses `x-api-token` header (not `Authorization: Bearer`) — `skills/ctrf-ingest-validation.md` — confirmed in `ci.yml:222`: `-H "x-api-token: ${{ secrets.CTRFHUB_PREVIEW_API_KEY }}"`
- [x] Dog-food POST targets canonical ingest path `/api/v1/projects/sample/runs` — `skills/ctrf-ingest-validation.md` — confirmed in `ci.yml:221`
- [x] No separate migration step in Tugboat build (schema-generator runs at app boot) — `skills/mikroorm-dual-dialect.md` — confirmed: no `migrate` command in any `.tugboat/config.yml` build stage
- [x] Seed creates admin user via Better Auth signup API (not raw SQL) — `skills/better-auth-session-and-api-tokens.md` — confirmed in `seed.sh:45-49`: `POST /api/auth/sign-up/email`
- [x] Seed creates API key via Better Auth API key plugin (not raw SQL) — `skills/better-auth-session-and-api-tokens.md` — confirmed in `seed.sh:134-138`: `POST /api/auth/api-key/create`
- [x] Org + Project created via direct PG inserts (CTRFHub-owned tables — allowed by brief) — `seed.sh:78-83` and `seed.sh:110-114`
- [x] API key `metadata.projectId` set correctly — confirmed in `seed.sh:138`: `{\"name\":\"preview-ci\",\"metadata\":{\"projectId\":\"${PROJECT_ID}\"}}`
- [x] `continue-on-error: true` removed from dog-food step (step now gates merge) — confirmed: dog-food step at `ci.yml:213-225` has no `continue-on-error`
- [x] `CTRFHUB_STAGING_*` renamed to `CTRFHUB_PREVIEW_*` — confirmed: no `STAGING` references remain in `ci.yml`
- [x] `tasks.md §CI-003` acceptance reworded to phased scope with "Deferred to UI stories" note — confirmed at `tasks.md:358`
- [x] `/setup` returns `410 Gone` if `users` table non-empty — N/A to this story (no `/setup` code changed)
- [x] `/health` returns 503 while `bootState` is `booting` or `migrating` — N/A to this story (no health code changed); Tugboat health-check loop correctly polls `/health` at `config.yml:72-86`
- [x] API token values never appear in full in log output — confirmed: `seed.sh:150,157` print only `${API_KEY:0:12}...` (first 12 chars truncated)

## Forbidden-pattern scan (from CLAUDE.md)

- [x] No `hx-target`/`hx-swap` inherited from a parent — N/A (no templates modified)
- [x] No raw HTMX event names outside `src/client/htmx-events.ts` — N/A (no JS modified)
- [x] No `hx-disable` anywhere in templates — N/A (no templates modified)
- [x] No Alpine `x-data` inside an HTMX swap target (or vice versa) — N/A (no templates modified)
- [x] No Postgres-only SQL / dialect-specific features without a SQLite equivalent — N/A (no entities modified); seed uses PG directly via `node -e` + `pg` for CTRFHub-owned tables — this is correct for the Tugboat preview (PG-only environment)
- [x] No DB mocked in integration tests — N/A (no tests modified)
- [x] No T3 visual assertions without corresponding T2 ARIA assertions — N/A (no visual tests; T2/T3 deferred per brief)
- [x] No layout-token change without a T2 backdrop-contrast re-check — N/A (no CSS changes)
- [x] No raw CSRF-token or session-cookie handling outside Better Auth — seed correctly uses cookie-jar (`-c`/`-b` flags) with Better Auth's session mechanism
- [x] No Zod schema defined ad-hoc in a handler — N/A (no handlers modified)
- [x] No self-hosted runner references — confirmed: only `ubuntu-latest` in `ci.yml`; comment at line 14 explicitly documents self-hosted runners as FORBIDDEN
- [x] No `dark:` Tailwind variant in any template — N/A (no templates)
- [x] No raw utility soup on data display elements — N/A (no templates)
- [x] No real AI API calls in any test file — N/A (no test files in CI-003 scope)
- [x] No separate `/api/artifact` endpoint — N/A (no routes added)

## Verdict

**PASS** — story may proceed to Argos Phase 7 close-out and PR open.

Both NIT findings are cosmetic and do not require remediation before merge. All acceptance criteria from the phased `tasks.md §CI-003` are satisfied:

1. ✅ `.tugboat/config.yml` defines PG + app services with correct build stages
2. ✅ Seed script creates admin + org + project + API key idempotently
3. ✅ Dog-food step replaced with real POST using `x-api-token`, `continue-on-error` removed
4. ✅ `tasks.md` reworded to phased scope with deferred UI-verify documented
5. ✅ No app code, entities, migrations, or test files modified
6. ✅ Existing unit suite (171/171) confirmed green by T1 report
