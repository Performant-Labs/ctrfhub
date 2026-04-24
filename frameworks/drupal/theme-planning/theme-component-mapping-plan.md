# Keytail Canvas Page — Component Mapping Plan
## Theme: `performant_labs_20260411` · Base: `neonbyte` → `dripyard_base`

This document is the **Phase 3 output** of the AI-Guided Theme Generation SOP.
It maps every design slice to native Dripyard SDC components, identifies gaps
requiring bespoke SDCs, and defines the Canvas assembly strategy.

**Status**: Approved — Phase 4 (Page Template Architecture) is next.

---

## Reference Assets

| File | Purpose |
|------|---------|
| `designs/keytail-desktop.webp` | Full-page desktop reference (2000 × 9902 px) |
| `designs/keytail-mobile.webp` | Full-page mobile reference |
| `designs/00_menu.webp` | Slice: Navigation bar |
| `designs/01_hero.webp` | Slice: Hero section |
| `designs/02_features_search_changed.webp` | Slice: Feature cards |
| `designs/03_carousel_built_different.webp` | Slice: Horizontal carousel |
| `designs/04_content_engine.webp` | Slice: Dashboard tabs |
| `designs/05_designed_for_teams.webp` | Slice: 2-col teams section |
| `designs/06_graph_stocks.webp` | Slice: Stock graph |
| `designs/07_faq.webp` | Slice: FAQ accordion |
| `designs/08_footer.webp` | Slice: Footer |

---

## Native Dripyard Component Library (dripyard_base)

Available SDCs confirmed in `web/themes/contrib/dripyard_base/components/`:

`accordion` · `background-image` · `button` · `canvas-image` · `card` ·
`card-canvas` · `card-full-image` · `carousel` · `content-card` · `heading` ·
`horizontal-line` · `icon` · `icon-card` · `icon-list` · `logo-grid` ·
`menu-block` · `menu-footer` · `pill` · `statistic` · `tabs` · `tab-group` ·
`tags` · `teaser` · `testimonial` · `testimonial-canvas` · `text` ·
`title-cta` · `video-player` · `video-youtube`

Available SDCs confirmed in `web/themes/contrib/neonbyte/components/`:

`header` · `header-search` · `primary-menu` · `mobile-nav-button` ·
`language-switcher` · `footer` · `hero` · `header-article` · `html-header` ·
`icon`

---

## Per-Slice Component Mapping

---

### Slice 00 — Navigation Bar (`00_menu.webp`)

**Design**: Transparent sticky header. Left: Keytail wordmark logo. Center: horizontal
primary nav links. Right: "Sign in" text link + "Get started" amber CTA button.
Mobile: collapsible hamburger.

| Element | Native Component | Theme Wrapper | Notes |
|---------|-----------------|---------------|-------|
| Header shell | Neonbyte `header` | `theme--white` | Rendered via site header region — not a Canvas block |
| Logo | `header-logo` | — | Standard Drupal site branding block |
| Primary nav | `primary-menu` | — | Standard menu block |
| CTA button | `button` | — | Requires amber variant CSS |
| Mobile toggle | `mobile-nav-button` | — | Native |

**Customisation required** (CSS in `css/base.css`):
- Sticky + transparent header scrolling to opaque → CSS `position: sticky` + `backdrop-filter`
- Amber "Get started" button variant (`.button--cta`) → `css/base.css`

**Bespoke SDC needed**: ❌ None — handled by site regions.

---

### Slice 01 — Hero (`01_hero.webp`)

**Design**: Full-width dark section. Deep green-to-teal radial gradient background
masking a clipped dashboard screenshot image. Large bold headline:
_"Get found. Automatically."_ Subtitle paragraph. Search input field with
"Start for free" button. Gradient fades from green/teal at top to dark navy at
bottom-right. Dashboard image appears to bleed out of the section boundary.

