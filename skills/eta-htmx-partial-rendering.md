---
name: eta-htmx-partial-rendering
description: How to render an Eta template as an HTMX partial versus a full page, using the reply.page() decorator and the HX-Request header detection pattern.
trigger: writing any Fastify route that returns HTML; writing any Eta template that will be swapped by HTMX
source: ~/Sites/ai_guidance/frameworks/htmx/conventions.md §Fastify Route: Partial vs Full Page, §Template Structure; ~/Sites/ai_guidance/frameworks/fastify/conventions.md §HTMX + View Integration
---

## Rule

Every HTML-returning route must detect the `HX-Request: true` header and return either the Eta partial (for HTMX swaps) or the full layout wrapper (for direct navigation); partials live under `src/views/partials/`; pages live under `src/views/pages/`; the `reply.page()` decorator handles the branching.

## Why

HTMX swaps load partial HTML fragments; direct browser navigation needs the full layout (nav, head, scripts). If a route always returns the full layout, HTMX swaps will inject an entire `<html>` document into a `<div>`, breaking the page. If a route always returns a partial, direct navigation results in a headless fragment. The `HX-Request` header is the discriminator: when it is `true`, return a partial; otherwise, return the full page.

This pattern is specified in `htmx/conventions.md §Fastify Route: Partial vs Full Page` and implemented via the `reply.page()` decorator defined in `fastify/conventions.md §HTMX + View Integration`.

## How to apply

1. **Use `reply.page(templateName, data)` for all HTML routes.** The decorator checks `HX-Request` and routes accordingly.
   - HTMX request → renders `partials/{templateName}.eta`
   - Direct navigation → renders `layouts/main.eta` with `{templateName}` as `it.body`

2. **Template naming conventions:**
   - `src/views/layouts/main.eta` — the outer shell (html, head, scripts, nav); never returned directly
   - `src/views/pages/{screen}.eta` — full page content; included by `main.eta`
   - `src/views/partials/{fragment}.eta` — HTMX swap targets; contain no `<html>` wrapper

3. **Partials must be self-contained fragments.** They must not contain `x-data` at the root level (see `htmx-alpine-boundary.md`). They render whatever goes inside the swap target.

4. **Every partial that can be an HTMX swap target must be correctly identified in the route.** If `GET /projects/demo/runs` returns `run-list`, then the swap target on the page must have `id="run-list-container"` (or whichever stable container is used) and the HTMX button must specify `hx-target="#run-list-container"`.

5. **Error partials:** The global error handler returns `partials/error.eta` for HTMX requests. This partial must have a stable HTMX-swappable shape so errors can replace content gracefully.

6. **SSE updates:** SSE event data is HTML rendered server-side via `app.view('partials/run-card.eta', { run })`. The rendered HTML is sent as the SSE `data:` payload.

## Good example

```typescript
// src/modules/runs/routes.ts
fastify.get('/projects/:slug/runs', {
  schema: { params: z.object({ slug: z.string() }), querystring: RunFilterSchema },
}, async (request, reply) => {
  const runs = await service.list(request.em, {
    slug: request.params.slug, ...request.query,
  });
  // reply.page() handles HX-Request detection automatically
  return reply.page('run-list', { runs, title: 'Test Runs — CTRFHub' });
});
```

```html
<%/* src/views/partials/run-list.eta — returned for HTMX swaps */%>
<div class="space-y-2">
  <% for (const run of it.runs) { %>
    <%~ await includeFile('partials/run-card.eta', { run }) %>
  <% } %>
</div>
```

```html
<%/* src/views/pages/runs.eta — included by main.eta for direct navigation */%>
<%~ await includeFile('partials/filter-bar.eta', it) %>
<div id="run-list-container"
     hx-get="/projects/<%= it.slug %>/runs"
     hx-trigger="filterChanged from:body"
     hx-target="#run-list-container"
     hx-swap="morph:innerHTML"
     hx-indicator="#run-list-container">
  <%~ await includeFile('partials/run-list.eta', it) %>
</div>
```

## Bad example

```typescript
// ❌ Always returns full page — HTMX swaps inject <html> into a <div>
fastify.get('/runs', async (request, reply) => {
  const runs = await service.list(request.em, {});
  return reply.view('layouts/main.eta', { body: 'runs', runs });
  // Never checks HX-Request — HTMX breaks
});

// ❌ Always returns partial — direct navigation shows headless fragment
fastify.get('/runs', async (request, reply) => {
  return reply.view('partials/run-list.eta', { runs });
  // User who navigates directly to /runs sees a fragment, not a page
});
```
