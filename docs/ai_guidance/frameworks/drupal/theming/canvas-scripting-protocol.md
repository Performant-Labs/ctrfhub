# Canvas Scripting Protocol

This document defines the mandatory pre-flight checklist that must pass before any Drush script or Twig override is written that touches Canvas page components. It applies equally to initial assembly, additions, and corrections. It was created after a session where multiple fix scripts were required because these checks were skipped.

> [!IMPORTANT]
> **Before verifying any page built or modified by this document**: Read [`verification-cookbook.md`](../../../testing/verification-cookbook.md). It defines the Three-Tier Hierarchy (Headless → ARIA → Visual) that must govern all verification. Do NOT call `browser_subagent` (screenshots) until a Tier 2 ARIA audit passes.

> [!IMPORTANT]
> Updated 2026-04-17 with lessons from the Services page migration. See sections: **Media Image References**, **Enum Value Ceilings**, **Canvas Page Internal Path**, **Adding Props to Canvas Config Entities**, and **Canvas Page Title Field**.
>
> Updated 2026-04-21 with lessons from overlay-based section passes. See: **On-entity storage vs. submit-time shape** (expanded under Rule A), **Rule F — Unrecognized image-prop shapes fail silently**, **Canonical Prop Shape Lookup** (Pre-Flight item 8), and new top-level section **Overlay-Based Content Passes**.

---

## The Core Problem

Every failure in that session shared one root cause: **writing code before verifying the constraints the code must operate within**. The fixes broke because:

- Prop names were guessed instead of read from the schema
- Module availability was assumed instead of verified
- Component rendering behaviour was inferred instead of read from the Twig template

The rule is simple: **read before you write.** This applies equally whether building from scratch or making a targeted change.

---

## Mandatory Pre-Flight Checklist

Run this checklist **before writing any fix script or template override**. If any item cannot be confirmed, find the answer before continuing.

### 1. Canvas Component Schema Check (required for every Canvas component being created or modified)

```bash
# Find and print the schema before writing the inputs JSON
cat web/themes/contrib/dripyard_base/components/<component-name>/<component-name>.component.yml
```

**What to confirm before writing the script:**
- [ ] Every `required` prop is included in the `inputs` JSON with valid enum values
- [ ] Every prop name is copied exactly from the schema (no guessing `direction` vs `flex_direction`)
- [ ] Every slot name used in `$c['slot']` is copied exactly from the `slots:` block in the schema
- [ ] The `component_id` string is `sdc.<theme-namespace>.<component-name>` — verify the namespace from the schema file's path

### 2. Component Template Read (required when changing layout or nesting)

```bash
# Read the actual Twig before deciding on a layout approach
cat web/themes/contrib/<base-theme>/components/<component-name>/<component-name>.twig
```

**What to confirm:**
- [ ] Understand what the component renders internally — if it already renders a button, wrapping it in a flex container won't affect the button's layout
- [ ] Identify which CSS classes are applied to the outer wrapper — this determines what CSS selectors will work
- [ ] Identify the slot variable names used in the template (e.g., `{{ content }}` vs `{{ flex_items }}`) — these must match the `slot` field in the DB row

### 3. Module Availability Check (required before using any entity type or API class)

```bash
ddev drush pml --status=enabled | grep <module-name>
```

**What to confirm:**
- [ ] The module is `Enabled` before using its entity type (e.g., `block_content`, `paragraphs`)
- [ ] If not enabled, choose an alternative approach that does not require it

### 4. Image / Asset Reachability Check (required before referencing any file path in `inputs` JSON)

```bash
curl -k -o /dev/null -s -w "%{http_code}" "https://<local-site>/<path-to-asset>"
# Must return 200 before using the path
```

### 5. Existing DB State Check (required before any mutation script)

```bash
ddev drush sql-query "SELECT delta, components_uuid, components_component_id, components_parent_uuid, components_slot, components_inputs FROM canvas_page__components WHERE entity_id=1 AND deleted=0 ORDER BY delta;"
```

