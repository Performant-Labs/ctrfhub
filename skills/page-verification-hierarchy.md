---
name: page-verification-hierarchy
description: The Three-Tier Verification Hierarchy (T1 Headless → T2 Structural ARIA → T3 Visual) applied to CTRFHub's Fastify + HTMX + Eta stack — the "skeleton-first" workflow, the never-T3-before-T2 rule, and the backdrop-contrast WCAG re-check gate.
trigger: verifying any rendered page (dashboard, run detail, settings, wizard step, login); choosing between curl / Playwright ARIA / screenshot for a verification step; reviewing a UI story in implementstory workflow; any layout-token or backdrop-affecting change
source: ~/Sites/ai_guidance/testing/verification-cookbook.md §all; docs/planning/testing-strategy.md §Three-Tier Verification; docs/planning/architecture.md §Frontend; ~/Sites/ai_guidance/testing/visual-regression-strategy.md §all
---

## Rule

Always use the fastest tier that provides sufficient structural confirmation before escalating: **T1 Headless** (Fastify `inject()`, `curl`, `cheerio`) for HTTP status and server-rendered HTML/DOM presence (1–5 s); **T2 Structural ARIA** (Playwright `accessibility.snapshot()` / `read_browser_page`) for heading hierarchy, landmarks, and interactive-element presence (5–10 s); **T3 Visual** (`browser_subagent` screenshots, pixel diff) for final visual regression only (60–90 s). **T3 never runs before T2 is green.** Layout-token or backdrop-affecting changes require a numeric WCAG contrast re-check at T2 before any T3 screenshot.

## Why

Verification-tier escalation protects velocity. An ARIA snapshot is ~10 KB; a 1280×800 screenshot consumes multi-megabyte vision tokens and takes 60+ seconds per frame. Most "does the page work" questions are structural — does the heading exist, is the CTA a button, is the nav present — and the accessibility tree answers them in one to two seconds with zero pixel noise. Pixel-level assertions on a page whose structural skeleton is wrong produce expensive false-failures that drag the loop from seconds to minutes.

The skeleton-first order also prevents a failure mode unique to dark-themed apps with layout-token knobs: a screenshot can *look* readable at thumbnail resolution while the underlying contrast ratio is failing WCAG AA. T3 is a vision-token channel; accessibility is a numeric property. Measure it numerically. CTRFHub ships dark-mode-only (`tailwind-4-flowbite-dark-only.md`), so every surface is one backdrop token away from dropping below 4.5:1 body contrast.

This skill is the page-verification companion to `vitest-three-layer-testing.md`. The two hierarchies are orthogonal: Vitest's three layers (unit / integration / E2E) partition **where the code runs**; the three tiers here partition **what fidelity you verify a rendered page at**. A single E2E test can and should exercise T1 → T2 → T3 in sequence against the same route.

## How to apply

### T1 — Headless (Fastify inject / curl / cheerio)

Use for HTTP status codes, response shape, server-rendered DOM presence, and CSS-variable checks. No browser, no JavaScript execution.

**From inside the test suite:**

```typescript
// Fastify inject — the canonical T1 check in integration tests
const res = await app.inject({ method: 'GET', url: '/runs/123' });
expect(res.statusCode).toBe(200);
expect(res.headers['content-type']).toMatch(/html/);

// HTMX partial request — T1 verifies partial vs full-page branching
const partial = await app.inject({
  method: 'GET',
  url: '/runs?status=failed',
  headers: { 'HX-Request': 'true' },
});
expect(partial.statusCode).toBe(200);
expect(partial.body).not.toMatch(/<html/);  // partial, not full page
```

**From the shell against a running dev server:**

```bash
# HTTP status
curl -sk -o /dev/null -w '%{http_code}' http://localhost:3000/runs/123

# Heading tag presence (no browser needed)
curl -sk http://localhost:3000/runs/123 | grep -o '<h1[^>]*>[^<]*</h1>'

# Every nav link resolves (run this in the assembly phase, not in VR)
for url in $(curl -sk http://localhost:3000/ | grep -oE 'href="/[^"]+"' | sed 's/href="//;s/"//'); do
  code=$(curl -sk -o /dev/null -w '%{http_code}' "http://localhost:3000${url}")
  echo "$code $url"
done | grep -v '^200' || echo 'all links 200'
```

**cheerio** is the accepted HTML-parsing helper inside integration tests when a string-grep is too fragile. Keep it at T1 — it is not a browser; it does not execute HTMX, Alpine, or any client-side JavaScript.

**Common T1 patterns for CTRFHub:**

