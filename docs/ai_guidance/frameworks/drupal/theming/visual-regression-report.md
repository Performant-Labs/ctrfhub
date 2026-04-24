# Visual Regression Report

Running log of T3 findings, newest at top. Written from the subagent/worker that took the screenshot, before returning.

---

## 2026-04-21 — /automated-testing-kit mobile T3 sign-off (F.3)

**User request:** Proceed with F.3 — mobile T3 at 375×667 for `/automated-testing-kit`, deferred from the 2026-04-20 Pass 3.A.3 session because the Chrome-extension `resize_window` call succeeded at the browser-chrome layer but the rendering viewport stayed at 1728px. Run via an alternative T3 path.

**Method:**
- Tier 1 curl (mobile UA) confirmed HTTP 200, `.book-landing` wrapper present (3 occurrences), `book-landing.css?tdtv8m` loaded, `<h1 class="page-title">` + value-prop h2 "End-to-end testing utilities…" + "What's inside" h2 all in markup, `<meta name="viewport" content="width=device-width, initial-scale=1.0">`.
- Tier 3 via Playwright + chromium in-sandbox (headless) at `viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true` with iPhone UA. Full-page + element-scoped screenshots saved to workspace folder; layout metrics read via `page.evaluate()`.

**Screenshots:**
- `t3-automated-testing-kit-mobile375-2026-04-21.png` (full page)
- `t3-automated-testing-kit-mobile375-hero-2026-04-21.png` (viewport only, above the fold)
- `t3-atk-mobile375-book-landing-2026-04-21.png` (element-scoped crop of `.book-landing`)

**Checklist (all pass):**

| Check | Evidence |
|---|---|
| Eyebrow / h2 / lede / CTA row stack cleanly and readable | Value-prop h2 computed `font-size: 28px` (clamp min at 375px since 3.5vw ≈ 13px); wraps across 3 lines inside the viewport width. Eyebrow "DRUPAL MODULE" renders as small amber caps. Lede flows normally under the h2. |
| CTA row wraps without awkward truncation | Primary "Read the Introduction →" (221×49) alone on row 1 at `top: 1583`; secondaries "Install" (85×51) + "Run your first test" (173×51) side-by-side on row 2 at `top: 1644`. Total row height 112px; gap 12px between rows. `flex-wrap: wrap` works as intended. |
| "What's inside" features list renders as a single column | `grid-template-columns: 243.234px` (single track; matches the `<640px` CSS path). All 6 list items stack vertically. |
| No horizontal overflow | `document.body.scrollWidth === window.innerWidth === 375`; `hasHorizontalScroll: false`. |

**Artifact caveat:** Element-scoped screenshot of `.book-landing` shows the sticky site header compositing over the CTA row — an artifact of Playwright's `locator.screenshot()` (scrolls the element into view and captures full element height, so the sticky header that overlaps the element at that scroll position gets composited into the frame). In natural scrolling, the sticky header is at the top of the viewport and the CTA row is unoccluded when the user reaches it. Not a real regression. Full-page screenshot shows the primary CTA rendered cleanly (white text on amber fill).

**Status:** ✅ Mobile T3 passes. Pass 3.A.3 is now fully signed off across desktop (1440, verified 2026-04-20) and mobile (375, verified 2026-04-21). Closes parking-lot item F.3.

---

## 2026-04-20 — /services Pass 2: atmospheric page-title backdrop

**User request:** After Pass 1 approval — "Pass 1 looks good. Proceed." The next item on the /services audit punch-list was P6 (atmospheric backdrop for the page-title band). Same mandate carried from Pass 1: use the 3-tier system, follow theme-change workflow, seek DRY opportunities across home + interior pages, cover mobile.

**Problem (carried from Pass 1 audit):**

Between the 80px sticky header and the first dy-section on /services, Drupal renders `.block-page-title-block` wrapping an unstyled `h1.page-title` (upstream margin: 80px 0 40px). Visually: 193px of bare off-white. Reads as a layout gap, not a deliberate band. No visual anchor for the page title, no transition cue between header and content.

Parent themes (neonbyte, dripyard_base) do not style `.block-page-title-block` — there is no upstream rule to override, only a void to fill.

**DOM-inspection gate (T2 probe `t2-page-title-audit.js`, 2026-04-20):**

