# Tailwind CSS v4 + Flowbite Conventions

> Sources: [Tailwind CSS v4 Docs](https://tailwindcss.com/docs), [Flowbite Docs](https://flowbite.com/docs/getting-started/introduction/), [Tailwind v4 Migration Guide](https://tailwindcss.com/docs/upgrade-guide)

---

## Core Principles

- **No `tailwind.config.js`** — Tailwind v4 uses CSS-first configuration via `@theme`.
- **CLI build step only** — no Vite, no PostCSS pipeline needed for CTRFHub.
- **Flowbite first** — use Flowbite components before writing custom ones. Only build custom for CTRF-specific data displays.
- **`@layer components`** for custom components — never ad-hoc utilities at the root level.

---

## File Structure

```
src/
├── assets/
│   ├── input.css          # Tailwind entry point — only this file is processed
│   └── tailwind.css       # Generated output — committed to .gitignore, served statically
└── views/
    └── layouts/
        └── main.eta       # Links to /assets/tailwind.css
```

---

## CSS Entry File (`src/assets/input.css`)

```css
/* 1. Import Tailwind */
@import "tailwindcss";

/* 2. Import Flowbite (adds its utility classes + component styles) */
@import "flowbite";

/* 3. Tell Tailwind where to scan for class names */
@source "../../src/views/**/*.eta";
@source "../../node_modules/flowbite/**/*.js";

/* 4. Design tokens — CSS-first, no tailwind.config.js */
@theme {
  /* Brand colors */
  --color-brand:        #6366f1;   /* indigo-500 */
  --color-brand-dark:   #4f46e5;   /* indigo-600 */
  --color-surface:      #0f172a;   /* slate-900 — dark mode base */
  --color-surface-alt:  #1e293b;   /* slate-800 — cards */
  --color-border:       #334155;   /* slate-700 */

  /* Status colors */
  --color-pass:   #22c55e;   /* green-500 */
  --color-fail:   #ef4444;   /* red-500 */
  --color-skip:   #94a3b8;   /* slate-400 */
  --color-flaky:  #f59e0b;   /* amber-500 */

  /* Typography */
  --font-sans: 'Inter', ui-sans-serif, system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;
}
```

---

## Build Commands

```bash
# Development — watch mode (run alongside Fastify dev server)
npx @tailwindcss/cli -i ./src/assets/input.css -o ./src/assets/tailwind.css --watch

# Production — minified (run during Docker image build)
npx @tailwindcss/cli -i ./src/assets/input.css -o ./src/assets/tailwind.css --minify
```

Add to `package.json`:

```json
{
  "scripts": {
    "css:dev":   "tailwindcss -i ./src/assets/input.css -o ./src/assets/tailwind.css --watch",
    "css:build": "tailwindcss -i ./src/assets/input.css -o ./src/assets/tailwind.css --minify",
    "dev":       "concurrently \"npm run css:dev\" \"tsx watch src/index.ts\""
  }
}
```

---

## Component Decision Tree

Before writing any HTML, ask:

```
Does Flowbite have this component?
├── YES → Use Flowbite. Copy the HTML from flowbite.com/docs.
│         Add x-data to the Flowbite component only if you need
│         local state beyond what Flowbite already provides.
└── NO  → Is it a CTRF-specific data display? (test tree, AI badge, trend chart)
          ├── YES → Write a custom Eta partial + @layer components style.
          └── NO  → Check if Alpine + Tailwind utilities alone are sufficient.
```

### Flowbite components used in CTRFHub

| UI Element | Flowbite Component |
|---|---|
| Sidebar navigation | [Sidebar](https://flowbite.com/docs/components/sidebar/) |
| Run history table | [Tables](https://flowbite.com/docs/components/tables/) |
| Date range filter | [Datepicker](https://flowbite.com/docs/plugins/datepicker/) |
| Status filter dropdown | [Dropdown](https://flowbite.com/docs/components/dropdowns/) |
| Test detail modal | [Modal](https://flowbite.com/docs/components/modal/) |
| Pass/fail badges | [Badges](https://flowbite.com/docs/components/badge/) |
| Alert banners | [Alerts](https://flowbite.com/docs/components/alerts/) |
| Progress bars | [Progress](https://flowbite.com/docs/components/progress/) |

---

## Custom Components with `@layer`

Write custom CTRF-specific components in `@layer components`, not as bare utility classes in templates.

```css
/* In src/assets/input.css, after @theme */

@layer components {
  /* Test status badge */
  .badge-pass  { @apply inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-900 text-green-300; }
  .badge-fail  { @apply inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-900 text-red-300; }
  .badge-skip  { @apply inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-700 text-slate-300; }
  .badge-flaky { @apply inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-900 text-amber-300; }

  /* Run card */
  .run-card {
    @apply bg-[--color-surface-alt] border border-[--color-border] rounded-lg p-4
           hover:border-[--color-brand] transition-colors duration-150;
  }

  /* Stat tile on dashboard */
  .stat-tile {
    @apply bg-[--color-surface-alt] border border-[--color-border] rounded-xl p-6 flex flex-col gap-1;
  }
}
```

Usage in templates — semantic class names, not utility soup:

```html
<!-- ✅ Use semantic component classes -->
<span class="badge-fail">Failed</span>
<div class="run-card">...</div>

<!-- ❌ Don't pile utilities directly on data elements -->
<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-900 text-red-300">Failed</span>
```

---

## Dark Mode

CTRFHub is dark-mode-only. Do not use the `dark:` variant — all styles target the dark surface directly using the `@theme` tokens.

```css
/* ✅ Always dark */
body { @apply bg-[--color-surface] text-slate-100; }

/* ❌ Don't do this — adds unnecessary complexity */
body { @apply bg-white dark:bg-[--color-surface]; }
```

---

## Flowbite + Alpine Initialization

Flowbite's JS must re-run after HTMX swaps content into the DOM (see HTMX guide). Load order in `main.eta`:

```html
<!-- 1. Tailwind CSS (generated, served as static asset) -->
<link rel="stylesheet" href="/assets/tailwind.css">

<!-- 2. HTMX + idiomorph -->
<script src="/assets/htmx.min.js"></script>
<script src="/assets/idiomorph-ext.min.js"></script>

<!-- 3. Alpine (defer so DOM is ready) -->
<script defer src="/assets/alpine.min.js"></script>

<!-- 4. Flowbite (after Alpine to avoid conflicts) -->
<script src="/assets/flowbite.min.js"></script>

<!-- 5. App JS (HtmxEvents listeners, initFlowbite on afterSettle) -->
<script type="module" src="/assets/app.js"></script>
```

---

## Common Gotchas

| Symptom | Cause | Fix |
|---|---|---|
| Classes in Eta templates not generating CSS | Tailwind not scanning `.eta` files | Add `@source "../../src/views/**/*.eta"` to `input.css` |
| Flowbite classes missing | Flowbite node_modules not scanned | Add `@source "../../node_modules/flowbite/**/*.js"` |
| CSS token not applying | Referenced `--color-brand` before `@theme` block | Put `@theme` before `@layer` in `input.css` |
| Flowbite modal not opening after HTMX swap | Flowbite not re-initialized | Call `initFlowbite()` in `htmx:afterSettle` listener |
| `@apply` unknown utility error | Using a Tailwind v3 utility removed in v4 | Check the v4 [upgrade guide](https://tailwindcss.com/docs/upgrade-guide) for renamed utilities |
| Build output empty | Wrong input file path in CLI command | Verify path relative to where CLI is run |