| Element | Native Component | Theme Wrapper | Notes |
|---------|-----------------|---------------| ------|
| Hero shell | Neonbyte `hero` | `theme--primary` | `height: large`, `position_behind_against_screen_top: true` |
| Background media | `background-image` (in `hero_media` slot) | — | Gradient CSS applied via `css/base.css` on `.hero__media` |
| Headline + subtitle | `title-cta` (in `hero_content` slot) | — | `heading_style: h1`, `layout: default` |
| CTA button | `button` (inside `title-cta`) | — | `button_style: primary` |

**The native `hero` component covers this fully.** It accepts:
- `theme: primary` → dark navy wrapper
- `hero_media` slot → `background-image` component; the green/teal gradient is applied
  via a CSS rule targeting `.hero__media` in `css/base.css` (no disk file needed)
- `hero_content` slot → any content component
- `position_behind_against_screen_top: true` → handles sticky header bleed

**Customisation required** (CSS only, in `css/base.css`):
- Radial green/teal gradient on `.hero__media` → `background: radial-gradient(...)`
- Dashboard image absolutely positioned inside `.hero__media` with `clip-path`

**Bespoke SDC needed**: ❌ None — native `hero` + CSS overrides.

---

### Slice 02 — Features: "Search has changed" (`02_features_search_changed.webp`)

**Design**: White background. Section eyebrow + headline. 3-column card grid.
Cards are elevated (drop shadow), contain a UI screenshot at top, a bold card
title, and a short descriptor paragraph. Cards feel "floating" with rounded corners.

| Element | Native Component | Theme Wrapper | Notes |
|---------|-----------------|---------------|-------|
| Section wrapper | Canvas grid row (3-col) | `theme--white` | Standard Canvas layout |
| Eyebrow + headline | `heading` | — | Two heading blocks stacked |
| Feature cards | `content-card` | — | Canvas variant available |

**Customisation required**:
- Card drop-shadow + rounded corner elevation → scoped CSS
- Screenshot image filling card top area → `canvas-image` slot inside `content-card`

**Bespoke SDC needed**: ❌ None — `content-card` covers this with CSS tuning.
Scoped CSS file: `components/content-card/content-card.css` (inside `_20260411`)

---

### Slice 03 — Carousel: "Built different" (`03_carousel_built_different.webp`)

**Design**: Light grey background. Section headline. 4 horizontally scrollable cards.
Each card: rounded dark image at top, category pill tag, bold title, short body, and
a black pill-shaped "→" arrow button. Cards overflow the container width, implying
a CSS scroll-snap or JS carousel.

| Element | Native Component | Theme Wrapper | Notes |
|---------|-----------------|---------------|-------|
| Section wrapper | Canvas section | `theme--light` | Grey surface |
| Headline | `heading` | — | |
| Carousel shell | `carousel` | — | Native dripyard_base |
| Individual cards | `card` (`card-canvas` variant) | — | |
| Category pills | `pill` | — | Inside card |
| Arrow CTA | `button` | — | Black pill variant |

**Customisation required**:
- Horizontal snap-scroll behaviour → CSS override on `.carousel` wrapper
- Black pill button variant (`.button--pill-dark`) → `css/base.css`
- Card image with rounded top corners → scoped CSS

**Bespoke SDC needed**: ❌ None — `carousel` + `card` covers this with CSS.

---

### Slice 04 — Content Engine Dashboard (`04_content_engine.webp`)

**Design**: Light grey background. Centered headline + subtitle. Below: a tab switcher
row ("Discover" / "Create" / "Publish" — active tab underlined). Below tabs: a large
dark-mode dashboard screenshot that changes based on active tab. Dashboard image has
subtle shadow and rounded corners. This is the page's primary interactive section.

| Element | Native Component | Theme Wrapper | Notes |
|---------|-----------------|---------------|-------|
| Section wrapper | Canvas section | `theme--light` | Grey |
| Headline + subtitle | `heading` + `text` | — | |
| Tab switcher | `tab-group` + `tab` | — | Native dripyard_base |
| Dashboard image | `canvas-image` | — | One image per tab pane |