**What to confirm:**
- [ ] The UUIDs you intend to modify actually exist in the current DB state
- [ ] The parent/slot relationships you intend to create don't already exist (avoid duplicates)
- [ ] After any previous script ran, verify it actually committed before running the next one

### 6. Logo Path Verification (required when branding changes are involved)

```bash
[runtime_wrapper] drush php-eval "
\$g = \Drupal::config('system.theme.global')->get();
echo 'use_default: ' . var_export(\$g['logo']['use_default'], true) . PHP_EOL;
echo 'path: ' . \$g['logo']['path'] . PHP_EOL;
"
# use_default must be FALSE and path must point to the custom theme, not contrib
curl -k -s https://[site-url]/[expected-logo-path] | head -1
# Must return the correct SVG opening tag, not the parent theme's fallback
```

> [!NOTE]
> Browser cache will continue to serve the old logo even after the correct SVG is on disk. Confirm server-side via `curl` rather than a browser screenshot. Hard reload (Cmd+Shift+R with DevTools open, "Disable cache" checked) is required to verify visually.

### 7. Placeholder Content Scrub (required before Phase 10.1 Content Audit)

Base themes ship demo copy in Canvas components. Before any visual regression screenshot is taken, scan for and replace all non-client text:

```bash
[runtime_wrapper] drush sql-query \
  "SELECT delta, components_component_id, components_inputs FROM canvas_page__components WHERE entity_id=1 ORDER BY delta;" \
  | grep -i 'keytail\|neonbyte\|SDRs hit\|Get found\|Search and outreach'
```

If any matches appear, update them via the entity API (see **Keyed replacement pattern** in Script Writing Rules below).

### 8. Canonical Prop Shape Lookup (required before writing envelope-shaped inputs via overlay or direct entity set)

For component props typed as `entity_reference` (media, nodes, etc.) or any prop where a dump shows a full `sourceType` / `expression` / `sourceTypeSettings` envelope, the canonical source for the `expression` string and `sourceTypeSettings` block is the active component config — never retype either from documentation.

```bash
ddev drush cget canvas.component.sdc.<theme>.<component-name>
# Look under: versioned_properties.active.settings.prop_field_definitions.<prop>
# Copy `expression` and `field_instance_settings` byte-exact.
```

The `expression` string contains Unicode separator characters (ℹ︎ ␟ ␜ ␝ ␞ ↠) that are easy to mangle when retyped. A single wrong codepoint produces a silent save-time coercion (see Rule F).

A working, canonical `StaticPropSource` assembly lives in the canvas test fixtures:

```
web/modules/contrib/canvas/tests/src/TestSite/CanvasTestSetup.php
```

Search for `$static_image_prop_source`. Adapt the `target_bundles` in `sourceTypeSettings.instance.handler_settings` to match whichever media bundles the target component's prop declaration accepts (a component may support `image` only, or both `image` and `svg_image`, etc.).

**Why this matters:** When writing directly via the content entity's `components` field (overlay-apply scripts, bulk migrations), the prop value goes through Canvas's `uncollapse()` coercion pipeline. If the shape is unrecognized — including through a mangled `expression` — the value is silently dropped. See Rule F for the mechanism and diagnosis.

---

## Lessons From the Services Page Migration

The following rules were added after building the Services Canvas page programmatically. Each one caused a blocking failure that required debugging.

### Rule A — Images must use `target_id` (Media entity reference), never raw `src`

Canvas component props typed as `entity_reference` (e.g., `image` on `canvas-image`, `card-canvas`, `logo-item-canvas`) must receive a Media entity reference object, **not** a raw `{src, alt, width}` shape.

```php
// WRONG — passes a raw src string; Canvas resolves nothing, loading becomes null
'image' => ['src' => '/sites/default/files/my-image.png', 'alt' => 'Alt text']

// CORRECT — passes a Media entity ID; Canvas resolves it to the full image shape at render time
'image' => ['target_id' => 21]  // MID from the Media library
```

