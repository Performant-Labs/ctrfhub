# Tier 1 Headless Report — INFRA-003

**Executed:** 2026-05-02 03:54
**Method:** `fastify.inject()` (no browser, no JS execution)

## Checks

| # | What is being verified | Command | Expected | Actual | Status |
|---|---|---|---|---|---|
| 1 | Static asset: tailwind.css | `app.inject({ url: '/assets/tailwind.css' })` | 200 + text/css | 200 + text/css | ✓ |
| 2 | Static asset: htmx.min.js | `app.inject({ url: '/assets/htmx.min.js' })` | 200 + javascript | 200 + javascript | ✓ |
| 3 | Static asset: idiomorph-ext.min.js | `app.inject({ url: '/assets/idiomorph-ext.min.js' })` | 200 | 200 | ✓ |
| 4 | Static asset: alpine.min.js | `app.inject({ url: '/assets/alpine.min.js' })` | 200 + javascript | 200 + javascript | ✓ |
| 5 | Static asset: flowbite.min.js | `app.inject({ url: '/assets/flowbite.min.js' })` | 200 + javascript | 200 + javascript | ✓ |
| 6 | Static asset: app.js | `app.inject({ url: '/assets/app.js' })` | 200 + javascript | 200 + javascript | ✓ |
| 7 | Security: Content-Security-Policy | `res.headers['content-security-policy']` | defined | defined | ✓ |
| 8 | Security: X-Content-Type-Options | `res.headers['x-content-type-options']` | nosniff | nosniff | ✓ |
| 9 | Security: Strict-Transport-Security | `res.headers['strict-transport-security']` | defined | defined | ✓ |
| 10 | Security: Cross-Origin-Opener-Policy | `res.headers['cross-origin-opener-policy']` | same-origin | same-origin | ✓ |
| 11 | Security: X-RateLimit-Limit | `res.headers['x-ratelimit-limit']` | 600 | 600 | ✓ |
| 12 | Partial template via `reply.view()` (error.eta) | `app.inject({ url: '/setup/__test__/partial' })` | 200 + role="alert" | 200 + role="alert" | ✓ |
| 13 | Partial does not wrap in `<html>` | assert body does NOT contain `<html` | no `<html>` | no `<html>` | ✓ |
| 14 | `reply.page()` HTMX partial path (error.eta) | `inject({ headers: { 'HX-Request': 'true' } })` | 200 + error content | 200 + error content | ✓ |
| 15 | `reply.page()` partial: no `<html>` wrapper | assert body does NOT contain `<html` | no `<html>` | no `<html>` | ✓ |
| 16 | `reply.page()` full page (no HX-Request) | `inject({ url: '/setup/__test__/page' })` | 200 with layout | **500** — await includeFile not supported by Eta | ✗ |
| 17 | `layouts/main.eta` via `reply.view()` with `{ async: true }` | `inject({ url: '/setup/__test__/layout' })` | 200 | **500** — "includeFile is not defined" | ✗ |

## Known issues (blocking full page rendering)

1. **`main.eta` uses `includeFile` (EJS) instead of `includeAsync` (Eta):** Eta v3 provides `include` (sync) and `includeAsync` (async) as built-in helpers. `includeFile` is an EJS function that does not exist in Eta. All full-page rendering through the layout is blocked until this is fixed. **Fix:** replace `await includeFile(...)` with `await includeAsync(...)` in `src/views/layouts/main.eta`.

2. **`reply.page()` doesn't pass `{ async: true }` to `this.view()`:** The `page` decorator at `src/app.ts:265` calls `this.view(template, data)` without an opts parameter. Since the layout template uses `await includeAsync(...)`, async mode is required. **Fix:** change `this.view('layouts/main', { body: template, ...data })` to `this.view('layouts/main', { body: template, ...data }, { async: true })`.

3. **No route registered using `reply.page()`:** The `reply.page()` decorator was created but no route calls it. The partial path works (when `partials/error.eta` is used with `HX-Request: true`), but there's no production route using it. **Fix:** Register `GET /` (or a similar route) that calls `reply.page('home', ...)`.

## Verdict

**PARTIAL PASS** — Static assets, security headers, and partial template rendering (via `partials/error.eta`) all pass. Full page layout rendering and `reply.page()` non-HTMX path are blocked by the `includeFile` bug. Proceed to T2/T3 using the test server workaround (which serves the page framework directly via `eta.render()` without the broken layout template).