```
/services  body.canvas-page.path-page  site-header-sticky.site-header-no-full-width
           .block-page-title-block  y=80 h=73 bg:transparent padding:0 margin:0
             > h1.page-title  margin 80px 0 40px  font-size 80/42px  color oklch(.15 .008 260)
/          body.canvas-page.path-frontpage
           .block-page-title-block  NOT rendered (block-visibility hidden on frontpage)
           hero sits directly under the transparent floating header
```

The homepage has `.canvas-page` on body but NO `.block-page-title-block`. That's the DRY asymmetry — any title-band rule scoped via `.canvas-page` is a safe no-op on the homepage. But for explicit intent the scope should name what it targets, not rely on the element's absence.

**Architectural pattern introduced (Pass 2's primary DRY contribution):**

```
Homepage hero intent       .canvas-page.path-frontpage
Interior canvas pages      .canvas-page:not(.path-frontpage)
```

Pass 1 split headers on the `.path-frontpage` axis. Pass 2 makes the inverse scope — `.canvas-page:not(.path-frontpage)` — a first-class architectural lever for "styling that applies to every interior canvas page but must not bleed into the homepage hero." Future interior-page work (Pass 3+) should reach for this selector rather than adding one-off `.path-*` rules.

**Side-effect found during T2, fixed inline before screenshots:**

Before Pass 2 the token `--space-for-fixed-header` was zeroed on `.canvas-page` (set by a prior pass so the homepage hero could bleed to y=0). That zero applied to every canvas page — including interior pages that DON'T want to bleed. T2 showed `.block-page-title-block` rendering at y=0 (under the sticky header) after Pass 2's initial edit. Split the token scope to mirror the new architectural pattern:

```
.canvas-page.path-frontpage        → --space-for-fixed-header: 0
.canvas-page:not(.path-frontpage)  → --space-for-fixed-header: 80px (matches header height)
```

Interior content now clears the header and title band sits flush below it — continuous header → band → content vertical read.

**Changes (one file, `css/layout/canvas.css`):**

1. Token scope split (`--space-for-fixed-header`), described above.
2. New section `§ atmospheric-backdrop` on `.canvas-page:not(.path-frontpage) .block-page-title-block`:
   - `position: relative; isolation: isolate;` — confine pseudo-element z-index to the band.
   - `padding-block: clamp(3.5rem, 6vw, 5rem)` desktop, tapering via container-query + media-query fallback to 40px (tablet) and 32px (mobile).
   - `padding-inline: var(--spacing-m)` desktop, `var(--spacing-xs)` ≤600px — so title text aligns with dy-section content below while the backdrop continues to bleed.
   - h1 `margin-block: 0` inside the band (band padding now governs vertical rhythm).
   - `::before` at `width: 100vw; left: 50%; transform: translateX(-50%); z-index: -2;` painting a linear gradient `color-mix(amber 4%, surface) → surface`. Hairline `border-bottom: 1px solid color-mix(loud 8%, transparent)` terminates the band.
   - `::after` at same full-bleed geometry with `z-index: -1`, painting `radial-gradient(ellipse 60% 120% at 18% 35%, color-mix(amber 12%, transparent) 0%, transparent 55%)` — soft morning-sun accent.

Tokens only — `--pl-color-amber` (primitive), `--theme-surface`, `--theme-text-color-loud`. No new tokens.

**T1 (rendered stylesheet):**

```
curl /themes/custom/performant_labs_20260418/css/layout/canvas.css?tdssgz
  | grep "canvas-page:not(.path-frontpage) .block-page-title-block"
  → 7 declarations served (rule, h1 zeroed, ::before gradient, ::after glow,
    ::before border-bottom override, 2× container-query pads, 2× @media pads)  ✅
```

**T2 (computed styles, `t2-ptb-after.js`):**

| Viewport | `rect.y` | `rect.h` | padding-block | `::before` width | `::after` width | h1 margin |
|---|---|---|---|---|---|---|
| /services 1440 | 80 | 233 | 80/80 | 1440px | 1440px | 0 |
| /services 768  | 80 | 153 | 40/40 | 768px  | 768px  | 0 |
| /services 375  | 80 | 103 | 32/32 | 375px  | 375px  | 0 |
| /        1440  | — | — | (block not rendered) | — | — | — |

`::before` background: `linear-gradient(oklch(0.99 0.007 70) 0%, rgb(255,255,255 → surface) 100%)`, border-bottom `1px solid oklch(0.15 0.008 260 / 0.08)`. `::after` background: `radial-gradient(60% 120% at 18% 35%, oklch(0.77 0.16 70 / 0.12) 0%, transparent 55%)`. All as designed.

**T3 (screenshots, `t3-pass2.js`):**

- `t3p2-services-desktop-band-2026-04-20.png` — amber wash top-left, title at 40px inset, backdrop bleeds to both viewport edges, hairline divider visible at ~y=313.
- `t3p2-services-tablet-band-2026-04-20.png` — scaled padding, glow still visible.
- `t3p2-services-mobile-band-2026-04-20.png` — tighter pad, title at 20px inset, glow visible.
- `t3p2-services-desktop-full-2026-04-20.png` — title's x-inset matches the "What we do generally" and "What we do specifically" section headings directly below. Vertical rhythm continuous.
- `t3p2-services-mobile-full-2026-04-20.png` — same alignment verified in the 375 column.
- `t3p2-home-regress-desktop-2026-04-20.png` — hero still bleeds to y=0, dark navy, transparent header over "Expert Drupal engineering" white text. No band, no backdrop. **Regression-clean.**
- `t3p2-home-regress-scroll50-2026-04-20.png` — header crossover (white translucent pill with dark text) identical to Pass 1 state. **No change to scroll-linked fill.**
- `t3p2-home-regress-mobile-2026-04-20.png` — mobile hero, same behavior. **Regression-clean.**
- `t3p2-contact-desktop-band-2026-04-20.png` — /contact returns a 404 which lacks `.canvas-page` on body; backdrop correctly does NOT apply. Confirms scope correctness.

**T3 judgement:**

| Scope | Result |
|---|---|
| /services desktop atmospheric band | ✅ pass — gradient + radial glow render as designed, title aligned |
| /services tablet | ✅ pass |
| /services mobile | ✅ pass |
| Title text alignment with content sections | ✅ pass (after §padding-inline refinement) |
| Sticky header → title band → content vertical read | ✅ pass — continuous, no gap |
| Homepage hero regression | ✅ pass — identical to Pass 1 state |
| Homepage scroll crossover regression | ✅ pass — identical |
| 404 page regression | ✅ pass — backdrop correctly absent |

**Residual (out of scope for Pass 2):**

- P2: Cartoon brain illustration on /services — node-level content fix.
- P5: Broken logo images in "We Speak" — content fix.
- "Services" h1 font-size and weight are upstream defaults (80/42px, weight 400). A typographic refinement pass could retune these for Keytail-vibe — not part of this pass.

**Architectural insight reinforced:**

The `.canvas-page:not(.path-frontpage)` scope introduced here complements the Pass 1 `.path-frontpage`-only header scope. Together they define a clean bifurcation of body-class intent:

- `.path-frontpage` = homepage hero intent (bleed-to-y=0, transparent-over-dark behaviour)
- `.canvas-page:not(.path-frontpage)` = interior canvas intent (clear the header, framed title, container-constrained content)

Future interior-page work should default to this scope.

---

## 2026-04-20 — /services Pass 1: scope narrowing + responsive card grid

**User request:** "Now turn your attention to /services. Audit first then present your plan." After approval: "Proceed and ensure you use the 3-tier system for testing… Since this is the second major page and the first example of an interior page, look for opportunities to perform changes in common to the home page and interior pages."

**Problems identified in audit (ranked):**

1. **Header nav invisible at scroll=0.** `.canvas-page` triggers translucent-white nav but /services has no dark hero — white-on-near-white. Accessibility fail.
2. **"What we do specifically" is a 20-item flat stack.** DOM already a 12-col CSS grid but every card spans all 12 — editor hadn't configured column_count.
3. **"What we do generally" is 4 flat prose rows.** Same grid-wrapper pattern, same issue.

**Changes (two files):**

`css/components/header.css` — narrowed the scope of five blocks (scroll-fill §1c, fallback §1d, nav-colour §5+§7, muted-white CTA §6) from `(.path-frontpage, .canvas-page)` to `(.path-frontpage)` only. The homepage has both body classes; services has only `.canvas-page`. Services therefore reverts to neonbyte's default (opaque 55% header, dark nav, amber pill). Homepage retains the full transparent-over-dark-hero treatment.

`css/layout/canvas.css` — added a responsive column-span rule for `.canvas-page .grid-wrapper__grid > .card`:

- desktop (≥901px): `grid-column: span 4` → 3 tiles per row
- tablet (601-900px): `grid-column: span 6` → 2 tiles per row
- mobile (≤600px): `grid-column: 1 / -1` → 1 tile per row

Plus tile chrome: `padding: 32px 40px`, `1px solid color-mix(… 10%, transparent)` border, `transform: translateY(-2px)` + box-shadow on hover (reduced-motion-guarded).

**Reference:** none — no Keytail slice for /services; decisions driven by the audit findings.

**Common-across-pages result:** The same `.canvas-page .grid-wrapper__grid > .card` rule will benefit any future interior canvas page using card-canvas paragraphs. The homepage's grid-wrapper holds non-`.card` children (verified via T2: cardCount=0), so it is untouched.

**T1 facts:**
- `/services` aggregation-off response links individual CSS files including our `components/header.css` and `layout/canvas.css` (query-string cache buster `?tdssgz`).
- `grep "\.canvas-page" header.css` — remaining matches are all in comments; zero active selectors (previously 9).
- `grep "grid-wrapper__grid > .card" canvas.css` — 9 matches (3 breakpoint × (desktop + media fallback) + hover).

**T2 facts (measured via t2-after.js):**

| Viewport/URL | `headerBgPercent` | Nav color | CTA bg | Card `grid-column` | Card width |
|---|---|---|---|---|---|
| /services 1440 | `55%` | `rgb(45,62,72)` ✅ | `rgb(245,158,11)` (amber) | `span 4` | 368px |
| /services 768  | `55%` | (hidden in hamburger) | amber | `span 6` | 281px |
| /services 375  | `55%` | (hidden in hamburger) | amber | `1 / -1` | 291px |
| /        1440 | `0%`  | `oklab(~white/0.75)` ✅ | `rgb(255,255,255)` white | — (no card children) | — |

Regression check confirms homepage scroll-linked fill and white CTA pill are unchanged.

**Screenshots (see `/mnt/Performant Labs Theme 2/`):**

/services after:
- `t3-services-after-desktop-fold-2026-04-20.png` — header visible, nav dark, amber CTA, "Services" H1 below
- `t3-services-after-desktop-cards-2026-04-20.png` — "What we do generally" 3-up card grid
- `t3-services-after-desktop-full-2026-04-20.png` — full-page layout
- `t3-services-after-tablet-fold-2026-04-20.png` — 768 width, hamburger
- `t3-services-after-tablet-full-2026-04-20.png` — 2-up card grid
- `t3-services-after-mobile-fold-2026-04-20.png` — 375 width, stacked 1-up
- `t3-services-after-mobile-full-2026-04-20.png` — full mobile layout

Homepage regression:
- `t3-home-regress-scroll0-2026-04-20.png` — scroll=0: transparent header over dark hero, translucent-white nav ✅
- `t3-home-regress-scroll50-2026-04-20.png` — scroll=50: full fill, dark nav, white-pill CTA with border ✅
- `t3-home-regress-mobile-2026-04-20.png` — mobile hero stack ✅

**T3 judgement:**

- ✅ **Header nav legibility on /services (P1 fixed):** dark navy text on light translucent band at scroll=0. Amber CTA pill with high contrast. The invisibility bug is eliminated.
- ✅ **3-up card grid on "What we do generally":** cards read as tiles, titles and descriptions breathe inside 32×40 padding, border outlines each tile. Tablet folds to 2-up; mobile to 1-up.
- ✅ **3-up card grid on "What we do specifically":** 18 short titles distribute across 6 rows × 3 columns. Scannable list. Tablet 2-up; mobile 1-up.
- ✅ **Homepage regression:** scroll=0 transparent header + translucent nav; scroll=50 full fill + dark nav + white CTA pill with border. No regression.
- ⚠ **Residual (not in scope of this pass):**
  - P2 cartoon brain illustration ("Our Services") — content issue, not CSS. Dated clip-art in middle of page.
  - P5 "We Speak" empty logo boxes — broken image refs, not CSS.
  - P6 page-title band has no atmospheric backdrop (flat pale band under the translucent header). Deferred to Pass 2.

**Common-across-pages pattern identified:**

The fix reveals a useful architectural distinction: `.path-frontpage` (hero intent) ≠ `.canvas-page` (layout intent). Theme rules that depend on a dark backdrop (transparent header, translucent nav, white CTA) should scope to the former; theme rules that depend on full-width layout (edge-to-edge sections, grid-wrapper card tiles) can scope to the latter. The header was incorrectly tied to `.canvas-page`; the card grid correctly ties to `.canvas-page`. Both are documented in the CSS with scope rationale.

**Status:** PASS for Pass 1 (P1 header legibility + P3/P4 card grid). P2/P5 are content-side; P6 deferred.

---

## 2026-04-20 — Scroll-linked progressive header fill (frontpage/canvas)

**User request:** "I still see a background around the main menu. Shouldn't it be transparent when the viewport is at the top so that the background gradient shows through? then, as the viewport moves down it should gradually turn to a solid white."

**Changes (one file, multi-pass):**

`css/components/header.css` (§1a–d, §6, §7) — scroll-timeline–driven progressive fill:

1. `@property --header-background-color-percent { syntax: "<percentage>"; … }` — registration enables interpolation across the otherwise opaque custom property.
2. Three keyframes drive the fill in concert: `pl-canvas-header-fill` (transparency → solid), `pl-canvas-header-shadow-fade` (none → subtle drop), `pl-canvas-header-blur-fade` (blur(0) → blur(10px)).
3. `@supports (animation-timeline: scroll())` branch applies animations to `.site-header`, `.site-header__shadow`, and `.site-header__container` with `animation-range: 0 50px`.
4. Nav-color keyframe swaps from translucent-white to `--theme-text-color-soft` using `steps(2, jump-none)` — a true step function, NOT a linear cross-fade.
5. `@supports not (animation-timeline: scroll())` fallback reuses neonbyte's existing `.is-scrolled` JS class with CSS transitions.
6. `prefers-reduced-motion: reduce` disables the scroll animation.
7. `.header-cta` gets a 1px `color-mix(… 12%, transparent)` border so the white pill stays visible against both dark hero and white header.

**Reference:** `docs/pl2/keytail-design/keytail-desktop-homepage.jpg`

**Screenshots (desktop 1440×900, cropped to top 240px):**

- scroll=0:   `t3-scroll-0-header-desktop-2026-04-20.png` — fully transparent, hero visible
- scroll=15:  `t3-scroll-15-header-desktop-2026-04-20.png` — 30% fill, light nav still legible
- scroll=25:  `t3-scroll-25-header-desktop-2026-04-20.png` — step boundary, dark nav on mid-grey (low contrast but readable)
- scroll=50:  `t3-scroll-50-header-desktop-2026-04-20.png` — fully filled white, final state
- scroll=300: `t3-scroll-300-header-desktop-2026-04-20.png` — stable end state
- mobile:     `t3-scroll-0-mobile-2026-04-20.png` — transparent header, hamburger upper-right

**T1 facts:**
- Served `header.css` contains all four new rules (grep confirmed: `animation-range: 0 50px` × 4, `border: 1px solid color-mix` × 1, `@property --header-background-color-percent` × 1).
- `CSS.supports('animation-timeline: scroll()')` → `true` in headless chromium.

**T2 facts (measured via probe-fine.js at 1440×900 viewport):**

Bg-fill percentage tracks scroll depth linearly over 0-50px:

| scrollY | percent | effective bg | nav contrast | WCAG AA body (4.5:1) |
|---|---|---|---|---|
|  0 | 0%   | rgb(0,0,0)       | 11.42 | ✅ AAA |
|  5 | 10%  | rgb(25,24,25)    | 9.63  | ✅ AAA |
| 10 | 20%  | rgb(48,48,48)    | 7.18  | ✅ AAA |
| 15 | 30%  | rgb(73,72,73)    | 4.95  | ✅ AA  |
| 20 | 40%  | rgb(97,96,96)    | 3.41  | ❌ (AA large) |
| 24 | 48%  | rgb(116,115,115) | 2.57  | ❌     |
| **25** | **50%**  | **rgb(121,120,121)** | **1.48**  | **❌ worst point (step boundary)** |
| 30 | 60%  | rgb(145,144,145) | 2.05  | ❌     |
| 40 | 80%  | rgb(194,192,193) | 3.60  | ❌ (AA large) |
| 45 | 90%  | rgb(218,216,217) | 4.59  | ✅ AA  |
| 50+ | 100% | rgb(242,240,241) | 5.74  | ✅ AA  |

**Accessibility analysis:**
- **Legitimate static states (scroll=0 and scroll≥45): both pass WCAG AA.** Users rest in these states during ordinary use.
- **Transient non-AA zone: scroll ≈ 20-45** (~25px of scroll). During active scroll this window passes in <0.2 seconds of wheel input; a user pausing here is unusual.
- **Step function prevents the "invisible text" regression.** An earlier experiment (linear cross-fade over 0-200px range) produced a mid-grey-on-mid-grey ghost state at scroll=100 where nav text completely vanished — screenshot confirmed. Switching to `steps(2, jump-none)` keeps dark glyph strokes visible at the step boundary; low contrast, but readable outlines remain.
- **CTA border (1px, 12% alpha)** fixes white-on-white invisibility at scroll≥50. Measured `ctaPillVsBackdrop` ratio of 1.13:1 without the border; the border provides edge definition that contrast measurement doesn't capture.

**T3 judgement:**
- ✅ scroll=0: fully transparent, hero gradient visible through the header area as requested. Nav + CTA legible.
- ✅ scroll=15: transitional midway, still comfortably readable. Feels "gradual" per request.
- ⚠ scroll=25: worst-contrast frame. Text is dark-on-mid-grey; WCAG-fail but visible-as-text. Distinctly ugly for a fraction of a second during scroll.
- ✅ scroll=50: final fully-filled white header. Nav dark, CTA pill with subtle border. Matches Keytail's "quiet nav" aesthetic.
- ✅ scroll=300: stable final state. No visual artifacts.
- ✅ Mobile scroll=0: transparent header, hamburger upper-right, hero stack visible.

**Trade-off noted for user:**
The transient low-contrast zone (~25px of scroll, ~0.2s of motion) is the cost of animating color against an animating backdrop. It cannot be fully eliminated without either (a) shrinking the animation range to feel like a snap rather than a fade, or (b) adding a non-token visual element like a text-shadow halo. Neither aligned with the "gradual turn to solid white" intent. The current 50px range is the tightest that still reads as "gradual" in T3.

**Residual / separable:**
- Menu IA (5 items → 3) still pending — see `docs/pl2/keytail-design/menu-ia-recommendation.md`. Not CSS.

**Status:** PASS for the user's request as written. Transient mid-scroll contrast documented honestly; the cookbook's backdrop-change rule correctly flagged this class of issue — the rule now has a second worked example.

---

## 2026-04-20 — Canvas atmosphere pass: hero bleed + nav re-tune + muted CTA

**Changes (three-part pass, done together):**

1. `css/layout/canvas.css` — new L4 block zeroes `--space-for-fixed-header` on `.canvas-page`. The hero now starts at y=0 instead of y=160. Fixed transparent header floats over it.
2. `css/components/header.css` §5 (retuned) — nav color on canvas re-pointed from `--theme-text-color-soft` (dark-grey, correct for light bg) to `color-mix(in oklch, var(--white) 75%, transparent)` (light-grey, correct for dark hero). Contrast ratio moved 2.33:1 → 9.15:1. WCAG AA body ✅.
3. `css/components/header.css` §6 (new) — `.canvas-page/.path-frontpage .header-cta` becomes white-on-dark instead of amber-on-dark. Non-canvas pages keep the amber (§4 still rules).

**Reference:** `docs/pl2/keytail-design/keytail-desktop-homepage.jpg`

**Screenshots:**
- Desktop before: `t3-home-header-desktop-2026-04-20.png`
- Desktop after (single menu-tune pass): `t3-home-header-desktop-after-2026-04-20.png`
- Desktop final (all three changes + AA retune): `t3-home-desktop-final-2026-04-20.png`
- Mobile final: `t3-home-mobile-final-2026-04-20.png`

**T1 facts:**
- Aggregated CSS contains all three new rules (grep confirmed).
- Computed `--space-for-fixed-header` on `.canvas-page` = `0`.
- Computed `.layout-container` `padding-top` = `0px`.
- Computed `.hero` `top` = `0`, `height` = `900` (full viewport).
- Computed `.header-cta` bg = `rgb(255,255,255)`, color = `rgb(45,62,72)`.
- Computed `.primary-menu__link--level-1` color = `oklch(~1 0 none / 0.75)` → composites to `rgb(198,201,205)` on hero bg.

**T2 facts:**
- Token override approach preserves neonbyte's cascade intent. `--space-for-fixed-header` still ships a single-consumer contract; we just narrowed it for canvas.
- Specificity math:
  - `.canvas-page` override of token (0,1,0) ties with `:root` default (0,1,0); cascade proximity favours the body-closer declaration. ✅
  - `.canvas-page .site-header .primary-menu` (0,3,0) beats neonbyte's `.primary-menu` (0,1,0). ✅
  - `.canvas-page .site-header .header-cta` (0,3,0) beats our own `.header-cta` default (0,1,0). ✅
- Nav color direction flipped from light-bg-appropriate to dark-bg-appropriate; the rule now encodes which way contrast must travel. Rationale comment in source.

**T3 judgement:**
- ✅ Hero fills viewport edge-to-edge from top. Header floats over it transparently.
- ✅ Nav reads as "present but not demanding" — matches Keytail's quiet-nav aesthetic (direction-inverted for our dark hero vs. their light sky).
- ✅ White CTA reads as a primary action without competing with the hero.
- ✅ Mobile layout stacks correctly; hamburger in upper-right, hero content centered, headline + dual CTA visible above the fold.

**Accessibility (WCAG 2.1):**
- Nav-on-hero contrast: 9.15:1 (AAA pass for body and large text). The retune from 2.33:1 was the critical accessibility fix of the pass.
- CTA button: white bg + dark-navy text on any surface → ≥15:1 everywhere. ✅

**Residual / separable:**
- Menu still carries 5 items vs. Keytail's 3 — that's a Drupal menu-config (L1) change, not a theme-CSS change. Recommendation written to `docs/pl2/keytail-design/menu-ia-recommendation.md`.
- Logo wordmark vs. Keytail's icon-only mark — asset swap, separable.

**Status:** PASS for the three deltas flagged after the initial main-menu pass. Menu IA remains as the user-executable follow-up.

---

## 2026-04-20 — Main menu understatement (canvas/frontpage) [first pass, now superseded by the block above]

**Change:** `css/components/header.css` §5 added — re-points `--top-level-link-color` to `var(--theme-text-color-soft)` on `.path-frontpage .site-header .primary-menu` / `.canvas-page .site-header .primary-menu`.

**Reference:** `docs/pl2/keytail-design/keytail-desktop-homepage.jpg`

**Slice:** above-fold desktop header + first hero band (1440×900 viewport).

**Before:** `/sessions/.../Performant Labs Theme 2/t3-home-header-desktop-2026-04-20.png`

**After:** `/sessions/.../Performant Labs Theme 2/t3-home-header-desktop-after-2026-04-20.png`

**T1 facts:**
- Aggregated header.css contains the new rule (grep count 1).
- Computed `--top-level-link-color` on `.primary-menu` moved from `rgb(45,62,72)` → `rgb(85,95,104)`.
- Computed `color` on `.primary-menu__link--level-1` tracks the token change; no consumer-rule edit required.

**T2 facts:**
- Specificity: our declaration at `.canvas-page .site-header .primary-menu` (0,3,0) beats neonbyte's at `.primary-menu` (0,1,0). No `!important`, no layer tricks.
- Token chain: `--top-level-link-color` → `--theme-text-color-soft` → `--neutral-700` on `.theme--light`. L3 theme-layer fix, not L5 component-local.
- Weight and size untouched (still `normal`, `16px`). Neonbyte defaults already match Keytail on these axes.

**T3 judgement:**
- ✅ Nav items read as softer, blending into the light band rather than punching against it.
- ⚠ Residual deltas vs. Keytail (NOT addressed in this pass — flagged for user decision):
  1. Hero does not bleed to top of viewport; the transparent header sits over a light `theme-surface` band that is distinct from the hero's dark-navy section below. Keytail's hero fills the viewport under a floating header.
  2. Five nav items vs. Keytail's three (information-architecture question, not CSS).
  3. `Call today` pill remains high-saturation amber; Keytail's CTA is a muted white pill.

**Status:** PASS for the narrow "make the main menu not stand out" request. Adjacent atmospherics (hero bleed, CTA saturation) are separable follow-ups.
