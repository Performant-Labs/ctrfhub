# Verification Cookbook

This document is the authoritative reference for the **Three-Tier Verification Hierarchy**. It defines the "Skeleton-First" workflow designed to maximize developer velocity by using accessibility (ARIA) data as a high-speed diagnostic lens.

---

## The Three-Tier Hierarchy

Always use the fastest tool that provides sufficient structural confirmation before escalating to slower, more resource-intensive tools.

| Tier | Method | Speed | Diagnostic Goal |
|---|---|---|---|
| **Tier 1** | **Headless (Instant)** | ⚡ 1–5s | Server-side state, HTTP status, DOM tag presence, CSS variables |
| **Tier 2** | **Structural Skeleton (Fast)** | 🚀 5–10s | Assembly verification, component presence, H1–H6 levels, buttons, and functional links |
| **Tier 3** | **Visual Fidelity (Slow)** | 🐢 60–90s | Final visual regression, pixel-level alignment, color-matching, and layout spacing |

---

## Tier 1 — The Pulsing Check (Headless)

Use `curl` for instant confirmation of non-visual state.

- **HTTP Status**: `ddev exec "curl -sk -o /dev/null -w '%{http_code}' [url]"`
- **Heading Tag**: `ddev exec "curl -sk [url] | grep -o '<h1>[^<]*</h1>'"`
- **CSS variable check**: `ddev exec "curl -sk [url] | grep -o 'theme-setting-base-primary-color:[^;]*'"`
- **Nav Link audit**: `ddev exec "curl -sk [url] | grep '/articles/my-page'"`

### Common Tier 1 Audit Patterns

Cheap, deterministic checks over the server-rendered HTML. Run these first — they fail loudly and in milliseconds when a component didn't render, and they run without a browser.

#### 1. Canvas Image-Prop Render Check

When a Canvas component with an `entity_reference` image prop is expected to render (e.g., a logo grid, card image, hero media), Tier 1 can verify it directly. Failure modes like Rule F silent coercion (see `canvas-scripting-protocol.md`) are invisible in watchdog; only the rendered HTML surfaces them.

```bash
# A) Count the <img> tags actually emitted inside the component section.
#    Replace the section anchor selector with whatever wraps your component group:
ddev exec "curl -sk [url] | grep -o '<img[^>]*data-component-id=\"canvas:image\"' | wc -l"
# Expected: the number of component instances you placed (e.g., 6 for a 6-logo trust bar).

# B) Verify Canvas emitted the component wrapper with its image-or-media marker.
#    Missing wrapper = the component didn't render at all (template error, wrong component_id).
#    Wrapper present but no <img> = classic silent image-prop coercion (Rule F).
ddev exec "curl -sk [url] | grep -c 'data-component-id=\"canvas:image\"'"

# C) Confirm responsive srcset is present — proves the image was resolved as a Media entity,
#    not a raw `src` string. Raw-src renders omit srcset entirely.
ddev exec "curl -sk [url] | grep -o 'srcset=\"[^\"]*\"' | head -3"

# D) Cross-check alt text against what you wrote. Absent/empty alt = wrong media entity
#    or alt field not copied through at render time.
ddev exec "curl -sk [url] | grep -o 'alt=\"[^\"]*\"' | head -10"

# E) ⚠️  REQUIRED — Verify each srcset URL actually resolves to an image.
#    "srcset present" ≠ "browser sees an image." Check C only proves the HTML string
#    exists; the browser still renders nothing if every derivative URL 500s.
#    Common trigger: SVG source file + image-bundle media → Drupal tries to generate
#    AVIF derivatives → image toolkit can't rasterize SVG → HTTP 500 per entry.
ddev exec "bash -lc '
  HTML=\$(curl -sk [url])
  # Extract both src= values and each comma-separated entry in srcset=
  printf %s \"\$HTML\" | grep -oE \"src=\\\"[^\\\"]+\\\"|srcset=\\\"[^\\\"]+\\\"\" \\
    | sed -E \"s/^src=\\\"//;s/^srcset=\\\"//;s/\\\"\$//\" \\
    | tr \",\" \"\\n\" | awk \"{print \\\$1}\" | sort -u \\
    | while read -r u; do
        [ -z \"\$u\" ] && continue
        code=\$(curl -sk -o /dev/null -w \"%{http_code} %{content_type}\" \"http://localhost\$u\")
        printf \"%s  %s\\n\" \"\$code\" \"\$u\"
      done
'" | sort | uniq -c | sort -rn
# Expected: every line 200 + image/* content-type.
# Any 500 "Error generating image" or text/html response = broken render; imgs won't display.
```

