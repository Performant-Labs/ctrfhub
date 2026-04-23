---
name: viewport-mobile-first-desktop-only
description: CTRFHub's dual-posture authoring rule — desktop-only product commitment with mobile-first Tailwind authoring — and the two-viewport Playwright test matrix.
trigger: writing any HTML template, Tailwind CSS, or Playwright viewport configuration
source: docs/planning/architecture.md §Viewport posture; docs/planning/product.md §Viewport posture
---

## Rule

The `<meta name="viewport" content="width=1280">` tag pins mobile browsers to the 1280 CSS px desktop layout; all CSS is authored mobile-first (unprefixed = narrow; `md:` / `lg:` = desktop enhancements); tables are always wrapped in `overflow-x-auto`; Playwright runs a two-viewport matrix (1280×800 primary + 375×800 narrow smoke); WCAG 2.1 AA accessibility minimums apply regardless of viewport.

## Why

CTRFHub is a **desktop application** — the product promise, the design target, and the QA commitment are all 1280×800. No mobile product story ships in MVP, and mobile layout work is explicitly out of scope. At the same time, Tailwind and Flowbite default to mobile-first authoring, so fighting this default would be more expensive than embracing it.

The dual-posture decision (`architecture.md §Viewport posture`, `product.md §Viewport posture`) keeps the two commitments separate:

- **Product commitment (desktop-only):** QA at 1280×800, no mobile design work, no mobile claims in release notes.
- **Authoring commitment (mobile-first):** unprefixed Tailwind utilities target narrow viewports; `md:` / `lg:` add desktop layouts. This matches Tailwind/Flowbite's default and makes future promotion to mobile-degraded-functional a QA-and-polish effort rather than a rewrite.

## How to apply

### Layout tag (in `layouts/main.eta`):

```html
<meta name="viewport" content="width=1280">
```

This causes mobile browsers to scale the 1280 CSS px wide desktop layout to fit the screen — the Datadog/Snyk/CircleCI posture.

### Tailwind authoring:

- **Unprefixed styles** (base case) target narrow viewports.
- **`md:` / `lg:` / `xl:` utilities** add desktop enhancements.
- This matches Flowbite's default — do not strip Flowbite's responsive defaults.
- Flowbite sidebar, navbar, and responsive tables retain their narrow-viewport collapse behaviour — do not customise it.

### Overflow wrappers for tables:

Every table that could exceed a narrow viewport **must** be wrapped in `overflow-x-auto`:

```html
<div class="overflow-x-auto">
  <table class="w-full ...">...</table>
</div>
```

### Playwright viewport matrix:

Every screen must be tested at both viewports:

```typescript
// e2e/playwright.config.ts
export default defineConfig({
  projects: [
    {
      name: 'desktop',
      use: { viewport: { width: 1280, height: 800 } },  // primary — full assertions
    },
    {
      name: 'narrow-smoke',
      use: { viewport: { width: 375, height: 800 } },   // smoke only — minimal assertions
    },
  ],
});
```

**Desktop (1280×800):** Full test assertions run here. All features, all interactions.

**Narrow (375×800) smoke test:** Per screen, assert only:
1. Page loads without a console error.
2. No unexpected horizontal overflow outside `.overflow-x-auto` containers.

Narrow-smoke failures block merge (they are CSS drift regression guardrails), but they do NOT imply the screen has been designed for mobile — just that the desktop layout doesn't break narrow viewports catastrophically.

### Accessibility minimums (regardless of viewport):

- WCAG 2.1 AA for all dashboard and auth screens.
- Interactive elements must be ≥ 24×24 CSS px (Flowbite's default button sizes exceed this).
- This is an accessibility requirement for users with motor impairments, **not** a mobile UX requirement.

## Good example

```html
<!-- ✅ Mobile-first Tailwind, desktop layout via md: prefix -->
<div class="flex flex-col md:flex-row gap-4">
  <aside class="w-full md:w-64 shrink-0">...</aside>
  <main class="flex-1 min-w-0">...</main>
</div>

<!-- ✅ Table always wrapped in overflow-x-auto -->
<div class="overflow-x-auto">
  <table class="w-full text-sm text-slate-300">
    <thead>...</thead>
    <tbody>...</tbody>
  </table>
</div>
```

## Bad example

```html
<!-- ❌ Desktop-only authoring without mobile-first base -->
<div class="flex flex-row gap-4">
  <!-- No narrow-viewport handling — sidebar collapses to nothing, content overflows -->
</div>

<!-- ❌ Table without overflow wrapper -->
<table class="w-full text-sm">
  <!-- On narrow viewports, this overflows body, fails narrow-smoke test -->
</table>
```
