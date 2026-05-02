# Tier 1 Headless Report — INFRA-003

**Executed:** 2026-05-02 04:07
**Method:** `fastify.inject()` + template source analysis (no browser)

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
| 12 | Template source: viewport meta tag | fs.readFileSync analysis | `content="width=1280"` | present | ✓ |
| 13 | Template source: viewport inside <head> | fs.readFileSync analysis | contained in `<head>` | inside `<head>` | ✓ |
| 14 | Template source: tailwind.css before scripts | string index comparison | cssIndex < scriptIndex | 0 < 458 | ✓ |
| 15 | Template source: htmx → idiomorph order | string index comparison | htmxIndex < idiomorphIndex | 570 < 678 | ✓ |
| 16 | Template source: idiomorph → alpine order | string index comparison | idiomorphIndex < alpineIndex | 678 < 838 | ✓ |
| 17 | Template source: alpine → flowbite order | string index comparison | alpineIndex < flowbiteIndex | 838 < 897 | ✓ |
| 18 | Template source: flowbite → app.js order | string index comparison | flowbiteIndex < appIndex | 897 < 1001 | ✓ |
| 19 | Template source: alpine has defer | line grep | contains `defer` | present | ✓ |
| 20 | Template source: app.js has type="module" | line grep | contains `type="module"` | present | ✓ |
| 21 | Template source: html lang="en" | string contains | `html lang="en"` | present | ✓ |
| 22 | Template source: hx-ext="morph" on body | string contains | `hx-ext="morph"` | present | ✓ |
| 23 | Template source: charset UTF-8 | string contains | `charset="UTF-8"` | present | ✓ |
| 24 | Partial template via `reply.view()` (error.eta) | `app.inject({ url: '/setup/__test__/partial' })` | 200 + role="alert" | 200 + role="alert" | ✓ |
| 25 | Partial does not wrap in `<html>` | assert body does NOT contain `<html` | no `<html>` | no `<html>` | ✓ |
| 26 | `reply.page()` HTMX partial path (error.eta) | `inject({ headers: { 'HX-Request': 'true' } })` | 200 + error content | 200 + error content | ✓ |
| 27 | `reply.page()` partial: no `<html>` wrapper | assert body does NOT contain `<html` | no `<html>` | no `<html>` | ✓ |
| 28 | `reply.page()` partial: no `<head>` element | assert body does NOT contain `<head>` | no `<head>` | no `<head>` | ✓ |
| 29 | `reply.page()` full page (no HX-Request) | `inject({ url: '/setup/__test__/page' })` | 200 with layout | **500** — includeFile bug | ✗ |
| 30 | `layouts/main.eta` via `reply.view({ async: true })` | `inject({ url: '/setup/__test__/layout' })` | 200 | **500** — "includeFile is not defined" | ✗ |

## Blocking issues (full page rendering)

1. **`src/views/layouts/main.eta:28` — `includeFile` used (EJS-only) instead of Eta's `include` or `includeAsync`:** Eta 3.5.0 provides `include` (sync) and `includeAsync` (async). `includeFile` is not available. Verified via Node REPL test: `includeFile` → "includeFile is not defined", `include` → works, `includeAsync` → works (returns Promise). **Fix:** Replace `await includeFile(...)` with `include(...)` or `await includeAsync(...)`.

2. **`src/app.ts:270` — `reply.page()` doesn't pass `{ async: true }` to `this.view()`:** When the template uses async includes, the Fastify view call needs `{ async: true }`. **Fix:** Change to `this.view('layouts/main', { body: template, ...data }, { async: true })`.

3. **No route registered using `reply.page()`:** The decorator, layout template, and `pages/home.eta` exist but no route calls `reply.page('home', ...)`. The decorator's HTMX branching logic is verified via test routes, but there is no production route.

## Verdict

**PARTIAL PASS** — 28/30 checks pass. Static assets, security headers, template source assertions (viewport meta, script order), and `reply.page()` HTMX partial branching all pass. Full-page layout rendering is blocked by the `includeFile` bug (#29, #30) and missing `{ async: true }` in the decorator. Proceed to T2/T3 using the e2e test server workaround (which bypasses the broken layout template).