**Why it matters:** The Twig `image-or-media` sub-component requires `loading` to be `"eager"` or `"lazy"`. When a raw `src` is passed, `loading` resolves to `null`, which triggers a Twig schema validation error at render time even though `->save()` succeeds.

**Pre-flight:** Before building any page, list all Media entity IDs with:
```bash
ddev drush ev "
\$entities = \Drupal::entityTypeManager()->getStorage('media')->loadMultiple();
foreach (\$entities as \$mid => \$m) {
    print \$mid . ' | ' . \$m->bundle() . ' | ' . \$m->label() . PHP_EOL;
}
"
```

#### On-entity storage vs. submit-time shape

Canvas accepts **two equivalent forms** for an `entity_reference` prop when writing directly via the `components` field, and normalizes both to the same canonical on-entity shape at save time:

| Form | When to use | What gets stored |
|---|---|---|
| **Shortcut:** `['target_id' => N]` | Drush `ev` / `scr` scripts that build a page from scratch in one pass, tests, small one-off mutations. Terse. | `{"target_id": N}` |
| **Full StaticPropSource envelope:** `sourceType` + `value.target_id` + `expression` + `sourceTypeSettings` | Overlay-apply scripts that patch `inputs` by merging into an existing, dumped JSON blob; bulk migration tools that must be robust against partial dumps; any context where you want the submit shape to match what the Canvas editor UI POSTs. | `{"target_id": N}` — Canvas **collapses on save** |

Both produce identical on-entity storage (`{"target_id": N}`) and identical render output. Canvas reconstructs the full `StaticPropSource` at render time from `prop_field_definitions`, which is why the collapsed form is sufficient.

**Full-envelope YAML template** (adapt per component — get the `expression` and `sourceTypeSettings` from Pre-Flight item 8, never retype):

```yaml
image:
  sourceType: 'static:field_item:entity_reference'
  value:
    target_id: <media entity id>
  expression: '<paste byte-exact from prop_field_definitions.<prop>.expression>'
  sourceTypeSettings:
    storage:
      target_type: media
    instance:
      handler: 'default:media'
      handler_settings:
        target_bundles:
          image: image
          # ...plus any other bundles the prop declares support for
```

**Rule of thumb:** If you are writing the component tree fresh, use the `{'target_id' => N}` shortcut. If you are patching one key inside an already-dumped inputs blob (overlay workflow), mirror the envelope shape that was in the dump — which after any prior save will be the bare `{"target_id": N}` collapse. If a dump shows full-envelope inputs, the page has not been re-saved since that shape was last applied; that is a useful forensic signal.

**Do not invent a third form.** See Rule F for the silent-failure mechanism that catches unrecognized shapes.

### Rule B — Enum values for padding/margin have a ceiling of `large`

The allowed values for `padding_top`, `padding_bottom`, `margin_top`, `margin_bottom` on `section` and `flex-wrapper` are:

```
zero | small | medium | large
```

`x-large` is **not** a valid enum value and will cause `ComponentTreeItem::preSave()` to throw, preventing `->save()` from committing any component on the page — not just the offending one.

**Additional enum differences between components (learned from OSP migration):**

| Component | `color` enum values |
|---|---|
| `heading` | `default \| soft \| medium \| loud \| primary` |
| `text` | `inherit \| soft \| medium \| loud \| primary` |

Note that `heading` uses `default` but NOT `inherit`; `text` uses `inherit` but NOT `default`. Using the wrong value in either causes a `preSave()` LogicException. When in doubt, run: `grep -A8 'enum:' web/themes/contrib/dripyard_base/components/<name>/<name>.component.yml`

**`title-cta` requires a non-empty `title` string.** Passing `''` (empty string) fails validation. Use `' '` (single space) if you want a button-only CTA with no visible heading.

