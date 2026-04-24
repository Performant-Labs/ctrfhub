# Dripyard Theme System — AI Guidance

Synthesised from the Dripyard documentation at [dripyard.com/docs](https://dripyard.com/docs) and direct inspection of the `dripyard_base`, `neonbyte`, and `neonbyte_subtheme` theme files in `/themes`. This document is the primary reference for any AI agent working with the Dripyard theme stack on this project.

---

## Table of Contents

1. [Stack Overview](#1-stack-overview)
2. [Theme Hierarchy](#2-theme-hierarchy)
3. [4-Layer Color System](#3-4-layer-color-system)
4. [Applying Brand Colors — The Correct Pattern](#4-applying-brand-colors--the-correct-pattern)
5. [Typography Variables](#5-typography-variables)
6. [Layout Variables](#6-layout-variables)
7. [Library System](#7-library-system)
8. [Preprocess System](#8-preprocess-system)
9. [Single Directory Components (SDC)](#9-single-directory-components-sdc)
10. [NeonByte-Specific Components](#10-neonbyte-specific-components)
11. [Theme Regions](#11-theme-regions)
12. [Subtheme Scaffold (Canonical Pattern)](#12-subtheme-scaffold-canonical-pattern)
13. [Theme Settings Config](#13-theme-settings-config)
14. [Enabling and Activating via Drush](#14-enabling-and-activating-via-drush)
15. [Critical Gotchas](#15-critical-gotchas)

---

## 1. Stack Overview

Dripyard is a premium Drupal 11 theme ecosystem. All themes in the stack are installed as `contrib` themes (via composer) in `themes/` and run with Drupal 11.2+ with no external module dependencies.

```
dripyard_base   ← Foundation: components, CSS engine, preprocess system
    └── neonbyte      ← Primary theme: Neonbyte visual design, overrides
            └── pl_neonbyte   ← Subtheme: all site-specific customisations
```

Key attributes:
- **No front-end build tools required.** Zero npm, webpack, or bundler dependencies.
- **No module dependencies** on Drupal 11+. Core-only APIs.
- **WCAG 2.2 AA** compliant out of the box (forced colors, focus management, reduced motion).
- Component rendering works in Layout Builder, Drupal Canvas, and Paragraphs.

---

## 2. Theme Hierarchy

### `dripyard_base` — Foundation Layer

- `base theme: false` — it is a root theme, not a child of anything.
- Delivers the full **50+ SDC component library** shared across all Dripyard themes.
- Contains the CSS variable system, theme layer CSS, preprocess infrastructure, and layout utilities.
- All global CSS is loaded via three libraries: `dripyard_base/global`, `dripyard_base/variables`, `dripyard_base/themes`.
- Contains `libraries-extend` entries that integrate with Layout Builder, CKEditor 5, Webform, Swiper, GSAP, and other optional modules — these extensions only fire when the respective module is enabled.
- **Never install or enable `dripyard_base` directly.** It is a base theme only.

### `neonbyte` — Primary Theme Layer

- `base theme: dripyard_base`
- Applies NeonByte-specific design tokens and visual treatments on top of `dripyard_base`.
- Overrides two `dripyard_base` libraries using `libraries-override`:
  ```yaml
  libraries-override:
    dripyard_base/themes: neonbyte/themes
    dripyard_base/variables: neonbyte/variables
  ```
  This is how NeonByte applies its own OKLCH variable set and theme CSS files instead of the base defaults.
- Adds 10 NeonByte-specific SDC components (header, footer, hero, etc.).
- Declares `dripyard_theme_level: primary`.

### Subtheme (`pl_neonbyte`) — Customisation Layer

- `base theme: neonbyte`
- **Never modify `neonbyte` or `dripyard_base` directly.** All site-specific changes go in the subtheme.
- Inherits all libraries from the parent chain without needing to redefine them.
- Does NOT need to repeat `libraries-override` — those are inherited from `neonbyte`.

---

## 3. 4-Layer Color System

The entire palette is derived from two hex values configured in the Drupal admin UI (or via `drush php-eval`). Understanding this chain is essential before writing any CSS.

### Layer 1 — Theme Settings (Root Input)

The two anchor colors are stored in `[theme_machine_name].settings` YAML:
```yaml
theme_colors:
  colors:
    base_primary_color: '#0d47a1'
    base_primary_color_brightness: 'dark'   # or 'light'
    base_secondary_color: '#ff6d00'
    base_secondary_color_brightness: 'dark'
```

At preprocess time, `dripyard_base_preprocess_html()` injects them as **inline styles directly on the `<html>` element**:
```html
<html style="--theme-setting-base-primary-color: #0d47a1; --theme-setting-base-secondary-color: #ff6d00;">
```
These inline styles have the **maximum possible CSS specificity**. This is the source of the most common CSS override failure (see §4).

PHP also reads `base_primary_color_brightness` / `base_secondary_color_brightness` (calculated server-side via LCH color space conversion) and adds CSS classes to `<html>`:
```html
<html class="primary-color-is-dark secondary-color-is-dark">
```

### Layer 2 — Semantic Scale (OKLCH Engine)

Defined in `css/_variables/variables-colors-semantic.css`. Reads from Layer 1 and generates full 10-shade palettes:

```css
--primary: var(--theme-setting-base-primary-color);
--primary-100: oklch(from var(--primary) 1 c h);      /* near-white */
--primary-200: oklch(from var(--primary) 0.94 c h);
/* ... */
--primary-1000: oklch(from var(--primary) 0.18 c h);  /* near-black */

/* Neutral grays derived from primary, chroma zeroed out: */
--chroma: 0%;
--neutral-100 through --neutral-1000  /* same lightness ladder, desaturated */

/* brightness-gated text/surface colors: */
/* (set via html.primary-color-is-dark / .primary-color-is-light) */
--color-primary-text-color: var(--white);   /* or --black */
--color-primary-surface-alt: oklch(from var(--primary) calc(l + 0.04) c h);
```

### Layer 3 — Theme Layer (Six Named Themes)

Defined in `css/themes/theme-*.css`. Maps Layer 2 tokens → semantic `--theme-*` variables. Each file scopes to a CSS class:

| File | Selector | `color-scheme` | Typical use |
|---|---|---|---|
| `theme-white.css` | `:where(:root), .theme--white` | `light` | Default page body |
| `theme-light.css` | `.theme--light` | `light` | Secondary surfaces |
| `theme-primary.css` | `.theme--primary` | `dark` | Header, footer, dark CTAs |
| `theme-dark.css` | `.theme--dark` | `dark` | Alternate dark sections |
| `theme-black.css` | `.theme--black` | `dark` | Max contrast dark |
| `theme-secondary.css` | `.theme--secondary` | varies | Accent sections |

Key `--theme-*` variables exposed (read from `.theme--white` source):
```css
/* Surfaces */
--theme-surface           /* page / card background */
--theme-surface-alt       /* slightly offset surface */
--theme-surface-primary   /* primary-tinted surface */

/* Text */
--theme-text-color-soft   /* captions, muted */
--theme-text-color-medium /* body text */
--theme-text-color-loud   /* headings */
--theme-text-color-primary /* primary-colored text */

/* Links */
--theme-link-color
--theme-link-color-hover

/* Borders & focus */
--theme-border-color
--theme-border-color-alt
--theme-border-color-soft
--theme-focus-ring-color

/* Status */
--theme-color-error / warning / success / info

/* Buttons */
--theme-button-background-color / hover / active
--theme-button-text-color / hover / active
--theme-button-border-color
```

### Layer 4 — Component Layer

Each SDC component's `.css` file maps only to `--theme-*` variables:
```css
.hero {
  background-color: var(--theme-surface);
  color: var(--theme-text-color-loud);
}
```

Components pick up the correct colors from whichever `theme--*` class is applied to their ancestor.

---

## 4. Applying Brand Colors — The Correct Pattern

> **This is the most critical section.** Wrong approach = colors silently revert to NeonByte blue.

### Step A — Setting the Primary/Secondary Inputs

Write to Layer 1 (theme settings config), not CSS. Use `drush php-eval`:

```bash
ddev drush php-eval "
\$config = \Drupal::configFactory()->getEditable('[theme_machine_name].settings');
\$config->set('theme_colors.colors.base_primary_color', '#[HEX]');
\$config->set('theme_colors.colors.base_primary_color_brightness', '[light|dark]');
\$config->set('theme_colors.colors.base_secondary_color', '#[HEX]');
\$config->set('theme_colors.colors.base_secondary_color_brightness', '[light|dark]');
\$config->save();
"
ddev drush cr
```

Verify the OKLCH engine picked it up:
```bash
curl -sk https://[site-url]/ | grep -o 'theme-setting-base-primary-color:[^;]*'
# Must return: theme-setting-base-primary-color:#[your-hex]
```

### Step B — Overriding Semantic Tokens in CSS (Layer 4)

**Do NOT use `:root` overrides.** The `<html>` inline style wins in the cascade. Use descendant selectors against `html` to guarantee specificity over the inline style:

```css
/* css/base.css in the subtheme */

/* LIGHT zones (page body, white sections) */
html :where(:root),
html .theme--white,
html .theme--light {
  --theme-surface:              #F0F1F0;
  --theme-surface-alt:          #FFFFFF;
  --theme-text-color-loud:      #2D3E48;
  --theme-text-color-medium:    #2D3E48;
  --theme-text-color-soft:      #555F68;
  --theme-link-color:           #F59E0B;
  --theme-link-color-hover:     #92600A;
  --theme-border-color:         #555F68;
  --theme-focus-ring-color:     #F59E0B;
}

/* PRIMARY/DARK zones (header, footer, dark canvas sections) */
html .theme--primary,
html .theme--dark,
html .theme--black {
  --theme-surface:              #1B2638;
  --theme-surface-alt:          #2D3E48;
  --theme-text-color-loud:      #FFFFFF;
  --theme-text-color-medium:    #F0F1F0;
  --theme-text-color-soft:      #AABBC8;
  --theme-link-color:           #F59E0B;
  --theme-link-color-hover:     #92600A;
  --theme-border-color:         #555F68;
  --theme-focus-ring-color:     #F59E0B;
}
```

> **Why this works:** `html .theme--primary` has higher specificity than the `:where(:root)` selector used in the base theme files, while the `html` ancestor prevents inline style conflicts. This is the architecturally correct override point (Layer 4 override).

### Logo Wiring (Two Config Locations)

Logo is controlled by **two independent config keys**. Both must be set or the wrong one silently wins:

```bash
# 1. Check global:
ddev drush config:get system.theme.global logo.use_default   # must be false
ddev drush config:get system.theme.global logo.path          # must point to subtheme

# 2. Check theme-specific (takes priority):
ddev drush php-eval "\$s = \Drupal::config('[theme].settings'); echo \$s->get('logo.use_default').PHP_EOL; echo (\$s->get('logo.path') ?? '(not set)').PHP_EOL;"
# use_default must be FALSE; path must match custom theme SVG

# Fix theme-specific if needed:
ddev drush php-eval "
\$c = \Drupal::configFactory()->getEditable('[theme_machine_name].settings');
\$c->set('logo.use_default', FALSE);
\$c->set('logo.path', 'themes/custom/[theme_machine_name]/logo.svg?v=1');
\$c->save();
"
ddev drush cr
```

> Append `?v=1` to force browser cache invalidation when replacing a parent-theme default logo.

### SVG Logo Rule

Never hand-write `<path>` data for letterforms. Use `<text>` elements:
```svg
<svg xmlns="http://www.w3.org/2000/svg" width="160" height="32" role="img" aria-label="[Site Name]">
  <text x="0" y="24" font-family="system-ui,-apple-system,Arial,sans-serif" font-size="20" font-weight="600">[Site Name]</text>
</svg>
```

---

## 5. Typography Variables

Defined in `dripyard_base/css/_variables/variables-typography.css`. Override any of these in the subtheme's `css/base.css`:

| Variable | Default value | Description |
|---|---|---|
| `--font-sans` | `sans-serif` | Primary font stack |
| `--font-mono` | `ui-monospace, monospace` | Code/technical |
| `--font-serif` | `serif` | Decorative |
| `--title-size` | `3.75rem` (→ `5rem` at 600px+) | Display heading |
| `--h1-size` | `3.25rem` (→ `4.5rem`) | |
| `--h2-size` | `2.625rem` (→ `3.375rem`) | |
| `--h3-size` | `2rem` | |
| `--h4-size` | `1.625rem` | |
| `--h5-size` | `1.375rem` | Uses `--font-mono` |
| `--h6-size` | `1.25rem` | Uses `--font-mono` |
| `--body-l-size` | `1.25rem` | |
| `--body-m-size` | `1rem` | Default body |
| `--body-s-size` | `0.875rem` | Small / captions |

To add a Google Font:
```css
/* css/base.css */
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');

:root {
  --font-sans: 'Inter', sans-serif;
}
```

---

## 6. Layout Variables

Defined in `dripyard_base/css/_variables/variables-layout.css`.

### Container Width

```css
--container-max-pixel: var(--theme-setting-container-max-pixel, 1440px);
/* Controlled via theme settings — set to 1440 in .settings.yml */
```

### Spacing Scale

Base unit `--sp = 0.5rem (8px)`. Semantic aliases:

| Token | Value | Pixels |
|---|---|---|
| `--spacing-xxxs` | `--sp0-5` | 4px |
| `--spacing-xxs` | `--sp` | 8px |
| `--spacing-xs` | `--sp2-5` | 20px |
| `--spacing-s` | `--sp4` | 32px |
| `--spacing-m` | `--sp5` | 40px |
| `--spacing-l` | `--sp7` | 56px |
| `--spacing-xl` | `--sp8` | 64px |
| `--spacing-xxl` | `--sp10` | 80px |
| `--spacing-xxxl` | `15 × --sp` | 120px |
| `--spacing-component` | `--spacing-xxl` → `--spacing-xxxl` (700px+) | 80–120px |
| `--gap` | `1.25rem` | 20px |

### Utility Classes

| Class | Effect |
|---|---|
| `.query-container` | Wraps regions, enables `cqw` container queries |
| `.region-container` | Max-width container inside query-container |
| `.full-width` | Expands to full page width |
| `.component-spacer` | Uniform vertical spacing between landing page components |
| `.full-height` | Suppresses vertical spacing from `.component-spacer` |
| `.container` | Nested layout inside full-width elements |

---

## 7. Library System

### Global Libraries (always loaded)

Three libraries load on every page from `dripyard_base.libraries.yml` + `neonbyte.libraries.yml`:

| Library | Contents |
|---|---|
| `dripyard_base/global` | Base CSS, form CSS, layout CSS, JS helpers |
| `dripyard_base/variables` | All CSS custom property files (overridden by neonbyte) |
| `dripyard_base/themes` | All six `theme-*.css` files (overridden by neonbyte) |

NeonByte overrides `variables` and `themes` with its own versions via `libraries-override` in `neonbyte.info.yml`.

### Subtheme Library Pattern

In `pl_neonbyte.libraries.yml`:
```yaml
# Global — loaded on every page:
base:
  css:
    theme:
      css/base.css: {}

# Component-specific (add only when needed):
# user-login-form:
#   css:
#     component:
#       css/user-login-form.css: {}
```

In `pl_neonbyte.info.yml`:
```yaml
libraries:
  - pl_neonbyte/base
```

### `libraries-extend` (Augmenting Parent Libraries)

To add CSS/JS to an existing library without overriding it:
```yaml
# pl_neonbyte.info.yml
libraries-extend:
  dripyard_base/user-login-form:
    - pl_neonbyte/user-login-form
  core/components.dripyard_base--status-messages:
    - pl_neonbyte/status-messages
```

### Optional Libraries (not auto-loaded)

`dripyard_base` ships several opt-in libraries. The subtheme can attach them conditionally in `hook_preprocess_*`:
- `dripyard_base/swiper` — Swiper.js carousel
- `dripyard_base/gsap-gsap` / `dripyard_base/gsap-scroll-trigger` — GSAP animations
- `dripyard_base/lenis` — Smooth scroll
- `dripyard_base/canvas-helper` — Drupal Canvas page helper (auto-attached on Canvas routes)

---

## 8. Preprocess System

`dripyard_base.theme` implements an OOP preprocess dispatcher. For each preprocess hook, it uses `ClassDiscovery::getAvailableClasses($theme, 'Preprocess/[Type]')` to find and run all preprocess classes in the **active theme's** `src/Preprocess/` directory.

This means a subtheme's preprocess classes in `src/Preprocess/` are automatically discovered and run **without** needing to override any hook. You just place a class in the right namespace.

### Hooks dispatched through the class system

| Hook | Class location |
|---|---|
| `preprocess_html` | `src/Preprocess/Html/` |
| `preprocess_page` | `src/Preprocess/Page/` |
| `preprocess_page_title` | `src/Preprocess/PageTitle/` |
| `preprocess_field` | `src/Preprocess/Field/` |
| `preprocess_block` | `src/Preprocess/Block/` |
| `preprocess_menu` | `src/Preprocess/Menu/` |
| `preprocess_input` | `src/Preprocess/Input/` |
| Form alters | `src/FormAlter/` |
| Theme settings | `src/ThemeSettings/` |

### Adding a preprocess in a subtheme

1. Create `src/Preprocess/Page/MyPagePreprocessor.php` namespaced `Drupal\PlNeonbyte\Preprocess\Page`.
2. Implement `PreprocessInterface` from `dripyard_base`.
3. Implement `applies(array $variables): bool` and `preprocess(array &$variables): void`.

The `dripyard-classloader.php` in the subtheme root provides PSR-4 autoloading for the `Drupal\PlNeonbyte\` namespace without Composer.

### Notable built-in preprocess behaviors

- **`dripyard_base_preprocess_html`** — injects `--theme-setting-base-primary-color` and `--theme-setting-base-secondary-color` as inline styles on `<html>`, and adds `primary-color-is-dark/light` + `secondary-color-is-dark/light` HTML classes.
- **`dripyard_base_preprocess_page`** — reads `footer.theme` from config and passes it as `footer_theme` variable to page templates.
- **`dripyard_base_preprocess`** — detects Canvas routes and attaches `dripyard_base/canvas-helper`.
- **`dripyard_base_theme_suggestions_block_alter`** — adds `block__region_[region]` and `block__region_[region]__[plugin_id]` suggestions.
- **`dripyard_base_theme_suggestions_menu_alter`** — adds `menu__region_[region]` suggestion.

---

## 9. Single Directory Components (SDC)

### Structure

Every component lives in a `components/` directory in its theme, as a self-contained bundle:

```
components/
  hero/
    hero.component.yml    ← schema (props + slots)
    hero.twig             ← template
    hero.css              ← scoped styles (loaded only when component renders)
    hero.md               ← documentation
```

### Schema (`*.component.yml`)

Defines the component's contract. Props and slots are validated on render — wrong prop names or types cause silent drops or 500 errors:

```yaml
$schema: https://git.drupalcode.org/project/drupal/...
name: Hero
status: stable
props:
  type: object
  required:
    - height      # required props must always be supplied
  properties:
    theme:
      type: string
      enum: [inherit, white, light, dark, black, primary, secondary]
slots:
  hero_media:
    title: Image or video
  hero_content:
    title: Hero content
```

### `noUi: true` Components

Some components declare `noUi: true` (e.g., `footer`, `menu-footer`). These cannot be placed via the Canvas UI — they must be placed as Drupal blocks in theme regions.

### Overriding a Component in a Subtheme

Create an identically-named bundle in `themes/custom/pl_neonbyte/components/`. Drupal's SDC system uses theme hierarchy — the subtheme's version wins.

```
themes/custom/pl_neonbyte/
  components/
    hero/
      hero.component.yml  ← copy from neonbyte/components/hero/
      hero.twig           ← modified template
      hero.css            ← scoped overrides
```

> **Do not copy the entire schema if you only need to add CSS.** For CSS-only overrides, use `libraries-extend` to augment the parent component's library rather than duplicating the full bundle.

### Component ID Format (for Canvas assembly)

When assembling Canvas pages programmatically, the `component_id` is:

```
sdc.[theme_machine_name].[component-dir-name]
```

Examples:
- `sdc.neonbyte.hero`
- `sdc.dripyard_base.section`
- `sdc.dripyard_base.flex-wrapper`
- `sdc.pl_neonbyte.hero` ← subtheme override

---

## 10. NeonByte-Specific Components

NeonByte adds 10 theme-specific SDCs on top of the 50+ inherited from `dripyard_base`.

### Site Structure Components (noUi — placed as blocks)

#### `neonbyte:header`
Main site header. Contains navigation, branding, and responsive behavior. Not a Canvas block — placed in the `header_*` regions via standard Drupal block placement.

#### `neonbyte:footer`
**`noUi: true`** — placed as a block in the `footer_*` regions.

Props:
| Prop | Type | Values |
|---|---|---|
| `theme` | string | `inherit` `white` `light` `dark` `black` `primary` `secondary` |

Slots:
| Slot | Purpose |
|---|---|
| `footer_top_content` | Full-width top area of footer |
| `footer_left_content` | Left column |
| `footer_right_content` | Right column |
| `footer_bottom_content` | Copyright bar |

#### `neonbyte:primary-menu`
Navigation menu component with dropdown support. Auto-applied to any menu placed in `header_second` region.

#### `neonbyte:mobile-nav-button`
Mobile navigation toggle with accessibility features.

#### `neonbyte:header-search`
Integrated search with autocomplete.

#### `neonbyte:language-switcher`
Multi-language switcher.

### Content Components

#### `neonbyte:hero`
Landing page hero section. **Required prop: `height`.**

| Prop | Type | Required | Values |
|---|---|---|---|
| `height` | string | **yes** | `small` `medium` `large` `full-screen` |
| `theme` | string | no | `inherit` `white` `light` `dark` `black` `primary` `secondary` |
| `position_behind_against_screen_top` | boolean\|null | no | Pulls hero behind sticky nav |
| `align_x` | string | no | `start` `center` `end` |
| `align_y` | string | no | `top` `center` `bottom` |
| `text_color` | string | no | `inherit` `black` `white` `primary` |

Slots:
| Slot | Purpose |
|---|---|
| `hero_media` | Background image or video component |
| `hero_content` | Title, text, buttons — any component |

Hero Twig renders:
```html
<div class="hero has-background-image hero--height-full-screen theme--primary ...">
  <div class="hero__media"><!-- hero_media slot --></div>
  <div class="hero__container container">
    <div class="hero__content">
      <div class="hero__block-content"><!-- hero_content slot --></div>
    </div>
  </div>
</div>
```

> **CTA contrast rule:** If the hero uses `theme--primary` (dark background) and the primary brand color is also dark, a `button_style: primary` CTA will be invisible. Use `button_style: secondary` or `button_style: light` for CTAs on dark heroes.

#### `neonbyte:header-article`
Article-specific header layout for content pages.

#### `neonbyte:html-header`
Document `<head>` management — metadata and page initialization.

#### `neonbyte:icon`
Flexible icon component with UI Icons integration.

---

## 11. Theme Regions

All 11 regions are declared identically in `neonbyte.info.yml` and must be re-declared in the subtheme's `info.yml`.

```yaml
regions:
  # Header
  header_first:      Header first (logo)
  header_second:     Header second (center)    # primary-menu auto-applied
  header_third:      Header third (right)      # secondary-menu auto-applied

  # Content
  highlighted:       Highlighted               # above main content, light bg
  content:           Content                   # main content area

  # Fixed (viewport-fixed)
  fixed_middle_right: Fixed middle right (local actions tabs)
  fixed_bottom_right: Fixed bottom right (messages)

  # Footer
  footer_top:        Footer top
  footer_left:       Footer left
  footer_right:      Footer right
  footer_bottom:     Footer bottom
```

### Region behavior notes

- **`header_second`** — any menu block placed here automatically receives the `primary-menu` component treatment.
- **`header_third`** — any menu block placed here automatically receives the `secondary-menu` component treatment.
- **`highlighted`** — has built-in light background styling extending to viewport top.
- **`fixed_middle_right`** — used for local action tabs; viewport-fixed positioning.
- **`fixed_bottom_right`** — system status messages; viewport-fixed.

---

## 12. Subtheme Scaffold (Canonical Pattern)

The `themes/neonbyte_subtheme/` directory is the official Dripyard scaffold. All files in `pl_neonbyte/` are modelled on it.

### Minimum required file set

```
themes/custom/pl_neonbyte/
├── pl_neonbyte.info.yml              ← declares theme, regions, libraries
├── pl_neonbyte.libraries.yml         ← defines base + optional libraries
├── pl_neonbyte.theme                 ← PHP hooks + classloader include
├── dripyard-classloader.php          ← PSR-4 autoloader for src/ classes
├── dripyard.license.yml              ← copy from neonbyte_subtheme (required)
├── css/
│   └── base.css                      ← brand overrides (see §4)
├── logo.svg                          ← brand logo (use <text>, not <path>)
└── config/
    └── install/
        └── pl_neonbyte.settings.yml  ← pre-seeds all theme settings
```

### `pl_neonbyte.info.yml`

```yaml
name: 'PL NeonByte'
type: theme
base theme: neonbyte
description: 'Performant Labs child theme of NeonByte.'
core_version_requirement: ^11
version: 1.0.0
libraries:
  - pl_neonbyte/base
regions:
  header_first:       'Header first (logo)'
  header_second:      'Header second (center)'
  header_third:       'Header third (right)'
  highlighted:        Highlighted
  content:            Content
  fixed_middle_right: 'Fixed middle right (local actions tabs)'
  fixed_bottom_right: 'Fixed bottom right (messages)'
  footer_top:         'Footer top'
  footer_left:        'Footer left'
  footer_right:       'Footer right'
  footer_bottom:      'Footer bottom'
```

### `pl_neonbyte.theme`

```php
<?php
/**
 * @file
 * Functions to support pl_neonbyte theming.
 */

if (file_exists(__DIR__ . '/dripyard-classloader.php')) {
  require_once __DIR__ . '/dripyard-classloader.php';
}

// Add hook_preprocess_* functions below.
// OOP preprocess classes go in src/Preprocess/ and are auto-discovered.
```

### `dripyard-classloader.php`

Adapted from `neonbyte_subtheme/dripyard-classloader.php`. Update the namespace to match the subtheme machine name:

```php
<?php
namespace {
  if (!defined('PL_NEONBYTE_AUTOLOADER_LOADED')) {
    define('PL_NEONBYTE_AUTOLOADER_LOADED', TRUE);
    spl_autoload_register(function ($class) {
      $prefix   = 'Drupal\\PlNeonbyte\\';
      $base_dir = __DIR__ . '/src/';
      $len = strlen($prefix);
      if (strncmp($prefix, $class, $len) !== 0) { return; }
      if (class_exists($class, FALSE) || interface_exists($class, FALSE)) { return; }
      $relative_class = substr($class, $len);
      $file = $base_dir . str_replace('\\', '/', $relative_class) . '.php';
      if (file_exists($file)) { require $file; }
    });
  }
}
```

---

## 13. Theme Settings Config

### `config/install/pl_neonbyte.settings.yml`

This file seeds all Dripyard theme settings when the theme is first installed. Modelled on `neonbyte_subtheme/config/install/neonbyte_subtheme.settings.yml`.

```yaml
# Colors — these drive the OKLCH engine
theme_colors:
  color_scheme: default        # or a named scheme: firehouse, ice, plum, slate
  colors:
    base_primary_color: '#0d47a1'
    base_primary_color_brightness: 'dark'
    base_secondary_color: '#ff6d00'
    base_secondary_color_brightness: 'dark'
  site_theme: 'white'          # default page theme: white|light|primary|dark|black|secondary

# Footer
footer:
  theme: primary               # footer background theme class

# Logo
logo:
  use_default: false
  path: ''                     # set via drush after enabling

# Layout
layout_settings:
  container_max_width: '1440'
  border_radius_sm: '4'
  border_radius_md: '8'
  border_radius_lg: '16'
  border_radius_button: '40'

# Header
header_settings:
  full_width: 0                # 1 = edge-to-edge header
  remove_sticky: 0             # 1 = disable sticky behavior
  remove_transparency: 0       # 1 = always opaque
  theme: 'light'               # header color theme

# Social (all optional)
social_media_links:
  linkedin: ''
  github: ''
  twitter: ''
  youtube: ''
  # (+ bluesky, discord, facebook, instagram, mastodon, pinterest, reddit,
  #    snapchat, telegram, threads, tiktok, twitch, whatsapp)

# Misc
features:
  comment_user_picture: false
  comment_user_verification: true
  favicon: false               # Dripyard disables favicon feature — wire via hook instead
  node_user_picture: false
third_party_settings:
  shortcut:
    module_link: true

# License (copy from neonbyte_subtheme.settings.yml)
license_uuid: 'c14f4bdc-9260-401a-922e-a55523c688c9'
dripyard_uid: 42
```

### Built-in Color Schemes

NeonByte ships 5 named schemes (set `color_scheme` in settings.yml or via UI):

| Key | Primary | Secondary |
|---|---|---|
| `default` | `#0000d9` (blue) | `#7a4587` (plum) |
| `firehouse` | `#a30f0f` (red) | `#d45f00` (orange) |
| `ice` | `#57919e` (teal) | `#2d5a87` (navy) |
| `plum` | `#7a4587` (plum) | `#4a6b8a` (slate) |
| `slate` | `#47625b` (slate) | `#5a4a3a` (brown) |

---

## 14. Enabling and Activating via Drush

```bash
# Enable
ddev drush theme:enable pl_neonbyte

# Set as default active theme
ddev drush config:set system.theme default pl_neonbyte -y

# Rebuild caches
ddev drush cr

# Export config so settings travel with git
ddev drush config:export --yes
git add config/sync/
git commit -m "feat: enable pl_neonbyte as default theme"
```

### Favicon (must use hook — Dripyard disables the core feature)

Add to `pl_neonbyte.theme`:
```php
function pl_neonbyte_page_attachments_alter(array &$attachments): void {
  $path = '/' . \Drupal::service('extension.list.theme')->getPath('pl_neonbyte');
  $attachments['#attached']['html_head'][] = [[
    '#type' => 'html_tag',
    '#tag'  => 'link',
    '#attributes' => [
      'rel'  => 'icon',
      'type' => 'image/svg+xml',
      'href' => $path . '/favicon.svg',
    ],
  ], 'favicon_svg'];
}
```

> `features.favicon: false` in Dripyard config means the core `<link rel="shortcut icon">` tag is suppressed. `hook_page_attachments_alter()` bypasses this regardless of base theme settings.

---

## 15. Critical Gotchas

### G1 — `:root` overrides don't win against inline styles

The `<html>` element carries inline styles with maximum specificity. Use `html .theme--white { ... }` selectors, not `:root { ... }` (see §4).

### G2 — Two logo config locations must both be correct

`system.theme.global` and `[theme].settings` are independent. Theme-specific takes priority. Check both (see §4 Logo Wiring).

### G3 — `component_version` must be `NULL` in Canvas assembly scripts

Never hard-code a component version hash. Canvas resolves it on `preSave()`. Setting it to any other value causes `OutOfRangeException` HTTP 500s.

### G4 — `noUi: true` components cannot be placed in Canvas

`footer` and `menu-footer` are `noUi: true`. They must be placed as Drupal blocks in regions — not via the Canvas editor.

### G5 — `heading` component uses `text`, not `heading`

The `heading` SDC's text prop is called `text`, not `heading`. Margin values use `"zero"/"small"/"medium"/"large"`, not `"none"/"sm"/"md"/"lg"`.

### G6 — `canvas-image` requires `loading` prop

`loading: "eager"` or `loading: "lazy"` is required. Omitting it throws a `RuntimeError` from `image-or-media`.

### G7 — Never use contrib theme paths as `canvas-image` src

Paths like `/themes/contrib/dripyard_base/...` silently fail and log `AssertionError: assert($component instanceof Component)` on every page load.

### G8 — SVG logos: use `<text>`, not `<path>` data

Hand-written path data for letterforms is consistently wrong. Use `<text font-family="system-ui,...">` elements.

### G9 — Hero CTA contrast

Dark primary color + `button_style: primary` on a dark hero = invisible button. Always use `button_style: secondary` or `button_style: light` for CTAs on `theme--primary` sections.

### G10 — `drush config:export` does NOT capture Canvas content

Canvas component data in `canvas_page__components` is database-only. Always take SQL snapshots before Canvas assembly phases.

### G11 — `ddev drush cr` does not flush PHP opcache

After creating or moving `.php` files (including new preprocess classes), run `ddev restart`, not just `ddev drush cr`.

---

*Sources: [dripyard.com/docs](https://dripyard.com/docs), `themes/dripyard_base/`, `themes/neonbyte/`, `themes/neonbyte_subtheme/`, `docs/ai_guidance/` — inspected April 2026.*
