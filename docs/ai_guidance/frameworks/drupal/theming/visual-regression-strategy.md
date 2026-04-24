# Visual Regression Strategy

This document defines **how AI agents must execute Visual Regression (VR) gates**
embedded throughout the AI-Guided Theme Generation SOP. VR is no longer a single
end-of-project step — it is a mandatory gate at the end of every structural phase.
**You cannot build upon problems you haven't caught.**

> [!IMPORTANT]
> **This document covers Tier 3 (Visual) verification only.** Before beginning any VR gate in this document, a **Tier 2 ARIA structural audit** must have already passed for the relevant page. Read [`verification-cookbook.md`](verification-cookbook.md) for the full Three-Tier Hierarchy. Do NOT open a browser subagent (screenshots) until the structural skeleton is confirmed.

> [!IMPORTANT]
> VR gates are **blocking**. A phase must not begin until the previous phase's VR
> gate passes. A Phase 7 ❌ must be resolved before Phase 8 starts — not patched
> after Phase 9 content migration is already layered on top.

## Phase Gate Summary

| Phase | Gate name | Scope | Reference |
|---|---|---|---|
| 6 | Structure Verification | Page renders, regions present, no errors | §Structure Verification below |
| 8 | Design Fidelity Verification | Colors, fonts, no unstyled elements | §Design Fidelity Verification below |
| **10** | **Canvas Assembly Verification** | **Full panel-by-panel vs. design reference** | **§Correct Execution Pattern** |
| 12 | Navigation Verification | Nav items, links, hover states | §Navigation Verification below |
| 14 | Content Rendering Verification | Each content type renders correctly | §Content Rendering Verification below |
| 16 | Final Acceptance Verification | Holistic sign-off; smaller scope if upstream gates caught issues | §Correct Execution Pattern |

---

## Execution Speed Rules

These rules exist because browser subagent calls are slow (~60s each). Violating them creates the same slow feedback loops that kill velocity.

| Rule | What to do | When to use browser instead |
|---|---|---|
| **Curl first** | Use `ddev exec "curl -sk [url]"` to check HTTP status, HTML content, CSS variables, and rendered text | Only when you need to see a visual rendering of layout, colour, or image |
| **Check source, not screenshots, for text** | `curl … \| grep 'expected-string'` verifies copy, headings, class names, and CSS values in <1s | Never use a screenshot to confirm text content |
| **Palette is a curl check** | `curl … \| grep -o 'theme-setting-base-primary-color:[^;]*'` confirms the palette instantly | Only screenshot colour if the curl check passes but user reports it looks wrong |
| **Logo is a curl check** | `curl -sk [logo.svg url] \| head -1` confirms the server-side file. If correct, "NeonByte" in screenshots is browser cache — not a real issue. | Screenshot the SVG URL directly (not the page) to see the actual rendered result |
| **Nav links are a curl check** | `ddev exec "curl -sk -o /dev/null -w '%{http_code}' [url]"` on every nav link catches 404s in seconds | Visual nav checks only for hover states and mobile menu appearance |

> [!IMPORTANT]
> **Nav link smoke test belongs in Phase 9 (assembly), not Phase 12 (VR).** Run an HTTP status check on every menu link immediately after registering them. A 404 caught in Phase 9 costs 30 seconds. The same 404 found in Phase 12 costs a full browser VR cycle.

---



**One browser subagent call. No design reference required.**

Checks:
1. HTTP 200 on `[site-url]/`
2. Custom theme is active (not parent theme or Bartik)
3. `<header>` and `<footer>` regions present in DOM
4. No horizontal scroll at 1728 px viewport

Pass: all four → commit → Approval Checkpoint.
Fail: fix template/region → re-run →then Approval Checkpoint.

---

## Design Fidelity Verification (Phase 8)

**Two browser subagent calls: header slice + hero slice only.**

Use the `designs/00_menu.webp` and `designs/01_hero.webp` slices from the
`designs/` directory. Do NOT use the full composite at this stage.

Checks:
1. Primary and accent hex values match brand spec (use browser inspector)
2. Custom fonts loading (not browser system fallbacks)
3. Gross section proportions match design reference
4. No unstyled elements visible

Pass: colors and fonts confirmed → proceed to Phase 7.
Fail: fix CSS token / font loading → `drush cr` → re-run gate.

---

## Navigation Verification (Phase 12)

**One browser subagent call.**

Open the live site homepage. Checks:
1. Header nav labels match `menu_link_content` list exactly
2. All header nav links resolve (not 404)
3. Footer nav labels and links correct
4. Sidebar/book nav visible on a book page (if applicable)
5. No empty `<li>` or `href="#"` placeholders

Pass: all nav checks green → commit → Phase 9.
Fail: fix menu wiring → re-run §8.4 structural gate → re-run this gate.

---

## Content Rendering Verification (Phase 14)

**One browser subagent call, four pages.**

Open each URL and confirm it renders without structural breakage:

| URL | Content type | Must show |
|---|---|---|
| `/services` | Basic Page | Body copy, correct layout |
| `/articles/[any-slug]` | Article | Body, tags, date |
| Any book path | Book page | Body + sidebar nav block |
| `/contact-us` | Page + Webform | Webform with all 5 fields |

