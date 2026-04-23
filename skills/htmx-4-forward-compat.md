---
name: htmx-4-forward-compat
description: Three HTMX 4.0 breaking-change rules that must be followed in all 2.x code so the eventual 4.0 upgrade requires no source changes.
trigger: writing any hx-* attribute, any JS HTMX event listener, any use of hx-disable
source: docs/planning/project-plan.md §HTMX 4.0 Forward-Compatibility Rules; docs/planning/architecture.md §Frontend boundary rules; ~/Sites/ai_guidance/frameworks/htmx/conventions.md §HTMX Attribute Rules (4.0 Forward-Compatible)
---

## Rule

Always write `hx-target` and `hx-swap` on the requesting element directly; reference HTMX event names only through the `HtmxEvents` constants object in `src/client/htmx-events.ts`; never use `hx-disable`.

## Why

HTMX 4.0 makes three breaking changes documented in `project-plan.md §HTMX 4.0 Forward-Compatibility Rules`:

1. **Attribute inheritance is removed.** In 2.x a child element inherits `hx-target`/`hx-swap` from a parent. In 4.0 this inheritance is explicit-only. Code that relies on parent inheritance will silently break after the upgrade.
2. **`htmx:xhr:*` events are renamed `htmx:fetch:*`.** Any raw string like `'htmx:xhr:loadstart'` in JS code will break. The `HtmxEvents` constants file is the single place that maps 2.x names to 4.0 names — updating one file covers the whole codebase.
3. **`hx-disable` is renamed `hx-ignore`.** Any `hx-disable` attribute in templates will stop working.

## How to apply

### Rule 1 — Explicit hx-target + hx-swap

1. Every element with an `hx-*` request attribute (`hx-get`, `hx-post`, `hx-patch`, `hx-delete`) **must** also carry `hx-target` and `hx-swap` on the **same element**.
2. Never place `hx-target` or `hx-swap` on a parent div and expect children to inherit it.
3. During code review, grep for `hx-get|hx-post|hx-patch|hx-delete` without `hx-target` on the same element as a quick lint.

### Rule 2 — HtmxEvents constants

1. In `src/client/htmx-events.ts`, add every event name the codebase uses as a named constant.
2. In all JS/TS files, import `HtmxEvents` and reference `HtmxEvents.AFTER_SETTLE`, never `'htmx:afterSettle'`.
3. When upgrading to HTMX 4.0, only `htmx-events.ts` needs updating.

### Rule 3 — No hx-disable

1. Remove any `hx-disable` usage found during review.
2. To conditionally suppress HTMX interactions, use Alpine's `x-bind:disabled` or CSS `pointer-events: none` controlled by a class.

## Good example

```html
<!-- ✅ Rule 1: hx-target and hx-swap on the requesting element -->
<button
  hx-get="/projects/demo/runs"
  hx-target="#run-list-container"
  hx-swap="morph:innerHTML"
  hx-indicator="#run-list-container">
  Refresh
</button>
```

```typescript
// ✅ Rule 2: always use HtmxEvents constants
import { HtmxEvents } from './htmx-events';
import { initFlowbite } from 'flowbite';

document.addEventListener(HtmxEvents.AFTER_SETTLE, () => {
  initFlowbite();
});
```

```typescript
// src/client/htmx-events.ts
export const HtmxEvents = {
  AFTER_SETTLE:   'htmx:afterSettle',
  AFTER_SWAP:     'htmx:afterSwap',
  BEFORE_REQUEST: 'htmx:beforeRequest',
  RESPONSE_ERROR: 'htmx:responseError',
  // NOTE: renamed htmx:fetch:* in HTMX 4.0 — update only this file
  LOAD_START:     'htmx:xhr:loadstart',
  LOAD_END:       'htmx:xhr:loadend',
} as const;
```

## Bad example

```html
<!-- ❌ Rule 1 violation: hx-target on parent, not on requesting element -->
<div hx-target="#run-list-container" hx-swap="morph:innerHTML">
  <button hx-get="/projects/demo/runs">Refresh</button>
</div>
<!-- Breaks in HTMX 4.0 — inheritance removed -->

<!-- ❌ Rule 3 violation: hx-disable usage -->
<div hx-disable>
  <button hx-get="/runs">won't fire (2.x only)</button>
</div>
```

```typescript
// ❌ Rule 2 violation: raw event name string — breaks when HTMX 4.0 renames it
document.addEventListener('htmx:xhr:loadstart', handler);
```
