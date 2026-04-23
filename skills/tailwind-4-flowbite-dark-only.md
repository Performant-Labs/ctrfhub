---
name: tailwind-4-flowbite-dark-only
description: Tailwind CSS 4 setup (CSS-first @theme, no tailwind.config.js), Flowbite component hierarchy, custom @layer components, dark-mode-only authoring, and how the [data-theme] custom property system integrates.
trigger: adding or modifying any CSS, Tailwind utility classes, Flowbite component, or custom component style; touching src/assets/input.css
source: docs/planning/architecture.md §Frontend; ~/Sites/ai_guidance/frameworks/tailwind/conventions.md §all; docs/planning/gap-review-merged.md #1 (Tailwind + [data-theme] integration)
---

## Rule

Tailwind v4 uses CSS-first `@theme` configuration in `src/assets/input.css` (no `tailwind.config.js`); Flowbite provides pre-built components — always use Flowbite before writing custom components; custom CTRF-specific components go in `@layer components`; CTRFHub is dark-mode-only (no `dark:` variant on any element); the `[data-theme]` custom-property theme system overrides `@theme` token values at runtime.

## Why

Tailwind v4 replaced the JS config file with a CSS-first `@theme` block. All design tokens (colors, fonts, spacing) are CSS custom properties defined in `@theme`. The `[data-theme="midnight|slate|dim|cloud|warm|sky"]` system (`theme-design.md`) sets these same CSS custom properties at runtime based on the active theme. These two systems are designed to compose: `@theme` defines the default token values; `[data-theme]` overrides them for non-default themes. No Tailwind utility needs to know which theme is active — it just reads the current `--color-*` value.

CTRFHub ships as dark-mode-only (per `architecture.md §Frontend` and `tailwind/conventions.md §Dark Mode`). Do not use `dark:` variant prefixes — all surfaces target the dark palette directly.

## How to apply

### input.css structure (single entry point):

```css
/* 1. Tailwind */
@import "tailwindcss";

/* 2. Flowbite */
@import "flowbite";

/* 3. Source scanning */
@source "../../src/views/**/*.eta";
@source "../../node_modules/flowbite/**/*.js";

/* 4. Design tokens (consumed by [data-theme] overrides) */
@theme {
  --color-brand:       #6366f1;  /* default: midnight theme */
  --color-surface:     #0f172a;
  --color-surface-alt: #1e293b;
  --color-border:      #334155;
  --color-pass:        #22c55e;
  --color-fail:        #ef4444;
  --color-skip:        #94a3b8;
  --color-flaky:       #f59e0b;
  --font-sans: 'Inter', ui-sans-serif, system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;
}

/* 5. [data-theme] overrides — applied at runtime to :root by JS */
/* These override @theme tokens without a rebuild */
[data-theme="slate"]  { --color-brand: #64748b; --color-surface: #0f172a; /* ... */ }
[data-theme="dim"]    { --color-brand: #6366f1; --color-surface: #1a1a2e; /* ... */ }
[data-theme="cloud"]  { --color-brand: #0ea5e9; --color-surface: #0c1a2a; /* ... */ }
/* etc. */

/* 6. Custom CTRF components */
@layer components {
  .badge-pass  { @apply inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-900 text-green-300; }
  .badge-fail  { @apply inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-900 text-red-300; }
  .badge-skip  { @apply inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-700 text-slate-300; }
  .badge-flaky { @apply inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-900 text-amber-300; }
  .run-card    { @apply bg-[--color-surface-alt] border border-[--color-border] rounded-lg p-4 hover:border-[--color-brand] transition-colors duration-150; }
  .stat-tile   { @apply bg-[--color-surface-alt] border border-[--color-border] rounded-xl p-6 flex flex-col gap-1; }
}
```

### Component decision tree (before writing any HTML):

1. Does Flowbite have this component? → Use Flowbite. Copy HTML from `flowbite.com/docs`.
2. Is it a CTRF-specific data display (run card, AI badge, test status badge, trend chart)? → Write a custom Eta partial with `@layer components` styles.
3. Can Alpine + bare Tailwind utilities cover it (no CTRF data)? → Use utilities, but only inside `@layer components`, not as raw utility soup on the element.

**Flowbite components used in CTRFHub:**
| UI Element | Flowbite Component |
|---|---|
| Sidebar navigation | Sidebar |
| Run history table | Tables |
| Date range filter | Datepicker |
| Status filter dropdown | Dropdown |
| Test detail modal | Modal |
| Pass/fail badges | Badges (base; override with `.badge-*` classes) |
| Alert banners | Alerts |
| Progress bars | Progress |

### Dark mode rule:

Do NOT use `dark:` variant. Write all styles assuming a dark surface.

```css
/* ✅ Always dark */
body { @apply bg-[--color-surface] text-slate-100; }

/* ❌ Don't do this */
body { @apply bg-white dark:bg-[--color-surface]; }
```

### Flowbite re-initialization after HTMX swaps:

```typescript
// src/client/app.ts
import { HtmxEvents } from './htmx-events';
import { initFlowbite } from 'flowbite';

document.addEventListener(HtmxEvents.AFTER_SETTLE, () => initFlowbite());
```

### Script load order in layouts/main.eta:

```html
<link rel="stylesheet" href="/assets/tailwind.css">
<script src="/assets/htmx.min.js"></script>
<script src="/assets/idiomorph-ext.min.js"></script>
<script defer src="/assets/alpine.min.js"></script>
<script src="/assets/flowbite.min.js"></script>
<script type="module" src="/assets/app.js"></script>
```

## Bad example

```html
<!-- ❌ Raw utility soup on a data element -->
<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-900 text-red-300">Failed</span>
<!-- Use .badge-fail instead -->

<!-- ❌ Dark mode variant usage (CTRFHub is dark-only) -->
<div class="bg-white dark:bg-slate-900">...</div>
```