Pass: all four render correctly → proceed to Phase 10.
Fail: fix template/field rendering → re-run affected URL → commit.

---

## Why Previous Full-VR Attempts Crashed (Phases 10 & 16)



> [!IMPORTANT]
> **Pre-condition: Phase 10.1 Content Audit must pass before running any VR subagent.** If any Canvas component still contains demo copy (Keytail, NeonByte, or other base-theme defaults), run Phase 10.1 first. A Phase 10.2 finding should never be "wrong text" — if it is, return to 10.1.

---

## Why Previous Attempts Crashed

The browser subagent has a hard context/output budget per call. Every prior
attempt crashed for the same compounding set of reasons:

| # | Root Cause | Evidence |
|---|-----------|----------|
| 1 | **Single-call scope too large** | Each session tried to load the live site, scroll 6–7 full-viewport screenshots, load the reference design, and write a full panel-by-panel report in *one* subagent call. The call exhausted its budget after the screenshot phase and exited with the report unwritten. |
| 2 | **Wrong reference asset** | Sessions passed `designs/keytail-desktop.webp` (2000×9902 px, 447 KB) as the reference image. Processing one massive composite image alongside 6+ live screenshots is enough on its own to blow the context budget. |
| 3 | **No incremental writes** | Observations were accumulating in the subagent's scratchpad but never flushed to a persistent file mid-run. When the call crashed, all analysis was lost. |
| 4 | **"Side-by-side" is not possible in one pass** | A 9,902 px reference and a 4,962 px live page = ~17 viewport-equivalent images. No single agent call can reason across all of them simultaneously. |

---

## Correct Execution Pattern

### Core Rule

> **One subagent call = One design slice vs. one live viewport.**

The `designs/` directory already contains pre-sliced assets that exactly match
the required granularity. Use these — never the full composite.

```
designs/
  00_menu.webp          ← header/nav bar
  01_hero.webp          ← hero banner
  02_features_search_changed.webp
  03_carousel_built_different.webp
  04_content_engine.webp
  05_designed_for_teams.webp
  06_graph_stocks.webp
  07_faq.webp
  08_footer.webp
```

### Execution Sequence

Run **nine sequential subagent calls**, one per slice. Each call must:

1. Navigate to `https://pl-performantlabs.com.2.ddev.site:8493/` (or the URL
   already open — no need to reload if the previous call left it there).
2. Scroll to the vertical position corresponding to the slice being examined.
3. Take a **single viewport screenshot** of that live section.
4. Load **only the matching `designs/NN_name.webp` slice** as the MediaPath
   reference — never the full composite.
5. Compare the two images and write findings **immediately** to
   `docs/frameworks/drupal/theming/visual-regression-report.md` before returning.
6. Return a summary of gaps found in that panel.

The outer agent (not the subagent) is responsible for issuing all nine calls
sequentially and aggregating the results.

### Scroll Positions

Use these approximate scroll targets to align with each design slice:

| Slice | Scroll Y (approx) | Live Section |
|-------|------------------|--------------|
| `00_menu.webp` | 0 | Header / navigation bar |
| `01_hero.webp` | 0–400 | Hero banner |
| `02_features_search_changed.webp` | 400–900 | Features intro row |
| `03_carousel_built_different.webp` | 900–1600 | Carousel / built different |
| `04_content_engine.webp` | 1600–2600 | Content engine / dashboard |
| `05_designed_for_teams.webp` | 2600–3200 | Designed for teams |
| `06_graph_stocks.webp` | 3200–3700 | Graph / social proof |
| `07_faq.webp` | 3700–4400 | FAQ accordion |
| `08_footer.webp` | 4400–4962 | Footer |

> [!NOTE]
> These Y values are approximate for the 1728×997 viewport currently in use and
> a live page height of ~4962 px. Adjust by eye on first scroll.

---

## Report File

All findings must be written incrementally to:

```
docs/frameworks/drupal/theming/visual-regression-report.md
```

Each subagent call must **append** its panel findings to this file before
returning. Do not accumulate findings in scratchpad only — the report must
survive a crash.

### Report Format Per Panel

```markdown
## Panel 00 — Header / Navigation

**Scroll Y**: 0 px  
**Reference**: designs/00_menu.webp  
**Status**: ✅ Match / ⚠️ Minor gap / ❌ Major gap

### Gaps
- [ ] Gap description ...

### Notes
- ...
```

---

## Constraints and Guardrails

- **Never pass `keytail-desktop.webp` as a MediaPath.** It is 9,902 px tall.
  It will exhaust context on its own. It exists only as a human reference for
  reviewing the full composition visually.
- **Never ask the subagent to compare more than one panel per call.** If a
  panel is complex (e.g., `04_content_engine.webp`), split it into two calls
  (top half / bottom half) rather than expanding scope.
- **Always write to the report file inside the subagent call.** Do not defer
  writing to the outer agent — the subagent may be the last thing that runs
  before a crash.
- **The outer agent must check the report file exists** before launching the
  first subagent. If it does not exist, create it with a header block first.

---

## Reference to This Document

This strategy is referenced from the master SOP at:

```
docs/frameworks/drupal/theming/ai-guided-theme-generation.md
```

under **Phase 10.2: Visual Regression**.
