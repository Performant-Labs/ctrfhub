# AUTH-001 Remediation — bounce-back from spec-audit

**Audit verdict (`spec-audit.md`):** BLOCK — three blockers, two of which required human decisions. Argos has resolved both. Below is the actionable list.

**Stay on `story/AUTH-001`.** Don't open a new branch; commit the fixes on top of your existing work. After all blockers + NITs are addressed, append to `feature-handoff.md` (or write `feature-handoff-v2.md`) noting what changed, then hand back for re-audit.

---

## Blocker 1 — HTMX status code resolution: **200 wins**

**Decision:** `tasks.md` is the authoritative spec (per `CLAUDE.md` § "docs/planning/* is the authoritative spec"). It says **200 with `HX-Redirect: /login`**. The skill file (`skills/better-auth-session-and-api-tokens.md` line 30) had drifted to "401" — that's wrong; Argos's mistake. The skill gets corrected as part of your remediation.

**Why 200 not 401:** HTMX consumes `HX-Redirect` cleanly on 2xx responses. On 4xx, HTMX's default behavior is to NOT swap the response body, requiring extra `hx-on::after-request` handling for the redirect. 200 is the canonical HTMX-friendly pattern.

**Files to change:**

| File | Line(s) | Change |
|---|---|---|
| `src/app.ts` | ~416 | `reply.status(401).send()` → `reply.status(200).send()` (HTMX branch only — keep the non-HTMX 302 redirect path as is) |
| `src/app.ts` | ~411–412 | Inline comment already says "NOT 401" — leaves it correct after code fix |
| `src/app.ts` | ~328 (NIT #3) | Stale TODO comment "Bearer API key" → "`x-api-token` API key" |
| `src/__tests__/integration/auth.test.ts` | ~357 | Assertion that expects 401 on HTMX missing-auth → expect 200 instead. Confirm the assertion of `HX-Redirect: /login` response header still holds. |
| `skills/better-auth-session-and-api-tokens.md` | line 30 | Change "+ 401" → "+ 200". Add a one-line rationale: "200 (not 401) so HTMX consumes `HX-Redirect` cleanly without `hx-on::after-request` handling." |

---

## Blocker 2 — Better Auth schema: **automate via `runMigrations()` in `buildApp()`**

**Decision:** Option (a). Generate the schema, commit it, and wire `auth.$context.runMigrations()` into the production startup path so a fresh DB Just Works.

**Steps:**

1. From `~/Projects/ctrfhub` on `story/AUTH-001`, run:
   ```bash
   npx better-auth generate
   ```
   This emits Better Auth's user/session/account/verification/apikey schema files. Note the output path the CLI uses.

2. Commit the generated files. Recommended location: alongside the existing entity barrel — either `src/entities/auth-schema.ts` (single file if the CLI emits one) or `src/auth-schema/` (directory if multiple). Whatever the CLI's idiomatic output is. **Don't hand-edit the generated files** — if you need to customize, configure Better Auth to emit different output rather than patching downstream.

3. In `src/app.ts` (or wherever the `buildApp()` startup sequence lives), after `orm.migrator.up()`, add:
   ```typescript
   await auth.$context.runMigrations();
   ```
   This is the same call your test fixture (`seedAuthSchema()`) already makes — you're hoisting it from the test path into production startup.

4. Verify the existing integration tests still pass (no regression):
   ```bash
   npm test
   ```
   The `seedAuthSchema()` fixture's call becomes redundant once `buildApp()` runs migrations natively; that's fine — keep it for now (idempotent), and leave a TODO to remove it as cleanup in a future story.

5. Manual deploy verification (optional but recommended): blow away `~/Projects/ctrfhub/data/dev.db` (or whatever your local SQLite path is), run `npm run dev`, hit `/api/auth/sign-up/email` → confirm Better Auth's tables exist + the request succeeds end-to-end against a truly empty DB.

---

## Blocker 3 — Test coverage gap: assert `request.apiKeyUser` is populated

**Decision:** Add a focused test. Direct test-only route is the cleanest path.

**Steps:**

1. In your integration test fixture (or `auth.test.ts` itself), register a tiny test-only route on the `buildApp()` instance:
   ```typescript
   app.get('/__test__/whoami', { config: { skipAuth: false } }, async (request) => ({
     apiKeyUser: request.apiKeyUser ?? null,
     user: request.user ?? null,
   }));
   ```

2. Add a test that:
   - Creates an API key via `auth.api.createApiKey({ name, metadata: { projectId: '<some-uuid>' }, userId: '<seeded-user-id>' })`
   - Sends `GET /__test__/whoami` with `x-api-token: <ctrf_*>`
   - Asserts the response body includes `apiKeyUser.id`, `apiKeyUser.referenceId`, and `apiKeyUser.metadata.projectId === '<some-uuid>'`

3. The test-only route is fine to leave registered in the test fixture (not in production code). If you'd rather keep it out of `buildApp()`'s real signature, register it via `app.register(...)` after the factory call inside the test file — same effect.

---

## NITs (fix in same pass)

- **NIT #3:** Stale `Bearer API key` comment in `src/app.ts:328` → already covered as part of Blocker #1's file changes (table above).
- **NIT #4:** Inline comment at `src/app.ts:411–412` says "NOT 401" but code sends 401 → auto-resolved when Blocker #1 lands.
- **Coverage NIT:** Tests landed in single `auth.test.ts` instead of the four files I named in the brief — purely organizational, **no fix required**. Functionally equivalent. The brief's file split was a suggestion, not a hard requirement.

---

## What stays as-is (no change)

The audit flagged 16 of 16 forbidden-pattern checks ✓ and 11 of 13 planning-doc conformance items ✓. The remaining 2 are the two BLOCKING items (HTMX status, Better Auth schema). Everything else is good — apiKey plugin config, `defaultPrefix: 'ctrf_'`, `disableKeyHashing` defaults, `skipAuth: true` on `/health` and `/api/auth/*`, session via `auth.api.getSession()` (no raw cookie reading), `request.em` not `fastify.orm.em`, no raw token logging, all `afterAll(() => app.close())` calls present.

---

## Process

1. Make the changes (Blockers 1, 2, 3 + NIT #3 — all bundled in remediation).
2. `npm test` must be green before you stop.
3. Commit each fix as a separate logical commit with `feat(AUTH-001): …`, `fix(AUTH-001): …`, `test(AUTH-001): …`, or `refactor(AUTH-001): …`.
4. Append a "Remediation pass" section to `.argos/AUTH-001/feature-handoff.md` (or write `feature-handoff-v2.md`) summarizing what changed, with one bullet per blocker resolved.
5. Hand back to André so Argos can re-run the spec-audit. If verdict is PASS, Argos closes out + opens the PR.

## Notes from Argos

- **The skill correction is yours to land.** Including it in this branch's commits keeps the fix tied to the story that surfaced the bug. Use `fix(AUTH-001): correct skills/better-auth-session-and-api-tokens.md HTMX status (401 → 200)` as the commit message so the rationale is explicit. Same approach as PR #14 (skill correction landing alongside the spec drift it surfaced).
- **No need to update `tasks.md`** — it was right all along. Your commit just brings the implementation into alignment with what tasks.md already specified.
- **Test count target:** the audit reported tests in `auth.test.ts`. Adding the `__test__/whoami` test should bring you up by 1-2 more. Confirm the suite still completes in a reasonable time after the additions.
- **Better Auth's CLI may write to a directory you don't expect.** If `npx better-auth generate` outputs to e.g. `auth-schema/` at repo root, leave it there but note the location in your handoff. Argos will decide if it should move into `src/` for consistency in a follow-up cleanup.
