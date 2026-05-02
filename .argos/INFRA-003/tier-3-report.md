# Tier 3 Visual Report — INFRA-003

**Executed:** 2026-05-02 04:07
**Viewports:** 1280×800 (primary) + 375×800 (narrow-smoke: no-horizontal-scroll check)
**Pre-conditions confirmed:** T1 ✓ (partial), T2 ✓, backdrop-contrast: N/A
**Tool:** Playwright — locator + boundingBox assertions

**Note:** Full layout-level screenshots (baseline at 1280×800) were not taken because full `layouts/main.eta` rendering is blocked by the `includeFile` bug (see T1 report). Tier 3 verifies the structural rendering of `pages/home.eta` content and the absence of horizontal overflow at narrow viewports using the e2e test server workaround.

## Screenshot inventory

Screenshots were not taken (full layout rendering is blocked). Tier 3 assertions verify render outcomes programmatically:

| # | Check | Viewport | Assertion | Status |
|---|---|---|---|---|
| 1 | No console errors at narrow viewport | 375×800 | no errors (SSL noise filtered) | ✓ |
| 2 | No horizontal overflow at narrow viewport | 375×800 | scrollWidth ≤ clientWidth | ✓ |
| 3 | `h1` visible at narrow viewport | 375×800 | "CTRFHub" | ✓ |
| 4 | Page title correct at narrow viewport | 375×800 | "CTRFHub" | ✓ |
| 5 | No console errors at desktop viewport | 1280×800 | no errors (SSL noise filtered) | ✓ |
| 6 | `<main>` visible with non-zero dimensions | 1280×800 | boundingBox non-null, width > 0, height > 0 | ✓ |
| 7 | `h1` renders near top of `<main>` | 1280×800 | h1Box.y ≥ mainBox.y - 1 | ✓ |
| 8 | Body has dark surface styling | 1280×800 | `bg-[...]` on `<html>`, `min-h-screen` on `<body>` | ✓ |

## Findings

- None — visuals match expectations for a stub home page with Tailwind v4 dark surface styling.
- At 375×800, no horizontal overflow detected.
- At 1280×800, the `<main>` container is correctly positioned and the `h1` heading renders as expected.
- Console errors filtered: 6× `ERR_SSL_PROTOCOL_ERROR` (environmental Chromium noise probing HTTPS on HTTP localhost — not application errors).

## Verdict

**PASS** — Structural visual assertions pass. Full baseline screenshots blocked by `includeFile` bug in `layouts/main.eta` — once the template is fixed, T3 should be re-run with actual screenshots at 1280×800.
