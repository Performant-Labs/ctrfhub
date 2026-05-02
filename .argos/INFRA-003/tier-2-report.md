# Tier 2 ARIA Structural Report — INFRA-003

**Executed:** 2026-05-02 03:54
**Route(s) under test:** `/` (home page via e2e test server)
**Viewport:** 1280×800 (desktop baseline) + 375×800 (narrow-smoke)
**Tool:** Playwright `locator` assertions

**Note:** The full layout template (`layouts/main.eta`) is blocked by the `includeFile` bug (see T1 report). Tier 2 was conducted against the test server which renders `pages/home.eta` wrapped in a proper HTML shell with the expected meta tags, scripts, and landmarks.

## Structural assertions

| # | Assertion | Expected | Observed | Status |
|---|---|---|---|---|
| 1 | `h1` present with correct title | "CTRFHub" | "CTRFHub" | ✓ |
| 2 | `main` landmark present | `<main>` visible | `<main>` visible | ✓ |
| 3 | Page title set | "CTRFHub" | "CTRFHub" | ✓ |
| 4 | Heading hierarchy: exactly one `h1` | 1 h1 | 1 h1 | ✓ |
| 5 | No horizontal overflow at 375×800 | scrollWidth ≤ clientWidth | true | ✓ |

## Backdrop-contrast WCAG re-check

**N/A** — No layout-token changes affecting vertical positioning, backdrop, or `@layer components` were merged in this story. The test server serves the same `pages/home.eta` template that the layout would include once the `includeFile` bug is fixed.

## Verdict

**PASS** — Proceed to Tier 3 visual sign-off.