**Customisation required**:
- Tab underline active style (not boxed) → CSS override on `.tab-group`
- Dashboard image sizing (full-width within tab pane, rounded corners) → scoped CSS

**Bespoke SDC needed**: ❌ None — `tabs` + `canvas-image` covers this.
Scoped CSS: `components/tabs/tabs.css` (inside `_20260411`)

---

### Slice 05 — Designed for Teams (`05_designed_for_teams.webp`)

**Design**: White background. 2-column layout. Left: eyebrow, large headline, body
copy, icon-list of feature bullets (checkmark icons + short text), CTA link. Right:
product screenshot image.

| Element | Native Component | Theme Wrapper | Notes |
|---------|-----------------|---------------|-------|
| 2-col layout | Canvas 2-column grid | `theme--white` | 50/50 split |
| Left column | `heading` + `text` + `icon-list` + `button` | — | Stacked blocks |
| Icon bullets | `icon-list` (`icon-list-item`) | — | Native |
| Right image | `canvas-image` | — | |

**Customisation required**: Minimal — standard Canvas grid layout.
- Icon colour (amber checkmarks) → `css/base.css`

**Bespoke SDC needed**: ❌ None.

---

### Slice 06 — Graph: "Just like stocks" (`06_graph_stocks.webp`)

**Design**: Light grey background. Centered headline + subtitle. Below: a tab row
of metric options (e.g. "Organic traffic", "Rankings", "Backlinks"). Below that: a
prominent SVG-style line graph with labelled axes, data points, and a gradient fill
under the curve. Graph is presented as a static visual in the design.

| Element | Native Component | Theme Wrapper | Notes |
|---------|-----------------|---------------| ------|
| Section wrapper | Canvas section | `theme--light` | Grey |
| Headline + subtitle | `heading` + `text` | — | |
| Metric tab row | `tab-group` + `tab` | — | Native |
| Graph area | `canvas-image` | — | Static screenshot of graph used as image asset |

**Rationale**: The graph is a presentational element only — no interactivity is
required for Canvas assembly. A static image of the graph is sufficient and avoids
unneeded SDC complexity. The `tab-group` handles the metric switcher UI; each tab
pane contains a `canvas-image` of the appropriate graph state.

**Customisation required** (CSS only):
- Tab row pill-style switcher variant → scoped CSS

**Bespoke SDC needed**: ❌ None — `tabs` + `canvas-image`.

---

### Slice 07 — FAQ (`07_faq.webp`)

**Design**: White background. Centered "FAQ" large headline. Below: a vertical list
of question rows separated by ultra-thin grey horizontal lines. Each row: bold
question left-aligned, "+" expand icon right-aligned. Accordion pattern.

| Element | Native Component | Theme Wrapper | Notes |
|---------|-----------------|---------------|-------|
| Section wrapper | Canvas section | `theme--white` | |
| Headline | `heading` | — | Centered |
| Accordion items | `accordion` | — | Native dripyard_base |

**Customisation required**:
- Accordion border: ultra-thin `1px solid` grey lines (replace any default boxed style) → scoped CSS
- "+" icon colour → scoped CSS
- Remove any background fill on accordion items

**Bespoke SDC needed**: ❌ None — `accordion` with scoped CSS override.
Scoped CSS: `components/accordion/accordion.css` (inside `_20260411`)

---

### Slice 08 — Footer (`08_footer.webp`)

**Design**: Dark navy/slate background (`theme--primary`). 2-column layout.
Left column: a massive oversized "K" letterform (watermark) in a slightly lighter
shade of navy, absolutely positioned behind the content. Right column: footer nav
links in columns, social icons, copyright line. Logo appears top-left of right column.

| Element | Native Component | Theme Wrapper | Notes |
|---------|-----------------|---------------|-------|
| Footer shell | Neonbyte `footer` | `theme--primary` | Dark navy |
| Nav links | `menu-footer` | — | Standard footer menu blocks |
| Social icons | `social-media-nav` | — | Native |
| "K" watermark | ❌ **No native match** | — | Bespoke CSS only |

