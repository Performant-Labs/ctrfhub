# Operational Guidance

This document captures patterns, constraints, and lessons learned from live AI-guided Drupal
site assembly runs. It is not a step-by-step procedure — the SOP covers that. This document
addresses *how to think and work* so that predictable failure modes are avoided before they
cost time.

Read this before starting any new run. Add to it when something unexpected happens.

> [!IMPORTANT]
> **Before verifying any page or component**: Read [`verification-cookbook.md`](verification-cookbook.md). It defines the Three-Tier Hierarchy (Headless → ARIA → Visual) that must govern all verification. Do NOT call `browser_subagent` (screenshots) until a Tier 2 ARIA audit passes.

---

## 1. Verification: curl first, browser last

Browser subagent calls take 60–90 seconds each. Most verification questions have a curl answer
that takes under 5 seconds. Before launching any browser subagent, ask for each item you need
to confirm:

> *Can curl answer this? If yes, use curl.*

| Question | Curl answer |
|---|---|
| Is the palette applied? | `curl -sk [url] \| grep -o 'theme-setting-base-primary-color:[^;]*'` |
| Is old copy gone? | `curl -sk [url] \| grep 'Keytail\|OldBrand'` |
| Is logo URL correct in HTML? | `curl -sk [url] \| grep -o 'src="[^"]*logo[^"]*"'` |
| Is the logo file correct on disk? | `curl -sk [logo-url] \| head -1` |
| Does a nav link return 200? | `curl -sk -o /dev/null -w '%{http_code}' [url]` |
| Is specific text on the page? | `curl -sk [url] \| grep 'expected string'` |

Use the browser only for: layout rendering, colour rendering (when curl passes but user reports
it looks wrong), hover states, mobile menu appearance, and animation behaviour.

---

## 1.1 The Verification Hierarchy (Tiered Methodology)

To maximize developer velocity, follow the **Three-Tier Verification Hierarchy**. For specialized technical patterns (Headless, ARIA-Structural, and Visual), refer to the authoritative [**Verification Cookbook**](verification-cookbook.md).

**Key Principles:**
- **Tier 2 (ARIA) First**: Audit the "Structural Skeleton" of a page (roles, headings, buttons) before taking any screenshots. This is 20x faster and more token-efficient.
- **Tier 3 (Visual) Last**: Reserve screenshots for visual regression, color-matching, and layout spacing.

---

## 2. Browser cache is not a server-side problem

If `curl` confirms the correct asset is being served (e.g., the right logo SVG, the correct
CSS variable) but a browser screenshot still shows the old version:

**It is a browser cache artifact. Stop investigating. Move on.**

The browser cached the old file at that URL before you changed it. The fix is a versioned
query string (`?v=2`) on the asset path, which forces browsers to fetch the new file. That
fix has already been applied. Do not launch more subagents to "confirm" — curl is the ground
truth for server-side state.

---

## 3. Canvas content lives in the database, not in git

Canvas component inputs (`canvas_page__components`) are not exported by `drush config:export`.
They exist only in the database until you explicitly dump them.

**Protocol:**
- At the **start** of any Canvas content phase: `drush sql-dump --tables-list=canvas_page__components > canvas_snapshot_pre_phase15.sql`
- At the **end**: take a post-edit snapshot and commit it to `docs/frameworks/drupal/theming/`
- Restore with: `ddev drush sql-query --file=canvas_snapshot_phase15.sql`

Never assume Canvas content is safe in git just because `git status` is clean.

---

## 4. Drush PHP execution: match the tool to the task

There are two approaches for running PHP in a Drush context, and each has a correct use case.

| Scenario | Approach | Why |
|---|---|---|
| Short, self-contained command (< 10 lines, no content strings) | Heredoc stdin: `cat << 'EOF' \| ddev drush php-script -` | Zero disk artefact; fine for simple API calls |
| Canvas DB updates with content strings, apostrophes, or special characters | `drush php-script path/to/script.php` | Eliminates shell quoting hell; IDE-assisted; debuggable |
| Any script using `\u` unicode escapes in strings | Always `drush php-script` — heredoc has the same escaping problem | PHP does not process `\uXXXX` in strings; stores them literally |

