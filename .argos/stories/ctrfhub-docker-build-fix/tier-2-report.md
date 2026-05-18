# Tier 2 / 2.5 / 3 Applicability Note — ctrfhub-docker-build-fix

**Executed:** 2026-05-17 19:18
**Determination:** Tiers 2, 2.5, and 3 are **N/A** for this story. Reasoning below.

## Why no T2 / T2.5 / T3

The Three-Tier Verification Hierarchy escalates T1 → T2/T2.5 → T3 for
**UI-touching stories** — stories that add or change a *rendered route* whose
accessibility tree (T2/T2.5) and pixels (T3) need verification.

This story (`ctrfhub-docker-build-fix`) adds **no new rendered route and
changes no existing rendered template**. The full diff against `main` touches
exactly two production files:

- **`Dockerfile`** — build-infrastructure only: builder-stage `COPY`/`npm ci`
  reordering (Bug 1), a `cp -r src/assets/. dist/assets/` asset-bridging step
  (Bug 2), and runner-stage `--ignore-scripts` + `npm rebuild better-sqlite3`.
  None of this renders HTML.
- **`src/app.ts`** — a single additive Branch 0 early-`return` in the global
  `onRequest` auth hook so `/assets/*` requests bypass auth. This changes
  *static-asset serving*, not any rendered page. `@fastify/static` serves
  raw file bytes (JS/CSS) — there is no accessibility tree and no visual
  layout to screenshot for a `.js` or `.css` response.

No `.eta` template, no `src/views/` file, and no route handler that calls
`reply.page()` / `reply.view()` is in the diff. A's iteration-1 architecture
review confirms the same scope: "The diff touches exactly `Dockerfile` and
`src/app.ts` (plus the two `.argos/` story docs)."

### T2 (clean-room ARIA) — N/A

There is no unauthenticated *rendered route* introduced or changed. The only
new behavior on an unauthenticated path is `/assets/*` serving static files,
which has no ARIA structure. The story brief declares no `tasks.md` tier
requirement (standalone bug-fix).

### T2.5 (authenticated ARIA) — N/A

No authenticated rendered route is introduced or changed. The auth-hook edit
is verified structurally at T1 via `fastify.inject()` integration tests
(`static-asset-auth-bypass.test.ts`), which is the correct tier for an
HTTP-contract / auth-precedence change — it asserts status codes, headers,
and redirect behavior, none of which require a browser.

### T3 (visual sign-off) — N/A

T3 verifies spacing, color, and alignment of a *rendered design slice*. No
rendered slice changed. The vendored client JS now *loading* (criterion 3)
is a prerequisite for the existing UI to behave, but the UI itself — its
templates, layout tokens, and visual design — is untouched by this diff.
There is nothing new to screenshot. The relevant existing T1 coverage of the
layout's script/asset references already lives in
`src/__tests__/integration/layout.test.ts`.

## Backdrop-contrast WCAG re-check — N/A

No trigger applies: no layout-token change, no `position`/`z-index` change,
no `[data-theme]` zone move, no background swap, no `@layer components`
surface change. The diff contains no CSS and no template edits.

## Verdict

**N/A — non-UI story.** T1 (headless: Docker build/run + `fastify.inject()`
auth-bypass tests) is the complete and correct verification surface. Proceed
to test-handoff.