| What to verify | T1 command |
|---|---|
| `/health` returns 503 during boot | `app.inject('/health')` — assert `503` and `bootState: 'migrating'` |
| `/setup` returns 410 after seeded | `app.inject({ url: '/setup', ... })` — assert `410` |
| Ingest accepts valid CTRF | `app.inject({ method: 'POST', url: '/api/v1/projects/demo/runs', payload: validCtrf, headers: { 'x-api-token': 't1' } })` — assert `201` + `runId` in body |
| HTMX partial vs full page | Two `inject()` calls, one with `HX-Request: true`, assert body differs |
| `<meta viewport content="width=1280">` emitted | `curl … \| grep 'viewport'` or cheerio `$('meta[name=viewport]').attr('content')` |

### T2 — Structural ARIA (Playwright accessibility.snapshot / read_browser_page)

Use immediately after T1 passes, for every UI story. Checks the accessibility tree — headings, landmarks, roles, labels, and interactive-element presence.

```typescript
// Inside a Playwright e2e spec
test('run detail page skeleton', async ({ page }) => {
  await page.goto('/runs/123');
  const snap = await page.accessibility.snapshot();

  // H1 present with expected title
  const h1 = findNode(snap, n => n.role === 'heading' && n.level === 1);
  expect(h1?.name).toMatch(/Run #123/);

  // Suite accordion buttons exist
  const accordionButtons = findAll(snap, n => n.role === 'button' && /suite/i.test(n.name));
  expect(accordionButtons.length).toBeGreaterThan(0);

  // No raw JSON leaked into the page (DASH-003 E2E assertion)
  const body = await page.textContent('body');
  expect(body).not.toContain('{"results":');
});
```

In Cowork / interactive agent contexts, `read_browser_page` returns the same ARIA data without launching a Playwright harness — use it for fast iteration while authoring a story, then lock the assertion down in a Playwright test.

**Skeleton-first workflow:**
1. **Assemble** the route (Fastify handler + Eta template + HTMX/Alpine islands).
2. **T1 check** — does `inject()` return 200 and the expected content-type/shape?
3. **T2 check** — open the page in the browser tool, pull the ARIA snapshot, confirm headings/roles/landmarks match the story's acceptance criteria.
4. **Iterate at T2** if the skeleton is wrong (5-second fix loop).
5. **Escalate to T3** only when the skeleton is 100% correct.

**Common T2 patterns for CTRFHub:**

| Story | T2 checks |
|---|---|
| Dashboard (DASH-001) | `h1` "Dashboard"; stat tiles have `aria-label`; Chart.js canvases have accessible names; "Waiting for your first report" empty state has `role="status"` |
| Run detail (DASH-003) | Accordion `button` elements with `aria-expanded`; `role="dialog"` on Flowbite modal when opened; each test row is a `button` or `link` with the test name |
| Setup wizard (AUTH-002) | Progress indicator has `role="progressbar"` or step headings; every input has a `<label>` (ARIA `name`); "Next" / "Back" are `button`s |
| Login (AUTH-003) | `h1` "Sign in"; email/password inputs labeled; submit is `button[type=submit]`; error messages have `role="alert"` |
| Settings pages (SET-001/002/003) | Tab container has `role="tablist"`; each tab panel `role="tabpanel"`; autosave "✓ Saved" has `role="status"` |

### T2 — Backdrop-contrast WCAG re-check (blocking gate before T3)

Any diff that moves an element's backdrop requires a **numeric** contrast pass at T2. Do not proceed to T3 screenshots until this is green.

**Trigger conditions — if any of these is true in the diff, run the check:**

- A layout token changes vertical stacking (e.g., `@theme` `--spacing-*` tokens that affect header offset, `padding-top` on a layout wrapper).
- A region's `position` changes (`static` ↔ `fixed`/`sticky`/`absolute`) or its `z-index` is altered such that it overlays different content.
- A parent's `[data-theme]` value changes, or a descendant is relocated under a different theme zone.
- A background image, gradient, or solid `background-color` is swapped on a region that contains text or interactive elements.
- Any `@layer components` definition for a surface-containing class (`.run-card`, `.stat-tile`) changes its `background-*` property.

**T2 command pattern** (run inside a Playwright `page.evaluate()`, after the layout change ships):

```typescript
const ratio = await page.evaluate(() => {
  const fg = document.querySelector('<selector of the text/icon>');
  const bgEl = document.querySelector('<selector of the nearest painted backdrop>');

  const toRGBA = (cssColor: string) => {
    const c = document.createElement('canvas');
    const g = c.getContext('2d')!;
    g.fillStyle = cssColor;
    g.fillRect(0, 0, 1, 1);
    const [r, gg, b, a] = g.getImageData(0, 0, 1, 1).data;
    return { r, g: gg, b, a: a / 255 };
  };
  const composite = (f: any, b: any) => ({
    r: Math.round(f.r * f.a + b.r * (1 - f.a)),
    g: Math.round(f.g * f.a + b.g * (1 - f.a)),
    b: Math.round(f.b * f.a + b.b * (1 - f.a)),
  });
  const lum = ({ r, g, b }: any) => {
    const L = [r, g, b].map(c => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * L[0] + 0.7152 * L[1] + 0.0722 * L[2];
  };

  const fgc = toRGBA(getComputedStyle(fg!).color);
  const bgc = toRGBA(getComputedStyle(bgEl!).backgroundColor);
  const composited = composite(fgc, bgc);
  const L1 = lum(composited), L2 = lum(bgc);
  return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
});

// WCAG AA: body ≥ 4.5, large ≥ 3.0. AAA: body ≥ 7.0, large ≥ 4.5.
expect(ratio).toBeGreaterThanOrEqual(4.5);
```

