---
name: htmx-alpine-boundary
description: Enforces the strict division between HTMX (server comms + DOM swaps) and Alpine.js (ephemeral local UI state), including idiomorph for state-preserving swaps.
trigger: writing any HTMX handler, any Alpine x-data component, any Eta partial that will be swapped
source: docs/planning/architecture.md §Frontend boundary rules; docs/planning/project-plan.md §HTMX + Alpine.js Boundary Rule; ~/Sites/ai_guidance/frameworks/htmx/conventions.md §Division of Responsibilities
---

## Rule

HTMX owns all server communication and DOM swapping; Alpine.js owns only ephemeral local UI state that does not need to survive an HTMX swap; idiomorph (`hx-ext="morph"`) is the default swap strategy to preserve Alpine state in stable containers outside swap targets.

## Why

HTMX and Alpine operate on the same DOM tree. Without a clear boundary, an HTMX swap destroys Alpine component state (open dropdowns, active tabs, form draft) because the swap replaces the DOM nodes that Alpine was managing. The boundary rule prevents this class of bug by design: Alpine state that must survive lives *outside* the HTMX swap target, while state inside the target is intentionally ephemeral.

Idiomorph morphs existing DOM nodes in-place (rather than replacing them wholesale), so Alpine components that sit *outside* the swap target retain their reactive state across swaps. This is the documented pattern in `architecture.md §Frontend boundary rules` and `htmx/conventions.md §Division of Responsibilities`.

## How to apply

1. **Identify the swap target first.** Every HTMX interaction has a `hx-target` — identify this element before adding any Alpine state nearby.
2. **Place `x-data` above the swap target boundary, never inside it.** If a component needs both Alpine state and HTMX-refreshable content, structure the markup so `x-data` is on an ancestor element that is never replaced.
3. **Keep swap target contents Alpine-free.** Eta partials returned by HTMX routes (`partials/run-list.eta`, `partials/test-detail.eta`, etc.) must not contain `x-data` attributes. If they need Alpine interaction, that interaction must be defined on a stable ancestor in the surrounding layout.
4. **Add `hx-ext="morph"` to `<body>` globally** and use `hx-swap="morph:innerHTML"` on elements where in-place morphing is needed. This is pre-configured in `layouts/main.eta`.
5. **Flowbite first for interactive components** — Flowbite's dropdowns, modals, and tabs are already designed to coexist with idiomorph. Only reach for raw Alpine `x-data` when Flowbite doesn't cover the use case.
6. **Re-initialize Flowbite after every swap** — call `initFlowbite()` in the `HtmxEvents.AFTER_SETTLE` listener (already wired in `src/client/app.ts`).

## Good example

```html
<!-- ✅ Alpine state OUTSIDE the HTMX swap target -->
<div x-data="{ open: false }" class="relative">
  <button @click="open = !open">Filter</button>
  <div x-show="open" @click.outside="open = false">
    <!-- filter panel — never swapped by HTMX -->
  </div>
</div>

<!-- Swap target is a stable sibling container -->
<div id="run-list-container"
     hx-get="/projects/demo/runs"
     hx-trigger="filterChanged from:body"
     hx-target="#run-list-container"
     hx-swap="morph:innerHTML">
  <%~ await includeFile('partials/run-list.eta', it) %>
</div>
```

## Bad example

```html
<!-- ❌ Alpine state INSIDE the HTMX swap target — state is destroyed on every swap -->
<div id="run-list-container">
  <div x-data="{ selected: null }">   <!-- wiped when HTMX swaps #run-list-container -->
    <button @click="selected = 'abc'">Select</button>
  </div>
</div>
```

Why it's wrong: when HTMX replaces `#run-list-container`, the `x-data` node is destroyed and Alpine's reactive state is lost. The user's selection vanishes on every refresh.
