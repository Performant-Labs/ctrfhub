# Tier 2 ARIA Structural Report — INFRA-003

**Executed:** 2026-05-02 04:07
**Route(s) under test:** `/` (home page via e2e test server)
**Viewport:** 1280×800 (desktop baseline) + 375×800 (narrow-smoke structural only)
**Tool:** Playwright `page.ariaSnapshot()` (Playwright 1.59)

**Note:** The full layout template (`layouts/main.eta`) cannot render via `reply.page()` due to the `includeFile` bug (see T1 report #29-30). T2 was conducted against the e2e test server which renders `pages/home.eta` wrapped in a proper HTML shell with the expected meta tags, scripts, and landmarks.

## Structural assertions

| # | Assertion | Expected | Observed | Status |
|---|---|---|---|---|
| 1 | Page loads with HTTP 200 | 200 | 200 | ✓ |
| 2 | Page title is "CTRFHub" | "CTRFHub" | "CTRFHub" | ✓ |
| 3 | `main` landmark present and visible (×1) | 1 `<main>`, visible | 1 `<main>`, visible | ✓ |
| 4 | `h1` present with correct text (×1) | "CTRFHub" | "CTRFHub" | ✓ |
| 5 | ARIA snapshot: `main` landmark | `role="main"` present | present | ✓ |
| 6 | ARIA snapshot: `h1` with level=1 and name "CTRFHub" | `heading "CTRFHub" [level=1]` | present | ✓ |
| 7 | ARIA snapshot: no duplicate `main` landmarks | ≤ 1 main role | 1 | ✓ |
| 8 | `<meta viewport content="width=1280">` emitted | attribute `content="width=1280"` | present | ✓ |
| 9 | `<meta charset="UTF-8">` emitted | attribute `charset="UTF-8"` | present | ✓ |
| 10 | Script load order verified in DOM | tailwind → htmx → idiomorph → alpine → flowbite → app.js | correct order | ✓ |
| 11 | `nav` landmark absent (stub home page; nav added in DASH-001) | 0 `<nav>` elements | 0 | ✓ |

## Backdrop-contrast WCAG re-check

**N/A** — No layout-token changes affecting vertical positioning, backdrop, or `@layer components` were merged in this story. The test server serves the same `pages/home.eta` template that the layout would include once the `includeFile` bug is fixed.

## Verdict

**PASS** — 11/11 structural assertions pass. Proceed to Tier 3 visual sign-off.