**Gates before T3:**
- [ ] Foreground selector identified and computed color captured.
- [ ] Actual backdrop selector identified — trace upward until you find a non-transparent `background-color` or `background-image`, not just the text element's immediate parent.
- [ ] Contrast ratio ≥ 4.5:1 for body, ≥ 3.0:1 for large text (WCAG AA).
- [ ] If the ratio fails, adjust the token (light↔dark direction depends on the new backdrop) and re-check. **Do not take the screenshot until it passes.**

### T3 — Visual (Playwright screenshots / browser_subagent)

Reserve for visual sign-off after T1 and T2 are green.

- **Use cases:** dark-surface palette, Flowbite component fidelity, stat-tile proportions, chart rendering, run-card grid, modal appearance.
- **Scope rule:** one screenshot per design slice. Never full-page composites that span multiple components.
- **Matrix:** 1280×800 desktop only. The narrow 375×800 "smoke" check exists only to verify horizontal-scroll absence (CTRFHub is desktop-only per `viewport-mobile-first-desktop-only.md`) — it is not a T3 visual target.
- **Pre-condition:** backdrop-contrast gate (above) must be green. A screenshot that *looks* readable can still be a WCAG failure.

### Cautionary incidents

**2026-04-20 — Hero backdrop regression (translated from Drupal/PL2):**
A layout-token change zeroed the header-space token to let a hero region bleed to the top of the viewport. The nav, previously sitting on a light surface, now sat on the dark primary hero. The text-color token, calibrated for light backgrounds, produced a contrast ratio of **2.33:1 — failing AA body and large both**. The T3 screenshot looked "appropriately muted." A T2 contrast pass at the point of the backdrop change would have caught it immediately. Applicable to any CTRFHub layout change that relocates the top nav, dashboard header, or stat-tile row onto a different `[data-theme]` zone.

**2026-04-21 — "Srcset present ≠ srcset resolves" (translated):**
A component emitted six `<img>` tags with the expected `srcset` attributes. T1 checks (count of tags, alt text, srcset string present) all passed. The browser showed an empty strip because every derivative URL returned HTTP 500. The lesson for CTRFHub: when a T1 check operates on rendered HTML alone, ask "does the browser also need these URLs to resolve?" — relevant to artifact rendering in Run Detail (screenshots in `<img>`, videos in `<video>`, HTML reports in iframes). If the artifact URL is emitted but the storage backend 500s, T1 on the run-detail page alone will not detect it. Add an explicit T1 check that GETs each artifact URL and asserts `200 + Content-Type` image/*, video/*, text/html as appropriate.

### Good example

```typescript
// e2e/tests/run-detail.spec.ts — T1 → T2 → T3 in one spec
test('run detail page — skeleton-first verification', async ({ page }) => {
  // T1: route returns 200 with HTML
  const res = await page.goto('/runs/123');
  expect(res?.status()).toBe(200);

  // T2: structural skeleton correct
  const snap = await page.accessibility.snapshot();
  const h1 = findNode(snap, n => n.role === 'heading' && n.level === 1);
  expect(h1?.name).toMatch(/Run #123/);
  expect(findAll(snap, n => n.role === 'button' && /^Suite:/.test(n.name)).length).toBeGreaterThan(0);
  // No raw JSON in page text
  expect(await page.textContent('body')).not.toContain('{"results":');

  // T3: visual sign-off — only runs because T1 and T2 passed
  await expect(page).toHaveScreenshot('run-detail-1280x800.png', { fullPage: false });
});
```

### Bad example

```typescript
// ❌ Taking a screenshot before ARIA skeleton is verified
test('dashboard looks right', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveScreenshot('dashboard.png');  // T3 without T2
});
// Fix: add `accessibility.snapshot()` assertions first. If the H1 is missing
// or the stat tiles are unlabeled, the screenshot is an expensive way to
// discover it. Catch the structural failure at T2 in 5 seconds, not T3 in 60.

// ❌ Backdrop-contrast change verified only visually
test('new dashboard theme', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveScreenshot();  // ratio dropped from 9:1 to 2.3:1
});
// Fix: the [data-theme] change or any @layer .stat-tile backdrop edit
// triggers the backdrop-contrast gate above. Run the page.evaluate() ratio
// check before taking any screenshot; fail the test at T2 if ratio < 4.5:1.
```