**Rule:** When in doubt, copy the exact values from a working page's component inputs:
```bash
ddev drush ev "
\$page = \Drupal::entityTypeManager()->getStorage('canvas_page')->load(1);
\$comps = \$page->get('components')->getValue();
foreach (\$comps as \$c) {
    if (\$c['component_id'] === 'sdc.dripyard_base.section') {
        print json_encode(json_decode(\$c['inputs'], true), JSON_PRETTY_PRINT) . PHP_EOL;
        break;
    }
}
"
```

### Rule C — Canvas page internal path is `/page/{id}`, not `/canvas-page/{id}`

When creating a path alias for a Canvas page, the internal system path is `/page/{id}`:

```php
// WRONG — 404:
$alias->set('path', '/canvas-page/3');

// CORRECT:
$alias->set('path', '/page/3');
```

Verify the correct internal path before creating any alias:
```bash
ddev drush ev "
\$page = \Drupal::entityTypeManager()->getStorage('canvas_page')->load(3);
print \$page->toUrl('canonical')->getInternalPath() . PHP_EOL;  // outputs: page/3
"
```

### Rule D — Adding props to Canvas config entities does NOT change `active_version`

Canvas stores a content-hash of `versioned_properties` as `active_version`. Editing a Canvas component config YAML (`config/sync/canvas.component.sdc.dripyard_base.*.yml`) to add a new allowed prop and running `config:import` **does not** regenerate the hash.

This is safe by design: the new prop is accepted in `inputs` immediately after import (the validator reads the live config, not the hash), but `active_version` stays the same. You do **not** need to re-resave all pages after adding a prop.

**Workflow for adding an undeclared prop to a Canvas component:**
1. Add the prop definition block under `versioned_properties.active.settings.prop_field_definitions` in the YAML
2. Run `ddev drush config:import --yes`
3. Verify the update was applied: `ddev drush config:get canvas.component.sdc.dripyard_base.<component> active_version`
4. Re-run the page build script — the new prop will now be accepted

> [!CAUTION]
> Do not edit Canvas component config YAMLs to add props that are not in the SDC `.component.yml` schema. The validator checks both. Adding a prop to the Canvas config but not the SDC schema will still cause a Twig error at render time.

### Rule E — `canvas_page` title field is `title`, not `label`

The `canvas_page` entity has a `title` field (type `string`). Calling `->set('label', ...)` throws `Field label is unknown`.

```php
// WRONG:
$page->set('label', 'Services');

// CORRECT:
$page->set('title', 'Services');
```

The page label shown in the admin UI comes from the `title` field. This also populates the `<title>` tag in the HTML via Drupal's entity label system.

### Rule F — Unrecognized image-prop shapes fail silently (no watchdog, no save-time error)

When writing a value into an `entity_reference` prop via the content entity API, Canvas runs the input through `GeneratedFieldExplicitInputUxComponentSourceBase::uncollapse()` (in the canvas module, around line 1475 at time of writing). Any value whose top-level shape lacks a `sourceType` key is handed to `getDefaultStaticPropSource(...)->withValue($value, allow_empty: TRUE)`. The `allow_empty: TRUE` argument means: if the shape doesn't match the prop's expected field-item structure, the value **coerces to empty** instead of throwing.

Canvas then falls back to a `DefaultRelativeUrlPropSource` at render time. That is a render-time fallback only — it is **not** a valid on-entity storage shape. If no fallback asset exists for the component, the image simply doesn't render: the consumer Twig (e.g. `dripyard_base/components/image-or-media/image-or-media.twig`) guards with `{% if image.src %}`, and a coerced-empty value emits no `<img>` at all.

**Symptoms of a silent coercion:**
- `->save()` returns without throwing.
- No error in `ddev drush watchdog:show`.
- A subsequent `drush content:export` or a direct SQL query on `canvas_page__components.components_inputs` shows the prop as an empty object or `null`, not the value you wrote.
- The rendered page has no `<img>` tag for that component (and no placeholder either).

**Known bad shapes that trigger this coercion:**