**The unicode trap**: `\u2019` in a PHP string (whether heredoc or eval) is not a unicode
character. It is six literal characters: `\`, `u`, `2`, `0`, `1`, `9`. Canvas renders them
verbatim. Use plain ASCII apostrophes (`'`) and hyphens (`-`) in all content strings, or
paste the actual UTF-8 character directly in the source file.

**Cleanup**: always delete script files after a successful run:
```bash
ddev drush php-script fix_something.php && rm fix_something.php
```
If the script fails, the file remains for inspection. Never leave `.php` fix scripts in the
project root long-term.

---

## 5. SVG logos must use `<text>` elements, not hand-crafted `<path>` data

Manually written `<path>` data for letterforms produces incorrect letter shapes consistently.
("Performant Labs" became "Performbnt Lobs" in production.)

- If generating a logo SVG: use `<text>` elements with
  `font-family="system-ui,-apple-system,Arial,sans-serif"`
- If the logo is provided as a path-only SVG from a design tool (Figma export, Illustrator):
  accept it as-is — tool-exported paths are correct
- Never hand-write `<path>` data for any letterform

---

## 6. Two config locations control the logo — both must be set

`system.theme.global` and `[theme_machine_name].settings` are independent. The theme-specific
config takes priority and will silently override the global config even if the global is
correct. Always check both:

```bash
# Global:
drush config:get system.theme.global logo.use_default
drush config:get system.theme.global logo.path

# Theme-specific (takes priority):
drush php-eval "\$s=\Drupal::config('[theme].settings'); echo \$s->get('logo.use_default'); echo \$s->get('logo.path');"
```

Both must have `use_default = false` and point to the correct SVG path. If theme-specific
`use_default` is `true`, the theme ignores everything in `system.theme.global`.

---

## 7. The hero CTA contrast rule

If the primary brand colour is dark (e.g., navy `#1B2638`), a Canvas hero or title-cta
component with `button_style: primary` will be invisible — dark button on dark background.

Always set `button_style: secondary` for CTAs placed on dark hero sections. Verify with a
single screenshot before closing any brand palette phase.

---

## 8. Nav link smoke test belongs in Phase 9, not Phase 12

Run an HTTP status check on every menu link immediately after registering them in Phase 9
(assembly). A 404 caught at registration time costs 30 seconds. The same 404 found at Phase 12
VR costs a full browser subagent cycle plus a fix, another rebuild, and a re-verification.

```bash
# For each nav link:
ddev exec "curl -sk -o /dev/null -w '%{http_code}' https://[site]/[path]"
# Must return 200. 301/302 is acceptable only if the final destination is also 200.
```

---

## 9. Screenshot animation timing

Canvas uses scroll-triggered count-up animations on statistic components. If a screenshot is
taken immediately after `window.scrollTo()`, it will capture mid-animation numerals that
overlap and appear broken. Add a 1500ms wait after each `scrollTo()` before capturing any
screenshot in a section known to contain animated counters or fade-in elements.

The final numeric values are always correct in HTML source — use curl to confirm them; use
screenshots only to confirm layout.

---

## 10. Batch all screenshots into a single browser subagent call

When visual verification is genuinely needed, collect all scroll positions first, then launch
a single browser subagent that captures all of them in sequence. Never launch one subagent
per panel. A 6-panel VR pass should be one subagent call with 6 `scrollTo + screenshot`
steps, not six sequential calls.

---

## 11. Never batch unverified fixes

Apply one fix, verify it, mark it done, then move to the next. Never combine multiple
unverified fixes in a single session without confirming each one works before adding the next.

A second broken fix stacked on top of a broken first fix creates a compound DB state that is
very hard to isolate and debug. The cost of verification between fixes is 30 seconds. The cost
of debugging a compounded state is 20–40 minutes.

> **One fix → one verify → one commit → next fix.**

---

## 12. Watchdog errors: script failure vs. live page error

Failed `drush php-script` runs log their schema validation errors to watchdog at severity=3,
making them look identical to live page rendering errors. Before investigating a watchdog error
as a live site problem, check the backtrace:

