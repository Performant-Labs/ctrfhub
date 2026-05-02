# Test Handoff — INFRA-003

**Branch:** `story/INFRA-003`

## Tier summary

| Tier | Status | Report |
|---|---|---|
| T1 Headless | PASS (partial — static assets, security headers, partial template) | `.argos/INFRA-003/tier-1-report.md` |
| T2 ARIA (clean room) | PASS | `.argos/INFRA-003/tier-2-report.md` |
| T2.5 Authenticated State | N/A — route is unauthenticated (home page), see T2 | `.argos/INFRA-003/tier-2-5-report.md` |
| T3 Visual | PASS (structural assertions; screenshots blocked) | `.argos/INFRA-003/tier-3-report.md` |
| Backdrop-contrast | N/A — no layout-token/backdrop changes in scope | inline in T2 report |

## Tests added

| Layer | Files | Tests | Notes |
|---|---|---|---|
| Integration | `src/__tests__/integration/layout.test.ts` | 30 | Static assets, security headers, partial template via `reply.view()` and `reply.page()` (HTMX path), known-bug documentation |
| E2E | `e2e/tests/layout.spec.ts` | 7 (×2 viewports = 14 runs) | T2 structural ARIA, T3 narrow-smoke and baseline |
| E2E infra | `e2e/test-server.ts` | — | Test server with seeded user, serves `pages/home.eta` via `eta.render()` |

## Blocking issues requiring Feature-implementer fix

1. **`src/views/layouts/main.eta:28` — `includeFile` used instead of Eta's `includeAsync`:**
   `await includeFile('pages/' + it.body + '.eta', it)` should be `await includeAsync('pages/' + it.body + '.eta', it)`. Eta v3 provides `include` and `includeAsync`; `includeFile` is an EJS function that doesn't exist. This blocks all full-page layout rendering.

2. **`src/app.ts:270` — `reply.page()` decorator doesn't pass `{ async: true }` to `this.view()`:**
   The decorator calls `this.view('layouts/main', data)` without opts. Must be `this.view('layouts/main', data, { async: true })` to enable async template rendering (needed for `await includeAsync(...)`).

3. **No route registered using `reply.page()`:**
   The decorator, layout template, and `pages/home.eta` exist but no route calls `reply.page('home', ...)`.

## Non-blocking issues

- `src/views/partials/home.eta` does not exist (HTMX partial for home page). The `error.eta` partial was verified to work correctly via both `reply.view()` and `reply.page()` with `HX-Request: true`.

## Coverage (from `npm run test:coverage`)

Not computed — coverage thresholds are project-level and INFRA-003 does not add application code.

## Next action (Spec-enforcer)

1. Open a new session. Paste `.antigravity/agents/spec-enforcer.md` as the first message, then this handoff as the second.
2. Check out `story/INFRA-003`.
3. Run the Audit Checklist and write the verdict to `.argos/INFRA-003/spec-audit.md`.