| Shape | Why it fails |
|---|---|
| `{src, alt, width, height}` (flat) | Has no `sourceType` key. `uncollapse()` hands it to `withValue(allow_empty: TRUE)` with a field-item schema expecting `target_id`. Coerces to empty. |
| `{CANVAS_ENTITY_REFERENCE: {target_uuid, target_type}}` | This is the recipe-YAML *import-time* wrapper resolved by `DefaultContentSubscriber`; it is never a valid *on-entity* shape. On canvas v1.3.2 it trips a TypeError in `ReferenceFieldTypePropExpression::{closure}` during `calculateDependencies`. |
| A full envelope with a mangled `expression` string (one wrong Unicode separator) | The coercion pipeline can't resolve the expression to a real prop shape. Coerces to empty. |

**Valid shapes** (both covered under Rule A's "On-entity storage vs. submit-time shape"):
1. `{'target_id' => N}` shortcut.
2. Full `StaticPropSource` envelope with a byte-exact `expression` and matching `sourceTypeSettings`.

**Diagnosis recipe** when a component is missing its image with no error signal:

```bash
# 1. Dump the current inputs for the suspect component:
ddev drush sql-query \
  "SELECT components_inputs FROM canvas_page__components \
   WHERE entity_id=<id> AND components_uuid='<uuid>'"
# 2. Parse the JSON. If the prop is `{}` or missing when you wrote a value, it was coerced.
# 3. Cross-check Pre-Flight item 8: is your `expression` byte-identical to the active config?
# 4. Re-apply with either the `{target_id: N}` shortcut or a freshly-copied envelope.
```

---

## Script Writing Rules

### One script, one responsibility
Each Drush script must do exactly one thing. Never combine unrelated mutations. If fixing the tab section and the hero, write `fix_tabs.php` and `fix_hero.php` separately.

**Why:** When a multi-mutation script fails mid-way, the DB is left in a partially-mutated state that requires investigation before continuing.

### Always include a verification query at the end of every script

```php
// At the end of every fix script, after $page->save():
$verify = \Drupal::database()->select('canvas_page__components', 'c')
  ->fields('c', ['components_uuid', 'components_component_id', 'components_inputs'])
  ->condition('c.entity_id', 1)
  ->condition('c.components_uuid', $the_uuid_you_just_wrote)
  ->execute()
  ->fetchAll();
echo "Verification:\n";
print_r($verify);
```

### Always delete the script file in the same command

```bash
ddev drush scr fix_something.php && rm fix_something.php
```

If the script fails, the file remains for inspection. If it succeeds, it's gone. Never leave `.php` scripts in the project root.

### Use `json_decode(..., true)` to read existing inputs before overwriting

```php
// WRONG — overwrites everything:
$c['inputs'] = json_encode(['new_prop' => 'value']);

// CORRECT — preserves existing values:
$inputs = json_decode($c['inputs'], true);
$inputs['new_prop'] = 'value';
$c['inputs'] = json_encode($inputs);
```

### Do not use static class references in Drush scripts

```php
// WRONG — class may not be autoloaded:
$entity = \Drupal\block_content\Entity\BlockContent::create([...]);

// CORRECT — always use the entity type manager:
$entity = \Drupal::entityTypeManager()->getStorage('block_content')->create([...]);
```

### Keyed replacement pattern for bulk content updates

When replacing multiple placeholder strings across many components, use a keyed array and iterate — never write one script per field:

```php
<?php
$replacements = [
  'Old demo headline text'   => 'New client headline text',
  'Another demo string'      => 'Another client string',
];

$page = \Drupal::entityTypeManager()->getStorage('canvas_page')->load(1);
$comps = $page->get('components')->getValue();

foreach ($comps as &$comp) {
  $inputs = json_decode($comp['inputs'] ?? '{}', true);
  $changed = false;
  foreach (['title', 'text'] as $field) {
    if (isset($inputs[$field])) {
      $clean = strip_tags($inputs[$field]);
      if (array_key_exists($clean, $replacements)) {
        $inputs[$field] = $replacements[$clean];
        $changed = true;
      }
    }
  }
  if ($changed) { $comp['inputs'] = json_encode($inputs); }
}
unset($comp);

$page->set('components', $comps)->save();
```

> [!NOTE]
> `strip_tags()` is required before the key lookup because some text fields contain HTML (`<p>` wrappers). The replacement value is stored as plain text — the SDC template wraps it appropriately.

---

## Template Override Rules

### Always copy-then-modify — never write a template from scratch

```bash
# Copy the base theme template first
cp web/themes/contrib/<base-theme>/templates/layout/page.html.twig \
   web/themes/custom/<custom-theme>/templates/layout/page.html.twig
```

Then modify only the specific lines that need to change. This ensures the surrounding Twig structure (variable names, embed blocks) stays in sync with the base theme.

### Verify the slot variable name in the header component before overriding

```bash
# Check what variable name the header SDC actually uses
cat web/themes/contrib/neonbyte/components/header/header/header.twig | grep header_third
```

Only then write the Twig `set` injection.

---

## Overlay-Based Content Passes

For iterative editing of a `canvas_page` (multi-section builds, partial fixes, section-by-section reviews), the `ev`/`scr` one-shot pattern becomes painful: each pass has to reconstruct the whole inputs blob or risk clobbering unrelated keys. The alternative is an **overlay** workflow — a small pair of scripts (`dump-canvas-page.php`, `apply-canvas-page.php`) that operate on the live entity via sparse YAML patches.

### When to use

- Patching one or more props on an **existing** component without rewriting the whole component tree.
- Inserting new components after an anchor in an existing tree.
- Removing a component (and its descendants) from an existing tree.
- Any pass the user expects to review as a `git diff` before applying.

### When NOT to use

- Building a page from scratch — use a one-shot `drush scr build_page.php` instead. Overlay is optimized for patches, not greenfield construction.
- Anything that would be cleaner as a config-sync change (e.g., adding a prop declaration to `canvas.component.sdc.<theme>.<component>` — that's a YAML in `config/sync/`, not an overlay).
- Editorial body copy the site owner expects to maintain through the admin UI. Overlay edits show up as mystery diffs to anyone reviewing git history; prefer the admin UI for content that has a clear "editor owns this" story.

### The pattern

```
dump → write/edit overlay → dry-run → apply → verify (Tier 1 curl → Tier 2 ARIA if UI-visible) → snapshot
```

1. **Dump current state** so the overlay is built against a known baseline:
   ```bash
   ddev drush php:script scripts/dump-canvas-page.php <page-uuid>
   # Output: content-exports/<uuid>.yml (path may be relative to drush CWD)
   ```
2. **Author the overlay** as a sparse YAML file. Keep one overlay per logical change (one section, one fix) — never bundle unrelated passes in a single overlay. Example layout:
   ```yaml
   # content-exports/homepage-section-N.overlay.yml
   component_inputs:
     '<component-uuid>':
       # keys here are merged INTO the existing inputs via array_replace (not array_merge)
       href: 'https://example.com'
       image:
         # ...see Rule A for valid shapes
   add_components:
     - after_uuid: '<anchor-uuid>'
       component:
         uuid: '<new-uuid>'
         component_id: 'sdc.<theme>.<component-name>'
         parent_uuid: '<parent-uuid-or-null>'
         slot: '<slot-or-null>'
         inputs: { ... }
   remove_components:
     - '<uuid-to-remove>'  # descendants cascade automatically
   ```
3. **Dry run first.** Every apply-script must support a dry-run mode that logs the diff it would apply without calling `->save()`. Always run dry-run before apply on any overlay that touches more than one component.
4. **Apply**, then **verify** per the Three-Tier Verification Hierarchy:
   - Tier 1 (curl the rendered page) is non-negotiable — confirms the component actually rendered and key markers (`data-component-id`, expected `<img>` count, `srcset`) are present.
   - Tier 2 (ARIA audit) only if the change affects semantic/interactive structure.
   - Tier 3 (screenshots) only after Tiers 1 & 2 pass.
5. **Rollback pairing.** Before applying the overlay, pause to create a code + DB rollback point with a shared tag:
   ```
   <slug>-YYYYMMDD-HHMM
   ```
   Use the tag in both the git commit message on the current branch and the DDEV snapshot name (`ddev snapshot --name=<slug>-YYYYMMDD-HHMM`). Matching names sort together in `git log` and `ddev snapshot --list`.

### Apply-script semantic requirements

Any reusable `apply-canvas-page.php` implementation (the Phase 3 / PL2 one is a working reference) should guarantee:

| Behavior | Requirement |
|---|---|
| `component_inputs` merge strategy | `array_replace` (overwrite at top level only), **never** `array_merge`. `array_merge` reindexes numeric-keyed arrays and will silently reorder nested lists. |
| `inputs` encoding | Always re-`json_encode` after patching — the field stores a JSON string, not a PHP array. |
| Dry-run mode | Loads and patches in memory, prints a diff-friendly representation, does NOT call `->save()`. Triggered by a CLI flag. |
| `add_components` idempotency | If a component with the same UUID already exists, skip (warn) rather than insert a duplicate. This makes re-runs safe. |
| `remove_components` cascade | Descendants of a removed component must also be removed, in post-order, to avoid orphan references. |
| Exit status | Non-zero on any validation failure, UUID-not-found, or partial apply. Zero ONLY on clean success. |

### Gotchas

- **Drush CWD surprise.** `drush php:script` runs with CWD = `web/` inside the DDEV container, not the repo root. Pathing in `dump-canvas-page.php` and `apply-canvas-page.php` must account for this — either pass absolute paths or resolve relative paths against `__DIR__`. Outputs written to a relative path will land inside `web/`, not at the repo root.
- **Dumped files are a gitignored artifact, not a source of truth.** Add `web/content-exports/` (or whatever path the dump script resolves to) to `.gitignore`. Commit the overlay YAML if it represents a reviewable change; do not commit the raw full-tree dumps.

---

## Watchdog Error Interpretation

When checking `drush watchdog:show` during a gate, not every error record is a live page error. Failed `drush scr` runs log their schema validation failures to watchdog at severity=3, making them look identical to runtime rendering errors.

**How to tell them apart — check the backtrace:**

| Backtrace contains | Means |
|---|---|
| `/var/www/html/fix_*.php` or `/var/www/html/[script_name].php` | Error from a **failed `drush scr` run** — not a live page error. Check the script's exit status instead. |
| `HtmlRenderer.php`, `HttpKernel.php`, `PageCache.php` | Error from a **live page request** — must be investigated and fixed before proceeding. |

**Timestamp as a secondary signal**: errors from script runs will have a timestamp matching when you ran the script, not matching a browser page load. Use:
```bash
# Convert a watchdog timestamp to human-readable:
[runtime_wrapper] drush php-eval "echo date('Y-m-d H:i:s', [wid_timestamp]);"
```

> [!NOTE]
> A watchdog error from a failed script does not mean the page is broken — it means the script itself failed. Confirm the page still returns 200 and the component tree is intact before concluding there is a live issue.

---

## Verification After Every Fix

After every script or template change, always confirm the fix via the browser **before** moving to the next item on the checklist.

```
Confirm → Screenshot → Check visually → Mark item done → Next
```

Never batch multiple unverified fixes. A second broken fix on top of a broken first fix creates a compound state that is very hard to debug.

---

## Priority Order Reference

When executing visual remediation, always work from this table — top to bottom, one row at a time:

| Priority | Indicator | Fix type |
|---|---|---|
| 🔴 Now | Site is broken / content is visibly wrong for anonymous users | Must fix before anything else |
| 🟠 High | Major structural gap vs. design (missing layout, missing section) | Fix in current session |
| 🟡 Medium | Visual gap that requires CSS or component extension | Fix in next session |
| 🟢 Low | Minor polish (colour, spacing, icon swap) | Fix in polish pass |