| Backtrace contains | Means |
|---|---|
| `/var/www/html/fix_*.php` or any named script path | Error from a **failed script run** — not a live page error. Check the script exit status instead. |
| `HtmlRenderer.php`, `HttpKernel.php`, `PageCache.php` | Error from a **live page request** — must be fixed before proceeding. |

Timestamp as a secondary signal: a script-run error will have a timestamp matching when you
ran the script, not matching a browser page load.

```bash
# Confirm page still returns 200 before concluding there is a live issue:
curl -sk -o /dev/null -w '%{http_code}' https://[site-url]/
```

---

## 13. Why VR browser subagent calls crash — and how to prevent it

Every prior full-VR attempt crashed for the same four compounding reasons:

| Root cause | Prevention |
|---|---|
| **Scope too large** — tried to load 6-7 full-viewport screenshots + write a full report in one call | One subagent call = one design slice vs. one live viewport |
| **Wrong reference asset** — passed the full 9,902px composite as MediaPath | Always pass pre-sliced `designs/NN_name.webp` — never `keytail-desktop.webp` |
| **No incremental writes** — observations accumulated in scratchpad, lost on crash | Write findings to `visual-regression-report.md` inside the subagent call before returning |
| **Side-by-side is impossible in one pass** — 17 viewport-equivalent images in one context | Split into sequential calls; the outer agent aggregates results |

See `visual-regression-strategy.md §Correct Execution Pattern` for the full protocol.

---

## 14. Module audit before config or content migration

Modules that provide content types, fields, Views, or form builders must exist on the **target
site** before their config or content is migrated. Running a config import for a View that
depends on a missing module will fail silently or produce a confusing schema validation error.

**Always run a module diff first:**

```bash
# Export enabled modules from source:
ddev drush pm:list --status=enabled --field=name 2>/dev/null | sort > /tmp/source_modules.txt

# Export from target, diff:
ddev drush pm:list --status=enabled --field=name 2>/dev/null | sort > /tmp/target_modules.txt
diff /tmp/source_modules.txt /tmp/target_modules.txt
```

Install missing modules on the target before any config import. See
`content-migration-cookbook.md §-1` for the full checklist.

---

## 15. `git add` always path-scoped — never `git add .`

`git add .` risks staging unrelated files, generated artefacts, or local config that is not
meant to be committed (e.g., `settings.local.php`, `.ddev/config.local.yaml`). It will also
stage scratch `.php` files if you forgot to delete them.

Always specify explicit paths:

```bash
git add config/sync/ web/themes/custom/[theme]/ docs/frameworks/drupal/theming/
# Never: git add .
```

The `.gitignore` is a safety net, not a substitute for intentional staging.

---

## 16. Browser subagent calls: one objective, one return condition

A browser subagent has a fixed context and output budget. The more you ask it to do in one
call, the more likely it is to crash mid-task, skip steps silently, or return a partial result
with no indication that it failed.

**Design every subagent call around a single, clearly stated objective:**

| ❌ Complex (likely to crash or skip) | ✅ Simple (reliable) |
|---|---|
| "Navigate to the site, scroll through all 8 sections, screenshot each, compare to designs, and write a full report" | "Navigate to the site, scroll to Y=900, take one screenshot, return it" |
| "Log in, open the Canvas editor, add 5 components, save, then verify the page looks correct" | "Log in and open `/page/1/edit` — return confirmation that the edit form loaded" |
| "Check nav links, verify palette, take screenshots of hero and footer, and report any gaps" | One curl-verified check per item; only use a subagent if visual rendering is genuinely needed |
| "Fill out the webform, submit it, then verify the confirmation message appears" | Fine as-is — this is one interaction flow with one outcome |

**The decomposition rule**: if you can describe more than one thing the subagent needs to
*verify and report on*, split it into multiple calls. Orchestrate the sequence in the outer
agent, not inside the subagent.

**The return condition rule**: every subagent call must have a single, unambiguous condition
for returning. "Return when you have the screenshot" is good. "Return when you've finished
checking everything" is not — the agent will decide what "finished" means and will often
decide it too early.

**Write findings immediately**: any subagent that produces a report, comparison, or audit
result must write its findings to a file *before* returning. Do not rely on the return value
alone — if the outer agent is rate-limited or the call is retried, the return value is lost
but the file persists.