**Customisation required**:
- Massive "K" SVG: absolutely positioned pseudo or inline SVG inside footer wrapper
- Footer region split into 2-col by Canvas grid
- Watermark opacity and z-index layering

**Bespoke SDC needed**: ❌ No new SDC — pure CSS addition to `css/base.css`.
The "K" is rendered as a CSS `::before` pseudo-element or inline SVG on the
`site-footer` wrapper using `position: absolute; z-index: 0; font-size: clamp(...)`.

---

## Gap Analysis Summary

| Slice | Native Coverage | Gap | Resolution |
|-------|----------------|-----|-----------|
| 00 Navigation | ✅ Full (site regions) | Amber CTA, sticky CSS | `css/base.css` |
| 01 Hero | ✅ Native `hero` + `background-image` | Gradient + clipped image CSS | `css/base.css` on `.hero__media` |
| 02 Feature Cards | ✅ `content-card` | Elevation/shadow styling | Scoped component CSS |
| 03 Carousel | ✅ `carousel` + `card` | Horizontal snap, pill button | `css/base.css` + scoped CSS |
| 04 Dashboard Tabs | ✅ `tabs` + `canvas-image` | Tab underline style | Scoped component CSS |
| 05 Teams 2-col | ✅ Canvas grid + `icon-list` | Icon colour | `css/base.css` |
| 06 Graph | ✅ `tabs` + `canvas-image` | Tab pill style | Scoped component CSS |
| 07 FAQ | ✅ `accordion` | Border/icon styling | Scoped component CSS |
| 08 Footer | ✅ `footer` + `menu-footer` | "K" watermark | `css/base.css` pseudo |

---

## Bespoke SDCs To Be Created

**None.** All sections are covered by native Dripyard/Neonbyte components.
Customisation is handled entirely through scoped component CSS and additions to `css/base.css`.

---

## Global CSS Additions (`css/base.css`)

Items that affect existing native components globally (not scoped to a single component):

| Item | Selector Target |
|------|----------------|
| Amber CTA button variant | `.button--cta` |
| Sticky transparent → opaque header | `.site-header` |
| Hero gradient overlay on media background | `.hero__media` |
| Hero dashboard image (clipped, absolute) | `.hero__media::after` or inline img |
| Horizontal carousel snap-scroll | `.carousel__track` |
| Black pill button variant | `.button--pill-dark` |
| Amber icon colour for icon-list | `.icon-list__icon` |
| Footer "K" watermark pseudo | `.site-footer::before` |

---

## Canvas Assembly Order

Sections will be assembled in the Canvas editor in this sequence:

1. **Navigation** — Site header region (pre-existing blocks)
2. **Hero** — SDC `hero-keytail` (full-width, `theme--primary`)
3. **Feature Cards** — 3-col Canvas grid, `content-card` × 3 (`theme--white`)
4. **Carousel** — `carousel` containing `card` × 4 (`theme--light`)
5. **Dashboard Tabs** — `tab-group` + `tab` × 3 + `canvas-image` (`theme--light`)
6. **Teams** — 2-col Canvas grid, text blocks left + `canvas-image` right (`theme--white`)
7. **Graph** — `tab-group` + SDC `graph-display` (`theme--light`)
8. **FAQ** — `accordion` × N items (`theme--white`)
9. **Footer** — Site footer region (`theme--primary`, CSS watermark)

---

## Implementation Rules (SOP Reminder)

- All CSS for existing native components → scoped `components/[name]/[name].css` inside `_20260411`
- Global overrides only for cross-component concerns → `css/base.css`
- No HTML files on disk — Canvas blocks authored via Heredoc stdin
- Commit each SDC and CSS file with explicit path-scoped `git add`
- **Phase 4 (Page Template Architecture) must complete before Phase 5 (Implementation) begins**