**Interpretation table:**

| Wrapper count | `<img>` count | srcset present? | All srcset URLs 200 + image/*? | Likely cause |
|---|---|---|---|---|
| Expected | Expected | Yes | Yes | ✅ Rendering correctly. |
| Expected | Expected | Yes | **No — 500s** | **Derivative pipeline mismatch** — source file type isn't compatible with the derived format (classic: SVG source + AVIF derivative). Fix the source (rasterize) or the pipeline, not the component wiring. |
| Expected | 0 | n/a | n/a | Silent image-prop coercion (Rule F). Dump the component inputs; re-apply with a valid shape. |
| 0 | 0 | n/a | n/a | Component itself didn't render — check `component_id`, schema, Twig. |
| Expected | Expected | No | n/a | Raw `src` in inputs (Rule A). Prop isn't resolving as a Media entity. |

> **Lesson — "srcset present" is necessary but not sufficient.** Check C (srcset presence) and Check E (srcset resolution) measure different things. Skipping E produces false positives where the Tier 1 audit reports "rendering correctly" while the browser shows a blank section. Always run E before declaring an image-prop component green. See **Incident — 2026-04-21, trust bar SVG/AVIF mismatch** at the end of this document.

#### 2. Component Wrapper Presence

Before Tier 2 ARIA, confirm the server actually emitted the expected component wrappers. This separates "server didn't render" from "server rendered but ARIA tree surprised me":

```bash
# Count by component type — substitute the SDC id your theme uses.
ddev exec "curl -sk [url] | grep -c 'data-component-id=\"sdc.<theme>.<component>\"'"
```

Missing wrappers indicate a render-side failure (template error, missing required prop, enum ceiling violation) that will never surface in the ARIA tree because the HTML it would describe isn't there.

---

## Tier 2 — The High-Speed Structural Lens (ARIA)

Use the Accessibility (ARIA) Tree via the `read_browser_page` tool for all structural and JS-rendered content verification. This is the **authoritative developer loop** for construction testing.

### The "Skeleton-First" Workflow
1. **Assemble** the component or page using Drush/PHP.
2. **Audit Tier 2** immediately: Confirm the component exists in the A11y tree and has the correct roles/labels.
3. **Iterate** if the skeleton is broken (5s fix loop).
4. **Escalate to Tier 3** only when the skeleton is 100% correct.

### Common Tier 2 Audit Patterns

#### 1. Verifying a Hero Section
- [ ] Record has `main` or `banner` landmark.
- [ ] Contains `Heading Level 1` with the expected title.
- [ ] Contains a `button` or `link` with the CTA text (e.g., "Get Started").

#### 2. Verifying a Sidebar Navigation (Books/Docs)
- [ ] Contains a `navigation` region.
- [ ] The current page link has the `aria-current="page"` status.
- [ ] Child links exist in the correct hierarchy (depth indicated in the tree).

#### 3. Verifying a Logo Grid
- [ ] Contains a `list` or `region` dedicated to logos.
- [ ] Each logo has a functional `aria-label` or `alt` text and is a `link`.

#### 4. Backdrop Changes — Re-run Contrast, Don't Re-screenshot

**Rule:** Any layout change that moves an element's backdrop requires a fresh T2 contrast pass, not just a T3 screenshot.

A screenshot can *look* readable at thumbnail-resolution while the underlying contrast ratio is failing WCAG. T3 is a vision-token channel; accessibility is a numeric property. Measure it numerically.

**Trigger conditions — run this check if any of the following is true in the diff:**

- A layout token that affects vertical position of a region changes (e.g., `--space-for-fixed-header`, `--container-offset`, `padding-top` on a layout wrapper).
- A region's `position` changes (`static` ↔ `fixed`/`sticky`/`absolute`) or its `z-index` is altered such that it now overlays different content.
- A parent's `theme--*` class changes, or a descendant is relocated under a different theme zone.
- A background image or gradient is swapped on a region that contains text or interactive elements.
- An ancestor's `background-color` / `background-image` changes.

**T2 command pattern:**

```js
// Run inside a Playwright page.evaluate() call, after the layout change ships.
const fg = document.querySelector('<selector of the text/icon>');
const bgEl = document.querySelector('<selector of the nearest painted backdrop>');

// Resolve CSS colors to sRGB via canvas so oklch(), color-mix(), rgba() all work.
const toRGBA = (cssColor) => {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  g.fillStyle = cssColor;
  g.fillRect(0, 0, 1, 1);
  const [r, g_, b, a] = g.getImageData(0, 0, 1, 1).data;
  return { r, g: g_, b, a: a / 255 };
};
const composite = (f, b) => ({
  r: Math.round(f.r * f.a + b.r * (1 - f.a)),
  g: Math.round(f.g * f.a + b.g * (1 - f.a)),
  b: Math.round(f.b * f.a + b.b * (1 - f.a)),
});
const lum = ({ r, g, b }) => {
  const L = [r, g, b].map(c => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * L[0] + 0.7152 * L[1] + 0.0722 * L[2];
};

const fgColor = toRGBA(getComputedStyle(fg).color);
const bgColor = toRGBA(getComputedStyle(bgEl).backgroundColor);
const composited = composite(fgColor, bgColor);
const L1 = lum(composited), L2 = lum(bgColor);
const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
// WCAG AA: body ≥ 4.5, large ≥ 3.0. AAA: body ≥ 7.0, large ≥ 4.5.
```

**Gates:**
- [ ] Foreground selector identified and `color` computed.
- [ ] Actual backdrop selector identified (the element whose paint the text lands on — **not** always the text element's immediate parent; trace upward until you find a non-transparent `background-color` or a `background-image`).
- [ ] Contrast ratio ≥ 4.5:1 for body, ≥ 3.0:1 for large text (WCAG AA).
- [ ] If the ratio fails, fix direction of the color (light→dark or dark→light depends on the new backdrop) and re-check. Do **not** proceed to T3.

**Incident reference — 2026-04-20, PL2 canvas hero:** a layout change zeroed `--space-for-fixed-header` to let the hero bleed to the top of the viewport. The nav, previously sitting on a light `theme-surface` band, now sat on dark navy `theme--primary` hero. Nav color token (`--theme-text-color-soft`) was calibrated for light backgrounds; on the new dark backdrop the contrast ratio was **2.33:1 — failing AA body and AA large both**. The T3 screenshot at desktop viewport did not obviously flag this — it looked "appropriately muted". A T2 contrast pass at the point of backdrop-change would have caught it immediately. Retuning the token to `color-mix(in oklch, var(--white) 75%, transparent)` brought the ratio to **9.15:1 (AAA body pass)**. Documented in `visual-regression-report.md` under that date.

---

## Tier 3 — Visual Fidelity (Screenshots)

Reserve `browser_subagent` screenshots exclusively for visual sign-off.

- **Use Cases**: Correct padding/margins, color-matching against design references, z-index overlaps, and mobile menu animations.
- **Efficiency Rule**: Follow Section 10 of the Operational Guidance to batch all screenshots into a single subagent call across multiple viewport positions.
- **Gate before T3**: If the current change moved an element's backdrop (layout token change, position switch, theme-zone relocation, background swap), run the T2 **Backdrop Changes** contrast check before taking the screenshot. A visually-muted screenshot can still be a WCAG failure.

---

## Why this is 20x Faster
- **Payload Size**: An ARIA snapshot is typically 10–15KB, while a 4K screenshot context can exceed 5MB in vision-tokens.
- **Processing Speed**: LLMs can "see" a bug in text (e.g., a missing button in the list) much faster than they can find it in a complex image.
- **Zero Pixel Noise**: Structural testing ignores CSS "glitches" that don't affect function, allowing the developer to focus on assembly integrity first.

---

## Incident Appendix

### 2026-04-21 — Trust bar SVG/AVIF mismatch (false-positive Tier 1)

**What happened.** On the PL2 homepage rebuild, Section 2 (6-logo trust bar) was assembled by binding 6 `logo-item-canvas` components to 6 existing media entities (mids 41–46, `image` bundle). A Tier 1 audit ran checks A–D from the Canvas Image-Prop Render Check pattern:

- A) 6 `<img data-component-id="canvas:image">` tags — ✅ expected count.
- B) 6 component wrappers — ✅ present.
- C) srcset attribute present on every img — ✅ present.
- D) alt text matched the 6 client names — ✅ correct.

Tier 1 was declared green and the work proceeded to the next section. The user opened the page in a real browser and saw **no logos rendering** — an empty horizontal strip where the trust bar should have been.

**Root cause.** The 6 source files were SVGs uploaded into the `image` media bundle. Canvas's `image` component unconditionally emits a responsive srcset via `src_with_alternate_widths` + the `toSrcSet` Twig filter. Those srcset URLs are Drupal image-style derivatives that request AVIF output. The image toolkit cannot rasterize SVG into AVIF, so every one of the 48 derivative URLs (6 logos × 8 widths) returned **HTTP 500 "Error generating image."** Browsers pick srcset preferentially over src fallback, so nothing displayed.

**Why Tier 1 missed it.** Checks A–D are all server-HTML checks. They verify that Drupal *emitted* an `<img>` tag with the expected attributes, but they never request the URLs those attributes point to. The rendered HTML was indistinguishable between "works" and "every derivative 500s." The gap was: *srcset string exists ≠ srcset URLs resolve to images.*

**Amendment.** Check E ("REQUIRED — Verify each srcset URL actually resolves to an image") was added and is now gated as mandatory before any image-prop component can be declared rendering correctly. The interpretation table added a row for the "srcset present, URLs 500" failure mode pointing at derivative-pipeline mismatch (not component wiring) as the fix axis.

**Red herring worth noting.** The first remediation attempt moved the media from the `image` bundle to the `svg_image` bundle (which uses `field_media_svg_image` and, on paper, bypasses raster image styles). It made no difference because the Canvas `image` component template emits srcset based on the *component* template, not the media bundle — the bundle swap doesn't affect Canvas's render pipeline. The working fix was to rasterize each SVG to a 600px-wide PNG via ImageMagick inside DDEV, create new `image`-bundle media entities backed by those PNGs (mids 53–58), and overlay-patch the 6 `logo-item-canvas` components to point at the new mids. After a cache rebuild, all 54 src + srcset URLs returned 200 + image/png.

**Takeaway for future Tier 1 audits:**
- When a check operates on rendered HTML alone, ask: "does the browser also need these URLs to resolve?" If yes, add a resolution check to Tier 1 — don't defer to Tier 3.
- Bundle swaps are cheap to try but usually the wrong lens for Canvas render issues. Canvas components render the same way regardless of the source media bundle; the render pipeline is in the component template, not the media entity.