---

## 17. Canvas `image` props require Drupal file entities — raw `src` paths do not render

Canvas SDC components that declare an `image` prop with `$ref: json-schema-definitions://canvas.module/image`
store the image as a **Drupal file entity reference** (`target_id`, `alt`, `width`, `height`), not as
a URL string. Canvas's internal prop hydration pipeline (`uncollapse → evaluate`) maps the prop
through an image field type whose storage format is the file entity ID.

**Consequences:**

| Approach | Result |
|---|---|
| Canvas UI upload → links file entity via `target_id` | ✅ Image renders |
| Direct DB injection `{"src":"https://...", "alt":"...", "width": N, "height": N}` | ❌ Renders empty wrapper div |
| Direct DB injection `{"src":"/sites/default/files/...", ...}` | ❌ Renders empty wrapper div |
| Direct DB injection contrib path `{"src":"/themes/contrib/…"}` | ❌ Empty div + AssertionErrors in watchdog |

**The correct workaround for AI-driven assembly:** Use the Canvas UI for any component with
an `image` prop typed as `json-schema-definitions://canvas.module/image`. The Canvas UI creates
the underlying Drupal Media/File entity and stores the resolved `target_id`.

**Acceptable fallback:** Store the canvas-image component with the correct `src` path anyway.
The wrapper div will render with layout-correct CSS classes (`--aspect-wide`, `--radius-medium`),
preserving the section's proportions. Add a note for the client to populate the image via the
Canvas UI before go-live.

**Also note:** `text` components with an `<img>` embedded in the `text` prop (even though
`contentMediaType: text/html` is declared in the schema) do **not** render the `<img>` tag —
Canvas's text field type filters it out. HTML images cannot be injected via the text prop.

---

## 18. Hard-stop and document when investigation depth exceeds three levels

When a debugging trail requires reading more than three layers of framework internals
(e.g., Canvas prop hydration → StorablePropShape → StaticPropSource evaluation), stop,
write down what you have learned, record the open question, and surface it for human review.
Continuing deeper rarely produces a faster resolution and frequently produces stale context,
wasted turns, and a confused state.

**Rule:** After three investigative tool calls on the same root-cause question
with no actionable fix found, stop and write a summary. The summary goes in the operational
notes field of the current task artifact or in a dedicated `FINDINGS.md` scratch file.
Do not proceed further without a human decision on the path forward.

---

## 19. Canvas version lock: always update `components_component_version` when writing to the component tree

Every row in `canvas_page__components` has a `components_component_version` column that must
match the Canvas config entity's `active_version`. Canvas enforces this at render time with a
hard `OutOfRangeException` that crashes the entire page (HTTP 500).

**The invariant:**

```
canvas_page__components.components_component_version
  MUST equal
canvas.component.<component_id>.active_version
```

**How to read the correct version before writing:**

```php
$raw = \Drupal::configFactory()
  ->get('canvas.component.' . $component_id)
  ->getRawData();
$correct_version = $raw['active_version'];
```

Where `$component_id` is the exact string stored in `components_component_id`
(e.g., `sdc.dripyard_base.canvas-image`).

**Common failure modes:**

| Mistake | Symptom |
|---|---|
| Changed `components_component_id` without updating `components_component_version` | HTTP 500, `OutOfRangeException: The requested version X is not available` |
| Used a helper script that computed version as `unknown` | Same 500, version string `unknown` in watchdog |
| Restored inputs but forgot to restore the component_id | Wrong component renders with wrong type's inputs |

**Corrective audit query** (run after any direct DB write):

```sql
SELECT delta, components_component_id, components_component_version
FROM canvas_page__components
WHERE entity_id = <entity_id> AND deleted = 0
ORDER BY delta;
```

Cross-check every version against the matching `canvas.component.*` config entity.

---

*Last updated: 2026-04-13 — items 1–10 from Phase 10–16 live run; items 11–15 extracted from*
*`canvas-scripting-protocol.md`, `visual-regression-strategy.md`, `content-migration-cookbook.md`,*
*and `session-2026-04-11.md` during document review; items 16–19 added from P2 investigation.*
