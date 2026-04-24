# HTMX + Alpine.js + Eta Conventions

> Sources: [HTMX Docs](https://htmx.org/docs/), [Alpine.js Docs](https://alpinejs.dev/), [Eta Docs](https://eta.js.org/), [idiomorph](https://github.com/bigskysoftware/idiomorph)

These three technologies are used together in CTRFHub. They have a strict division of responsibilities and must follow the conventions below to avoid lifecycle conflicts and to remain forward-compatible with HTMX 4.0.

---

## Division of Responsibilities

| Technology | Owns |
|---|---|
| **HTMX** | All server communication (GET, POST, SSE); swapping HTML into the DOM |
| **Alpine.js** | Ephemeral local UI state: dropdowns, modals, tab switches, toggles |
| **Eta** | Server-side HTML rendering: layouts, pages, partials returned by Fastify routes |

**The cardinal rule**: Alpine components must not contain HTMX swap targets. HTMX swap targets must not contain Alpine state that needs to survive a swap.

---

## Template Structure

```
src/views/
├── layouts/
│   └── main.eta          # Full page shell: <html>, <head>, nav, footer
├── pages/
│   ├── dashboard.eta     # Full page content (used on direct navigation)
│   ├── runs.eta
│   └── run-detail.eta
└── partials/
    ├── run-list.eta      # HTMX swaps this — no Alpine state inside
    ├── run-card.eta      # Included by run-list.eta
    ├── filter-bar.eta    # Alpine-controlled — HTMX doesn't swap inside it
    ├── test-detail.eta   # HTMX swaps this — no Alpine state inside
    └── error.eta         # Error fragment for HTMX error swapping
```

---

## Eta Layout Pattern

Use `layouts/main.eta` as the outer shell. Routes detect `HX-Request` and return a partial or the full layout accordingly.

```html
<%/* layouts/main.eta */%>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title><%= it.title ?? 'CTRFHub' %></title>
  <link rel="stylesheet" href="/assets/tailwind.css">
  <script src="/assets/htmx.min.js"></script>
  <script src="/assets/idiomorph-ext.min.js"></script>
  <script defer src="/assets/alpine.min.js"></script>
  <script src="/assets/flowbite.min.js"></script>
</head>
<body hx-ext="morph">
  <%~ await includeFile('partials/nav.eta', it) %>
  <main id="main-content">
    <%~ await includeFile('pages/' + it.body, it) %>
  </main>
</body>
</html>
```

```html
<%/* pages/runs.eta */%>
<%~ await includeFile('partials/filter-bar.eta', it) %>
<div id="run-list-container">
  <%~ await includeFile('partials/run-list.eta', it) %>
</div>
```

---

## Fastify Route: Partial vs Full Page

Every route must handle both direct navigation (full page) and HTMX requests (partial only).

```typescript
fastify.get('/runs', async (request, reply) => {
  const isHtmx = request.headers['hx-request'] === 'true';
  const runs = await runsService.list(request.em, parseFilter(request.query));

  if (isHtmx) {
    // Return only the swappable fragment
    return reply.view('partials/run-list.eta', { runs });
  }

  // Return full page (layout wraps the page template)
  return reply.view('layouts/main.eta', {
    body:  'runs',
    title: 'Test Runs — CTRFHub',
    runs,
  });
});
```

Use the `reply.page()` decorator (defined in `fastify.md`) to collapse this pattern:

```typescript
fastify.get('/runs', async (request, reply) => {
  const runs = await runsService.list(request.em, parseFilter(request.query));
  return reply.page('run-list', { runs });
});
```

---

## HTMX Attribute Rules (4.0 Forward-Compatible)

### 1. Always place `hx-target` and `hx-swap` on the requesting element

```html
<!-- ✅ Explicit — works in HTMX 2.x and 4.0 -->
<button
  hx-get="/runs"
  hx-target="#run-list-container"
  hx-swap="morph:innerHTML">
  Refresh
</button>

<!-- ❌ Implicit inheritance — breaks in HTMX 4.0 -->
<div hx-target="#run-list-container" hx-swap="morph:innerHTML">
  <button hx-get="/runs">Refresh</button>
</div>
```

### 2. Use idiomorph as the default swap strategy

```html
<!-- On <body> — enables morph globally -->
<body hx-ext="morph">

<!-- On individual elements that need morphing -->
<button hx-get="/runs" hx-target="#run-list-container" hx-swap="morph:innerHTML">
```

### 3. Use `HtmxEvents` constants for all JS event listeners

```typescript
// src/client/htmx-events.ts
export const HtmxEvents = {
  AFTER_SETTLE:   'htmx:afterSettle',
  AFTER_SWAP:     'htmx:afterSwap',
  BEFORE_REQUEST: 'htmx:beforeRequest',
  BEFORE_SWAP:    'htmx:beforeSwap',
  RESPONSE_ERROR: 'htmx:responseError',
  // NOTE: htmx:xhr:* events are renamed to htmx:fetch:* in HTMX 4.0.
  // Update only this file when upgrading.
  LOAD_START:     'htmx:xhr:loadstart',
  LOAD_END:       'htmx:xhr:loadend',
} as const;

// Usage — never use raw strings
document.addEventListener(HtmxEvents.AFTER_SETTLE, (e) => { /* ... */ });
```

### 4. Do not use `hx-disable`

`hx-disable` is renamed to `hx-ignore` in HTMX 4.0. Use Alpine's `x-show`/`x-bind` or CSS to suppress interactions instead.

---

## Alpine.js: What Goes Here

Use Alpine only for state that **does not need the server** and **does not need to survive an HTMX swap**.

```html
<!-- ✅ Good Alpine use case: local dropdown state -->
<div x-data="{ open: false }" class="relative">
  <button @click="open = !open">Filter</button>
  <div x-show="open" @click.outside="open = false" class="absolute ...">
    <!-- filter options — these don't get HTMX-swapped -->
  </div>
</div>

<!-- ✅ Good Alpine use case: tab switching -->
<div x-data="{ tab: 'overview' }">
  <button @click="tab = 'overview'" :class="{ active: tab === 'overview' }">Overview</button>
  <button @click="tab = 'tests'"    :class="{ active: tab === 'tests' }">Tests</button>
  <div x-show="tab === 'overview'">...</div>
  <div x-show="tab === 'tests'">...</div>
</div>
```

```html
<!-- ❌ Wrong: Alpine state inside an HTMX swap target -->
<div id="run-list-container">                       <!-- HTMX swaps this -->
  <div x-data="{ selected: null }">                 <!-- Alpine state lost on swap -->
    ...
  </div>
</div>
```

If you need state to survive a swap, move the `x-data` **outside** the swap target, or move the state to the server.

---

## SSE: Live Dashboard Updates

Use HTMX's SSE extension to push new run notifications to the browser.

```html
<!-- In layout: connect to SSE endpoint -->
<div hx-ext="sse" sse-connect="/api/sse/runs"
     sse-swap="newRun"
     hx-target="#run-list-container"
     hx-swap="morph:afterbegin">
</div>
```

```typescript
// Fastify SSE endpoint
fastify.get('/api/sse/runs', { config: { skipAuth: false } }, async (request, reply) => {
  reply.raw.setHeader('Content-Type', 'text/event-stream');
  reply.raw.setHeader('Cache-Control', 'no-cache');
  reply.raw.setHeader('Connection', 'keep-alive');

  const send = (event: string, html: string) => {
    reply.raw.write(`event: ${event}\ndata: ${html}\n\n`);
  };

  // Subscribe to new run events (implement your own EventEmitter)
  runEvents.on('new', async (run) => {
    const html = await app.view('partials/run-card.eta', { run });
    send('newRun', html);
  });

  request.raw.on('close', () => runEvents.removeAllListeners('new'));
});
```

---

## Flowbite + Alpine Coexistence

Flowbite initializes its own interactive components (dropdowns, modals) via its JS bundle. Ensure Flowbite runs after HTMX swaps.

```typescript
// Re-initialize Flowbite after every HTMX swap
import { initFlowbite } from 'flowbite';
import { HtmxEvents } from './htmx-events';

document.addEventListener(HtmxEvents.AFTER_SETTLE, () => {
  initFlowbite();
});
```

**Rule**: For any component available in Flowbite (dropdowns, modals, drawers, tabs, tables), use Flowbite. Only reach for raw Alpine state when Flowbite doesn't cover the use case.

---

## Loading States (Tiered, Delayed, Contextual)

Do not use a global top-of-page progress bar (NProgress style). All loading indicators must be:

1. **Contextual** — scoped to the element being updated, not the full page
2. **Delayed** — only appear after 150 ms; fast responses feel instant with no flash
3. **Tiered** — indicator type matches the nature of the interaction

### The hx-indicator contract

Every `hx-*` element that updates content **must include `hx-indicator`** from day one, even if visual polish is deferred. This ensures no markup needs retroactive updates when loading states are implemented.

```html
<!-- Self-indicating container — uses outerHTML swap target as its own indicator -->
<div id="runs-table"
     hx-get="/projects/frontend-e2e/runs"
     hx-trigger="sse:run.created"
     hx-swap="outerHTML"
     hx-indicator="#runs-table">
</div>

<!-- Button with explicit indicator span inside -->
<button id="delete-run-btn"
        hx-delete="/runs/891"
        hx-confirm="..."
        hx-indicator="#delete-run-btn">
  Delete run
  <span class="htmx-indicator btn-spinner" aria-hidden="true"></span>
</button>
```

### Global CSS convention

Write once in `index.css`. Refine visuals later without touching any markup.

```css
/* Only show indicator after 150ms — no flash for fast (<150ms) responses */
.htmx-indicator {
  opacity: 0;
  transition: opacity 0s 150ms;
}
.htmx-request .htmx-indicator,
.htmx-request.htmx-indicator {
  opacity: 1;
  transition: opacity 200ms ease 150ms;
}

/* Fade the element being replaced — zero extra HTML needed */
.htmx-request {
  opacity: 0.6;
  transition: opacity 200ms ease 150ms;
}

/* Buttons: disable + suppress pointer events; do NOT fade */
button.htmx-request {
  opacity: 1;
  pointer-events: none;
  cursor: not-allowed;
}
```

### Tier table

| Scenario | Indicator |
|---|---|
| Settings auto-save (toggle, text blur) | Nothing → per-field "Saving… → ✓" |
| Table / list HTMX refresh | Opacity fade on container (CSS only, no extra HTML) |
| Button action (Delete, Create) | Inline dot spinner inside button + `disabled` |
| File upload | Determinate progress bar *inside the upload widget only* (real % progress) |
| Dashboard KPI card refresh | Skeleton shimmer on card outlines (deferred CSS work) |
| Page-level navigation | Nothing <150ms; opacity fade on `<main>` for slower |

---

## Auto-Save Form Pattern

Per-field `PATCH` requests with no "Save" button. Wire the HTMX trigger differently by field type.

```html
<!-- Text input: 600ms debounce + blur fallback -->
<input type="text"
       id="project-name"
       name="name"
       value="<%= it.project.name %>"
       hx-patch="/projects/<%= it.project.slug %>/settings/name"
       hx-trigger="keyup delay:600ms, blur"
       hx-target="#project-name-status"
       hx-swap="innerHTML"
       hx-indicator="#project-name-status">
<span id="project-name-status" class="htmx-indicator field-status"></span>

<!-- Toggle / checkbox: save immediately on change -->
<input type="checkbox"
       id="notifications-toggle"
       name="notifications_enabled"
       hx-patch="/org/settings/notifications"
       hx-trigger="change"
       hx-target="#notifications-status"
       hx-swap="innerHTML"
       hx-indicator="#notifications-status">

<!-- Select: save immediately on change -->
<select id="timezone-select"
        name="timezone"
        hx-patch="/org/settings/timezone"
        hx-trigger="change"
        hx-target="#timezone-status"
        hx-swap="innerHTML"
        hx-indicator="#timezone-status">
  ...
</select>
```

The server returns a small status fragment for each `hx-target`:

```html
<%/* partials/field-status-saved.eta */%>
<span class="field-status saved">✓ Saved</span>

<%/* partials/field-status-conflict.eta — returned on 409 Conflict */%>
<span class="field-status conflict">⚠ Updated elsewhere — reload to see latest</span>
```

Fastify route shape:

```typescript
fastify.patch('/projects/:slug/settings/:field', async (request, reply) => {
  const { updatedAt, value } = request.body; // updatedAt = optimistic lock token

  const project = await projectService.patchField(request.em, {
    slug: request.params.slug,
    field: request.params.field,
    value,
    updatedAt,         // service throws 409 if stale
  });

  const isHtmx = request.headers['hx-request'] === 'true';
  if (isHtmx) return reply.view('partials/field-status-saved.eta');
  return reply.status(200).send({ updatedAt: project.updatedAt });
});
```

---

## Common Gotchas

| Symptom | Cause | Fix |
|---|---|---|
| Alpine dropdown stops working after HTMX swap | Alpine component inside swap target | Move `x-data` above the swap target boundary |
| Flowbite modal doesn't open after swap | Flowbite not re-initialized | Call `initFlowbite()` in `HtmxEvents.AFTER_SETTLE` listener |
| Page breaks on direct navigation to partial URL | Route only returns fragment, not full page | Always check `HX-Request` header and return full layout when absent |
| `hx-target` doesn't resolve after swap | Target element was inside the swapped region and lost its ID | Keep swap targets as stable containers outside the swapped content |
| SSE connection drops and doesn't reconnect | HTMX SSE extension handles reconnect automatically | Don't implement manual reconnect logic; let HTMX handle it |
| HTMX 4.0 upgrade: attribute inheritance broken | Relied on parent `hx-target` being inherited | Follow explicit attribute rule — always on the requesting element |
