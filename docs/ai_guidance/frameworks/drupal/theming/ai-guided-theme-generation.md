# AI-Guided Theme Generation

This runbook outlines the standard operating procedure for AI developer agents tasked with safely creating a new testbed theme and translating UI screenshots into functional Drupal pages.

> [!IMPORTANT]
> **Theme-Specific Run-Time Instruction**: At run-time, you MUST ask the user to provide the documentation folder path for their underlying base theme framework (e.g., `drupal/dripyard_themes`). You must thoroughly review all theme-specific instructions (such as component inventories and color management rules) stored in that folder before making architectural layout assumptions.

---

## Companion Documents

All files below live alongside this SOP in `docs/frameworks/drupal/theming/`. Read each one at the phase where it is first referenced — the index below maps each document to its mandatory read phase.

| Document | Purpose | Mandatory read |
|---|---|---|
| [`canvas-scripting-protocol.md`](canvas-scripting-protocol.md) | Pre-flight checklist, schema verification, script-writing rules, and verification cadence for all Canvas component work | Phase 0 / before any Drush script |
| [`component-cookbook.md`](component-cookbook.md) | Authoritative prop/slot names for every dripyard_base component — never write `inputs` JSON from memory | Phase 4 (build) + Phase 9 (pre-script) |
| [`content-migration-cookbook.md`](content-migration-cookbook.md) | Step-by-step migration patterns, inventory commands, dependency ordering, form framework assessment | Phase 13 |
| [`operational-guidance.md`](operational-guidance.md) | Efficiency rules, known config traps, verification shortcuts, screenshot timing, failure patterns from live runs | Phase 0 / start of every run |
| [`verification-cookbook.md`](../../../testing/verification-cookbook.md) | Authoritative reference for the **Three-Tier Hierarchy** and **"Skeleton-First"** (ARIA) testing strategy | Phase 0 / before any verification |
| [`visual-regression-strategy.md`](visual-regression-strategy.md) | Panel-by-panel visual regression protocol — one subagent call per design slice | Phase 8, 10, 16 |

> [!NOTE]
> `canvas_snapshot*.sql` files are local rollback tools only — they are gitignored and must never be committed. See Phase 3 for the snapshot procedure.

---

## Operating Principles
The primary objective is to ingest a UI screenshot, map its visual elements to the components provided by the user's specified base theme framework, and implement the resulting layout within Drupal.

To ensure absolute safety and maintain a functional baseline for the host project, **AIs must first duplicate the existing stable theme into a new working directory before making any experimental layout or styling changes.**

> [!IMPORTANT]
> **Visual Remediation Phase**: When fixing structural or CSS gaps against a design reference (i.e., any work after the initial assembly), you MUST follow the [`canvas-scripting-protocol.md`](canvas-scripting-protocol.md) in this directory before writing any Drush script or Twig override. That document defines mandatory pre-flight checks, schema verification steps, script writing rules, and verification requirements that apply to all Canvas component work — initial build, additions, and updates alike.

> [!NOTE]
> **Before starting any run**, read [`operational-guidance.md`](operational-guidance.md) in this directory. It documents efficiency rules and failure patterns distilled from live execution — covering verification shortcuts, known config traps, Canvas content persistence, and screenshot timing. Applying it avoids the most common time-consuming errors.

---

## Phase 0: AI Execution Directives

The following machine-readable directives govern every phase. Claude parses XML tags as structured constraints distinct from prose instructions — grouping concern types in their own tags reduces misinterpretation when this document is loaded as context.

<non_negotiable_rules>
These rules apply to every phase without exception:
1. Stage files by explicit path only — never use `git add .`
2. Write temporary Drush scripts as `.php` files in the project root; execute with `drush scr`; delete immediately after execution. Never use heredoc-to-stdin.
3. Set Canvas `component_version` to `NULL` in every assembly script. Never hard-code a version hash.
4. Stop at every Approval Checkpoint and hold for explicit user confirmation. Do not infer consent from prior context.
5. Read `component-cookbook.md` in full before writing any Phase 9 assembly script. No prop name may be written from memory.
6. Read `operational-guidance.md` before starting any run.
</non_negotiable_rules>

<investigate_before_acting>
Never write a `component_id`, prop name, slot name, schema value, entity ID, or Drush command from memory. Before writing any Canvas assembly script, open and read the relevant `.component.yml` file to confirm exact field names and allowed values. If uncertain whether a config key, module, or Drush command exists, run a verification command before assuming.
</investigate_before_acting>

<no_hardcoded_ids>
Always resolve Drupal entity IDs dynamically — never hard-code node IDs, block IDs, user IDs, file IDs, or menu IDs in assembly scripts:
- Nodes: `entityTypeManager()->getStorage('node')->loadByProperties(['title' => '...', 'type' => '...'])`
- Blocks: `entityTypeManager()->getStorage('block')->loadByProperties(['theme' => '[theme_machine_name]'])`
- Front page path: `\Drupal::config('system.site')->get('page.front')`
Hard-coded IDs that work locally will silently fail in staging and production.
</no_hardcoded_ids>

<scope_constraint>
Implement only what is visible in the approved design reference and explicitly confirmed in the component mapping plan. Do not add: components absent from the design reference; CSS utilities for hypothetical future use; error handling for out-of-scope scenarios; comments or docstrings in files not created or modified in this run. The minimum implementation that passes all phase gates is the correct implementation.
</scope_constraint>

<reversibility_guard>
Before executing any of the following, state the operation and pause for explicit user confirmation:
- TRUNCATE or DELETE on any database table (including `cache_render`, `canvas_page__components`)
- Bulk deletion of menu items or block placements
- Restoration from a SQL snapshot file
Routine operations — `drush cr`, `config:export`, `git add`, `git commit` — do not require confirmation.
</reversibility_guard>

<parallelism_guidance>
Run independent operations within a phase gate in parallel rather than sequentially:
- Multiple curl verification checks within the same gate
- Multiple `drush sql-query` introspection commands during Phase 4 audit
- Multiple file reads when cross-referencing the component cookbook and schema files
Never parallelize operations with dependencies — `drush cr` must complete before curl checks that rely on the cleared cache.
</parallelism_guidance>

<subagent_policy>
To maximize developer velocity, follow the **Three-Tier Verification Hierarchy** as defined in the [**Verification Cookbook**](../../../testing/verification-cookbook.md). Always use the fastest tool that provides sufficient structural confirmation before escalating to slower, more resource-intensive tools.

1. **Tier 1: Headless (Instant)**
   - Use `curl` for HTTP status, HTML tag presence, CSS variables, and server-side text content.
2. **Tier 2: Structural Skeleton (Fast)**
   - Use `read_browser_page` (ARIA / Accessibility mode) for all structural and component assembly verification.
3. **Tier 3: Visual Fidelity (Slow)**
   - Use `browser_subagent` (Screenshots) exclusively for final visual regression.

**HARD RULE — DO NOT BYPASS**: You MUST NOT call `browser_subagent` (screenshots) for any construction or assembly verification until `read_browser_page` (ARIA mode) has returned a passing structural audit confirming the component skeleton is correct. Calling a browser subagent before a Tier 2 ARIA audit is a protocol violation. There are no exceptions.
</subagent_policy>

<decision_commitment>
Once a user approves an Approval Checkpoint, those architectural decisions are final for this run. Do not re-evaluate or propose alternatives to approved decisions unless a subsequent phase gate explicitly fails and the failure is directly caused by the prior decision. Course-correct only when a gate is red.
</decision_commitment>

<session_continuity>
At the start of each working session:
1. Run `git log --oneline -10` to identify where the previous session ended.
2. **Read [`verification-cookbook.md`](../../../testing/verification-cookbook.md)** — this is mandatory at the start of every session. It defines the Three-Tier Hierarchy that governs all page verification. Do not begin any verification task without reviewing it.
3. Record current phase, active section, and any open failure paths at `docs/frameworks/drupal/theming/session_progress.md` (gitignored).
4. Reconstruct state from the commit log and phase gates — never from memory alone.
</session_continuity>

---


## Phase 1: Pre-Execution Discovery
Before cloning repositories or running commands, the AI must collect all foundational environment variables and display them to the user for explicit confirmation.

1. Gather the following run-time parameters:
   - **Primary Active Theme Name** (e.g., `performant_labs`)
   - **Target Local Project Path** (e.g., `~/Sites/pl-performantlabs.com`)
   - **Base Theme Documentation Namespace** (e.g., `drupal/dripyard_themes`)
   - **Location of Target Layout Screenshots**
   - **Existing Site Audit**: Explicitly ask the user: *"Is there an existing version of this website already running locally that I should audit before building?"* If yes, ask for its local path (e.g., `~/Sites/pl-performantlabs.com`). Record the answer — a "yes" makes Phase 4 Step 2 **mandatory**, not optional.
   - **Local Runtime Environment**: Automatically test the target codebase to detect the active container wrapper (e.g., scan for `.ddev/` or `.lando.yml`). Report the detected runtime prefix (e.g., `ddev`, `lando`, or native) to the user rather than blindly assuming.
   - **Git Safety Check**: Run `git status` to verify the working tree is completely clean. If uncommitted changes exist, force the user to stash or commit them. Do not allow execution on a dirty tree.
2. Display these collected values back to the user in a formatted list or table.
3. Explicitly ask: *"Do these setup parameters look correct? Just give me the green light and we'll jump into Phase 2!"* DO NOT proceed until the user approves.

---

## Phase 2: Brand Asset Collection

Before cloning a single file or running any Drush command, the AI must collect all **ancillary brand identity assets**. These items are entirely independent of templates and components — they configure *what the theme looks like* rather than *how it lays out content*. Collecting them here prevents the recurring failure mode where body colors, logos, and the favicon remain as inherited parent-theme defaults until visual regression exposes them near the end of the project.

> [!IMPORTANT]
> Do NOT advance to Phase 3 until every item in the checklist below has been explicitly provided by the user **or** explicitly marked as "use parent theme default / skip."

### 2.1 Required checklist

Ask the user to provide **all of the following** at once. Present it as a single structured prompt so the user can answer in one pass:

| # | Asset | What to ask for | Format requirement |
|---|---|---|---|
| 1 | **Primary brand color** | The dominant brand color (e.g., navy, forest green) | Hex value — e.g., `#1B2638` |
| 2 | **Secondary / accent color** | The CTA / highlight color (e.g., amber, coral) | Hex value — e.g., `#F59E0B` |
| 3 | **Color brightness hints** | Are each of those colors perceived as light or dark backgrounds? | `light` or `dark` per color |
| 4 | **Logo file** | The site logo (SVG strongly preferred; PNG acceptable) | File path or paste SVG source |
| 5 | **Favicon** | A 32×32 or 64×64 icon (SVG or PNG) | File path or paste; `null` = generate from logo |
| 6 | **Site name** | The exact site name string displayed in the `<title>` tag and branding block | Plain text string |
| 7 | **Tagline / slogan** | One-line site tagline (displayed in header branding or footer) | Plain text string, or `none` |
| 8 | **Brand font(s)** | Primary heading font and body font names | Google Font name(s) or `use parent default` |
| 9 | **Social / OG image** | A 1200×630 image for Open Graph / Twitter cards | File path, or `generate from logo` |
| 10 | **Social profile URLs** | LinkedIn, GitHub, X/Twitter, etc. | List of full URLs; omit any that don't apply |

### 2.2 Execution steps (after user provides assets)

1. **Copy assets into the theme**: Place logos, favicons, and OG images into `web/themes/custom/[primary_theme]_[timestamp]/` (logo at root; others under `assets/`). Never reference parent-theme asset paths.
2. **Apply the color palette**: Write the two hex values into the theme's configuration:
   ```bash
   [runtime_wrapper] drush php-eval "
   \$config = \Drupal::configFactory()->getEditable('[theme_machine_name].settings');
   \$config->set('theme_colors.colors.base_primary_color', '#[HEX]');
   \$config->set('theme_colors.colors.base_primary_color_brightness', '[light|dark]');
   \$config->set('theme_colors.colors.base_secondary_color', '#[HEX]');
   \$config->set('theme_colors.colors.base_secondary_color_brightness', '[light|dark]');
   \$config->save();
   "
   [runtime_wrapper] drush cr
   ```
   > [!NOTE]
   > In NeonByte / Dripyard-based themes, the entire palette (all `--primary-*` and `--neutral-*` scale tokens) is derived from these two config values via `oklch()` in `variables-colors-semantic.css`. Setting them here drives all button colors, card borders, body backgrounds, and icon accents — no additional CSS is needed for the base palette.
3. **Wire the logo**: There are **two independent config locations** for the logo — both must be set or the theme-specific one silently wins:
   ```bash
   # Step A — global (may be overridden by theme-specific):
   [runtime_wrapper] drush config:get system.theme.global logo.path
   [runtime_wrapper] drush config:get system.theme.global logo.use_default
   # Both must be: path = themes/custom/[theme]/logo.svg, use_default = false

   # Step B — theme-specific (takes priority over global):
   [runtime_wrapper] drush php-eval "\$s = \Drupal::config('[theme_machine_name].settings'); echo \$s->get('logo.use_default').PHP_EOL; echo (\$s->get('logo.path') ?? '(not set)').PHP_EOL;"
   # logo.use_default must be FALSE here too.
   # If it is TRUE, the theme ignores system.theme.global and uses the parent
   # theme's default logo — even if your custom SVG is on disk.
   ```
   Fix theme-specific settings if needed:
   ```bash
   [runtime_wrapper] drush php-eval "
   \$c = \Drupal::configFactory()->getEditable('[theme_machine_name].settings');
   \$c->set('logo.use_default', FALSE);
   \$c->set('logo.path', 'themes/custom/[theme_machine_name]/logo.svg?v=1');
   \$c->save();
   "
   [runtime_wrapper] drush cr
   ```
   > [!NOTE]
   > Append `?v=1` to the logo path so browsers that previously cached the parent theme's logo at the same URL are forced to fetch the new file.

   Confirm server is serving the correct file:
   ```bash
   curl -sk https://[site-url]/themes/custom/[theme_machine_name]/logo.svg | head -1
   # Must start with <svg … aria-label="[Site Name]"
   ```
   Export and commit:
   ```bash
   [runtime_wrapper] drush config:export --yes
   git add config/sync/ web/themes/custom/[primary_theme]_[timestamp]/logo.svg
   git commit -m "feat: brand assets — logo, palette, favicon"
   ```
4. **Apply the favicon**: Create `favicon.svg` (or `.ico`) at `web/themes/custom/[primary_theme]_[timestamp]/favicon.svg`. Then wire it via `hook_page_attachments_alter()` in the theme's `.theme` file:
   ```php
   function [theme]_page_attachments_alter(array &$attachments): void {
     $path = '/' . \Drupal::service('extension.list.theme')->getPath('[theme]');
     $attachments['#attached']['html_head'][] = [[
       '#type' => 'html_tag', '#tag' => 'link',
       '#attributes' => ['rel' => 'icon', 'type' => 'image/svg+xml',
                         'href' => $path . '/favicon.svg'],
     ], 'favicon_svg'];
   }
   ```
   > [!WARNING]
   > **Do NOT rely on `system.theme.global` favicon path alone.** The Neonbyte base theme (and potentially other themes) sets `features.favicon: false` in its config, which prevents Drupal's system module from rendering the `<link rel="shortcut icon">` tag. Setting `favicon.path` in `system.theme.global` has **no effect** when this feature is disabled. The `hook_page_attachments_alter()` approach bypasses this and works regardless of base theme settings.
5. **Register brand fonts**: If custom Google Fonts are specified, add them to the theme's `.libraries.yml` and reference in `css/base.css`:
   ```css
   @import url('https://fonts.googleapis.com/css2?family=[FontName]:wght@400;600;700&display=swap');
   :root { --font-heading: '[FontName]', sans-serif; }
   ```
6. **Generate and place the OG image**: The `og:image` is the 1200×630 image shown when the site URL is shared on LinkedIn, Slack, iMessage, Twitter/X, and Facebook. If the client does not supply the file, generate it using the AI `generate_image` tool — prompt it with the brand colors, wordmark, tagline, and domain:

   > **Sample prompt**: "Professional Open Graph image 1200×630px for [Site Name]. Navy background (#[primary-hex]) with subtle geometric pattern. Bold white wordmark '[Site Name]' on the left. Amber accent line (#[secondary-hex]) below it. Smaller white text: '[tagline]'. Amber geometric motif on the right. Bottom-left: '[domain]' in muted gray. Flat design, no photography."

   Place the file at:
   ```
   web/themes/custom/[theme_machine_name]/assets/og-image.png
   ```

   Then install and configure `metatag` to serve it:
   ```bash
   # Install metatag and required submodules:
   [runtime_wrapper] composer require drupal/metatag
   [runtime_wrapper] drush pm:enable metatag metatag_open_graph metatag_twitter_cards --yes
   [runtime_wrapper] drush cr
   ```

   Configure global defaults via a temporary PHP script in the project root:
   ```php
   <?php
   $og_image = '[site:url]themes/custom/[theme_machine_name]/assets/og-image.png';
   $desc     = '[one-sentence site description]';
   $global = \Drupal::configFactory()->getEditable('metatag.metatag_defaults.global');
   $global->set('tags', [
     'title'                     => '[current-page:title] | [site:name]',
     'description'               => $desc,
     'og_title'                  => '[current-page:title] | [site:name]',
     'og_description'            => $desc,
     'og_type'                   => 'website',
     'og_site_name'              => '[site:name]',
     'og_url'                    => '[current-page:url:absolute]',
     'og_image'                  => $og_image,
     'og_image_width'            => '1200',
     'og_image_height'           => '630',
     'twitter_cards_type'        => 'summary_large_image',
     'twitter_cards_title'       => '[current-page:title] | [site:name]',
     'twitter_cards_description' => $desc,
     'twitter_cards_image'       => $og_image,
   ])->save();
   echo 'Done.' . PHP_EOL;
   ```

   > [!WARNING]
   > Use `[site:url]themes/...` (no leading `/` after the token). The `[site:url]` token resolves **with** a trailing slash — if you write `/themes/...` you get a double-slash in the rendered URL (`https://example.com//themes/...`), which will fail the OG image validator.
   >
   > Enable `metatag_open_graph` and `metatag_twitter_cards` submodules explicitly. The base `metatag` module alone does **not** render `og:` or `twitter:` tags.

   Export and commit:
   ```bash
   [runtime_wrapper] drush config:export --yes
   git add config/sync/ web/themes/custom/[theme_machine_name]/assets/og-image.png
   git commit -m "feat: OG image + metatag global defaults"
   ```
7. **Set social profile URLs**: Store these in the theme settings if the base theme provides social link fields, or note them for Twig injection in the footer template (Phase 9/11).

### 2.3 Verification

Run both checks before advancing. These are curl-only — no browser required:

```bash
# 1. Confirm CSS custom properties are in the page:
curl -sk https://[site-url]/ | grep -o 'theme-setting-base-primary-color:[^;]*'
# Expected: --theme-setting-base-primary-color: #[your-primary-hex]

# 2. Confirm logo URL in rendered HTML:
curl -sk https://[site-url]/ | grep -o 'src="[^"]*logo[^"]*"'
# Expected: src="/themes/custom/[theme]/logo.svg?v=1"

# 3. Confirm logo file on disk is correct:
curl -sk https://[site-url]/themes/custom/[theme]/logo.svg | head -1
# Must start with <svg … aria-label="[Site Name]"

# 4. MANDATORY: Confirm favicon <link> tag is in the HTML <head>:
curl -sk https://[site-url]/ | grep -i 'rel="icon"'
# Expected: <link rel="icon" type="image/svg+xml" href="/themes/custom/[theme]/favicon.svg">
# Empty output = favicon is NOT wired. Do not advance until this returns a match.

# 5. MANDATORY: Confirm OG and Twitter tags in <head>:
curl -sk https://[site-url]/ | grep -i 'og:title\|og:image\|twitter:card'
# Expected: three matching lines — og:title, og:image, and twitter:card each present.
# Empty output = metatag not configured or submodules not enabled. Do not advance.

# 6. Confirm og:image URL resolves (no double-slash, no 404):
curl -sk -o /dev/null -w '%{http_code}' https://[site-url]/themes/custom/[theme]/assets/og-image.png
# Must return 200. 404 = file not placed in assets/. 301 = URL has double-slash — fix token.
```

> [!CAUTION]
> **Do not skip this verification.** If `theme-setting-base-primary-color` returns the parent default (e.g., `#0000d9` for NeonByte), the theme-specific config write did not persist. Re-run the `drush php-eval` block, then `drush cr`, and re-check.

> [!IMPORTANT]
> **Hero CTA contrast guard**: If the primary brand color is dark (e.g., navy `#1B2638`), Canvas hero/title-cta components with `button_style: primary` will be nearly invisible on dark hero backgrounds. Set `button_style: secondary` for any CTA placed on a dark section. Verify with a screenshot before exiting Phase 2.

### 2.4 Approval Checkpoint

Display the resolved asset list to the user (confirmed hex values, logo path, favicon path) and ask: *"Brand assets confirmed — shall I proceed to Phase 3?"* Do NOT advance until the user approves.

### 2.5 Optional: AI Context Integration (`drupal/ai` ≥ 1.2.0)

If `drupal/ai` is installed on this project, the brand identity collected in Phase 2 can be stored as machine-readable **AI Context** entities. These are injected automatically into Canvas AI agent prompts, ensuring AI-generated content stays on-brand without repeating the brand brief in every session.

| Phase 2 Asset | AI Context field |
|---|---|
| Primary color + brightness | Design / color palette |
| Secondary / accent color | Design / accent |
| Brand fonts | Design / typography |
| Site name + tagline | Voice / brand name, tagline |
| Social profile URLs | Channels / social profiles |
| OG image | Design / og_image |

Create AI Context entities at `/admin/config/ai/ai-context` (UI) or via the AI Context config form after installing `drupal/ai`. Export with `drush config:export --yes` so they travel with `config/sync/` and are available to future agents without re-prompting.

> [!NOTE]
> The Drupal community's **Context Control Center** pattern makes AI Context the
> single source of truth for brand governance — once defined here, no agent
> session needs to re-brief the brand. If AI Context is not installed, the
> Phase 2 brand checklist in this SOP serves the same role as a document-level
> context source.

---

## Phase 3: Establish the Baseline Backup
Before altering any structural CSS or Layout builder templates, preserve the current customized primary theme.

1. **Clone**: Duplicate the primary stable directory (`web/themes/custom/[primary_theme]`) to a new working directory appending a date/timestamp (e.g., `web/themes/custom/[primary_theme]_20260411`).
2. **Refactor**: Perform a targeted find-and-replace to rename all machine names inside configuration files only. Scope this strictly to `.info.yml`, `.breakpoints.yml`, `.theme`, `.libraries.yml`, and `.yml` files. Do NOT run a broad replacement across all files — binary assets, images, and generic CSS class names must not be touched.
3. **Activate**: Enable the newly cloned layout theme and set it as the default theme via Drush, utilizing the runtime wrapper detected in Phase 1:

   ```bash
   [runtime_wrapper] drush theme:enable [primary_theme]_[timestamp]
   [runtime_wrapper] drush config:set system.theme default [primary_theme]_[timestamp] -y
   [runtime_wrapper] drush cr
   ```
4. **Result**: This preserves the original theme untouched. If the experimental implementations collapse the site layout, AIs can instantly revert the active system theme to the known-good configuration.
5. **Version Control Snapshot**: Add and commit only the cloned theme directory using its explicit path (e.g. `git add web/themes/custom/[primary_theme]_[timestamp] && git commit -m "chore: Branch new component testbed theme"`). Do NOT use `git add .` here — only stage the new theme directory to avoid accidentally committing unrelated working files.
6. **Canvas DB Snapshot**: Immediately after activating the new theme, take a snapshot of the Canvas component table. This is the rollback point if any assembly script puts the DB into a bad state:
   ```bash
   [runtime_wrapper] drush sql-dump --tables-list=canvas_page__components > docs/frameworks/drupal/theming/canvas_snapshot_pre_assembly.sql
   ```
   To restore: `[runtime_wrapper] drush sql-query --file=docs/frameworks/drupal/theming/canvas_snapshot_pre_assembly.sql`

   > [!IMPORTANT]
   > This snapshot file must NOT be committed to git — add it to `.gitignore`. It exists only as a local recovery tool.

---

## Phase 4: Screenshot Ingestion & Component Mapping
Once the user provides the target design:

1. **Asset Storage**: Immediately save the provided screenshot into a `/designs` or `/reference` directory inside the newly created active theme (e.g., `web/themes/custom/[primary_theme]_[timestamp]/designs/screenshot.png`). This ensures the AI context and layout references are permanently shipped alongside the theme files.
2. **Legacy Architecture Audit** *(mandatory if the user confirmed an existing site in Phase 1 — do not skip)*: Before making any assumptions about content types, block regions, menus, or page templates, you must audit the existing site. Skipping this step when a legacy site exists will cause structural mismatches in templates and sidebar wiring.

   - Target the local legacy codebase path recorded in Phase 1 (e.g., `~/Sites/pl-performantlabs.com`). **First, independently detect its runtime wrapper** (scan for `.ddev/`, `.lando.yml`, etc.) — it may differ from the primary project detected in Phase 1.
   - Audit all of the following via Drush introspection and structural analysis:
     - **Content types** and their field structures (which types serve as documentation, landing pages, articles, etc.)
     - **Menu structure** (primary nav, footer nav, any sidebar/TOC navigation menus)
     - **Block regions and placements** (which blocks go in which regions)
     - **Taxonomy vocabularies** (how content is organised and categorised)
     - **Active modules** that affect layout or routing (Views, Layout Builder, Paragraphs, etc.)
   - Draft this architectural dissection into an explicit Markdown file and save it within an `/audits` directory inside the new active theme (e.g., `web/themes/custom/[primary_theme]_[timestamp]/audits/legacy_dissection.md`).
   - The dissection output directly informs: template suggestion hooks, sidebar menu block choices, region wiring, and any additional content types to replicate.
3. **Visual Decomposition**: Analyze the screenshot to break down the UI into logical horizontal bands (e.g., Hero Banners, Feature Grids, Logo Arrays, Call-to-Action blocks).
4. **Component Cross-referencing**: Check these visual bands against your base theme's component library (identified via the documentation folder provided by the user) to identify completely reusable Twig structures and native CSS modifier classes.
5. **Gap Analysis**: Identify any bespoke elements in the screenshot that do not have a native equivalent in the base theme. These will require entirely custom CSS implementations.
6. **Implementation Plan Generation**: Synthesize your structural component findings and draft your `theme_component_mapping_plan.md` strategy directly into the specific theme documentation folder that the user provided natively at run-time (e.g., `drupal/dripyard_themes/`).
7. **Version Control Snapshot**: Immediately commit the raw target assets, the legacy audit (if generated), and your drafted component plan using explicit paths (e.g., `git add web/themes/custom/[primary_theme]_[timestamp]/designs web/themes/custom/[primary_theme]_[timestamp]/audits drupal/[theme_docs_namespace]/theme_component_mapping_plan.md && git commit -m "docs: Scaffold layout target assets and implementation mapping"`). Do NOT use `git add .` here.
8. **Component Cookbook** *(gate — must be complete before Approval Checkpoint)*: Before requesting user sign-off, build a lookup table of every component you plan to use in Phase 9 assembly. For each component, read its `.component.yml` and record:
   - The exact `component_id` string (e.g. `sdc.dripyard_base.flex-wrapper`)
   - Every **required** prop name with its valid enum values, copied verbatim from the schema
   - Every **slot** name, copied verbatim from the schema

   Save this table to `docs/frameworks/drupal/theming/component-cookbook.md`. It becomes the authoritative prop reference for every Phase 9 assembly script — no prop name may be written from memory during assembly.

   > [!CAUTION]
   > Do not guess prop names. A wrong prop name causes a silent drop or a `RuntimeError` on save. The cookbook prevents the "fix the fix" cycle.
   >
   > **Reference document**: [`docs/frameworks/drupal/theming/component-cookbook.md`](component-cookbook.md) — read this file in full at the start of Phase 9 before writing a single assembly script. It contains verbatim prop/slot names and a "Common Mistakes" table of props that have caused silent failures in past sessions.

9. **Approval Checkpoint**: With the plan and cookbook safely tracked in version control, you must explicitly STOP execution. Display your mapped strategy to the user and wait for their explicit manual approval before advancing into Phase 5 layout executions.

---

## Phase 5: Page Template Architecture
Before writing any component markup or CSS, define the page shells that those components will inhabit. This prevents building components that have no route to render into.

1. **Inventory page types in scope**: Determine all page structures the theme must support (e.g., full-width Canvas marketing page, documentation interior page with sidebar, standard utility page). Do not assume a single template covers the site.
2. **Identify the Canvas homepage node**: Confirm which node (or path) is the site front page. Do not create a new node if one already exists — verify via `system.site` configuration.
3. **Author the full-width Canvas page template**: Create `page--front.html.twig` (or `page--node--[nid].html.twig` if a specific node is the target) inside `web/themes/custom/[primary_theme]_[timestamp]/templates/layout/`. This template must:
   - Suppress the page title block (`page.page_title` or the `page-title.html.twig` region)
   - Remove any sidebar or constrained-width wrappers
   - Render `{{ page.content }}` edge-to-edge so Canvas blocks fill the full viewport width
   - Include the header and footer via the base theme's standard embeds
4. **Author the interior documentation page template**: Create a sidebar variant (e.g., `page--documentation.html.twig` or use a Layout Builder layout) that provides:
   - A persistent left sidebar region wired to a block region (e.g., `sidebar_first`) for the documentation index/TOC menu
   - A main content region for the body
   - Standard header and footer
   - Consider using a CSS Grid or Flexbox two-column layout scoped to this template; add the CSS to `css/base.css` under a page-level body class
5. **Wire up block regions**: Ensure the `[primary_theme]_[timestamp].info.yml` declares any new regions (e.g., `sidebar_first: Sidebar first`) required by the new templates. Verify the theme's `config/optional/` block placements cover these regions.
6. **Version Control Snapshot**: Commit all new template files and any `info.yml` region additions using explicit paths before advancing:
   ```bash
   git add web/themes/custom/[primary_theme]_[timestamp]/templates \
           web/themes/custom/[primary_theme]_[timestamp]/[primary_theme]_[timestamp].info.yml
   git commit -m "feat: scaffold page template variants (Canvas full-width + docs sidebar)"
   ```
7. **Structural Verification Gate** *(all checks must pass before proceeding)*:

   | Check | Command | Pass condition |
   |---|---|---|
   | Theme is active | `[runtime_wrapper] drush php-eval "echo \Drupal::config('system.theme')->get('default');"` | prints custom theme machine name (e.g. `performant_labs_20260411`) |
   | No PHP/Twig errors | `[runtime_wrapper] drush watchdog:show --count=20 --severity=3` | 0 new errors after `drush cr` — see watchdog interpretation note in `canvas-scripting-protocol.md` |
   | Front page returns 200 | `curl -k -o /dev/null -s -w "%{http_code}" [site-url]/` | `200` |
   | Front page template fires | `curl -sk [site-url]/ \| grep [unique-class-in-page--front.html.twig]` | match found |
   | Declared regions present | `curl -sk [site-url]/ \| grep -E "region-(header\|content\|footer)"` | all three match |

   **Fail path**: fix the specific template or region → re-run the gate → do not advance until all checks are green.

8. **Approval Checkpoint**: Confirm with the user that all required page structures are covered before proceeding to Phase 6.

---

## Phase 6: Structure Verification

Run the curl-based structural checks from Phase 5 first (HTTP 200, DOM grep for regions). Then open the live site in a browser subagent for the single visual rendering confirmation — no design reference comparison yet, CSS is not finished. Confirm:

| Check | Pass condition |
|---|---|
| Custom theme active | Not the parent theme or Bartik |
| HTTP 200 | No 500/403 on front page |
| No Twig/PHP errors | `drush watchdog:show --count=10 --severity=3` → 0 new errors |
| Header & footer regions in DOM | Both present in page source |
| No horizontal overflow | 1728 px viewport, no x-scrollbar |

**Pass**: all five conditions true → proceed to Phase 7.
**Fail**: fix the template or region → re-run Phase 5 Structural Verification Gate → re-run this check before Phase 7.

---

## Phase 7: Implementation Execution
1. **Component Markup (Twig)**: For each mapped component in the approved strategy, author its structural markup as a Twig template (`.twig`) inside the relevant SDC bundle. Apply the proper `theme--[name]` CSS scoping wrappers inside the Twig output so each component inherits the theme's color palette overrides from `css/base.css` without hardcoding color values.
2. **Global CSS Overrides (Native Components)**: If the design dictates nuanced spacing or styling modifications for existing native components, append custom CSS explicitly targeting the Component Layer inside the new canvas theme's `css/base.css` file. Target component class selectors directly — apply overrides at the component class level, not at the CSS custom property declaration level.
3. **Integration Strategy (Bespoke SDCs Enforced)**: When generating custom layout elements that do not exist natively, output exclusively standard **Single Directory Components (SDCs)** in the active theme's `components/` directory — each gets a `.component.yml`, `.twig`, and `.css` bundle. Encapsulate all component styling in the component's own `.css` file. Implement Canvas content layout using SDC composition; use Layout Builder, Drupal Blocks, and root Twig templates for page shell structures only, not for custom Canvas content elements.
4. **AI Autonomous Content Population**: When structural components (like the "Product, Pricing, Blog" header navigation or dynamic card grids) require functional Drupal content to render, DO NOT manually construct UI configurations or write raw database queries.

   > [!WARNING]
   > **`drush scr -` (stdin pipe) does NOT accept `<?php` opening tags and will fail silently.** The heredoc-to-stdin pattern is unreliable. Instead, write a temporary `.php` file to the **project root** (never to `/tmp` or theme directories), execute it, then immediately delete it:
   > ```bash
   > cat > menus_populate.php << 'EOF'
   > <?php
   > // Drupal bootstrap is automatic via drush scr
   > use Drupal\menu_link_content\Entity\MenuLinkContent;
   > MenuLinkContent::create([...]) ->save();
   > EOF
   > [runtime_wrapper] drush scr menus_populate.php && rm menus_populate.php
   > ```
   > Writing to the project root keeps the file within the DDEV-mounted volume. Delete immediately after execution — never commit these scripts.
5. **Version Control Snapshot**: Commit the newly generated SDC bundles and CSS wrappers before handing off to the verification stage (e.g. `git commit -m "feat: Implement Canvas SDC component suite"`).

---

## Phase 8: Design Fidelity Verification

First comparison against the design reference. Run one browser subagent per slice — header and hero only (two calls — sufficient to confirm token application). See `visual-regression-strategy.md §Design Fidelity Verification`.

| Check | Pass condition |
|---|---|
| Primary hex | Matches brand spec exactly (browser inspector) |
| Accent hex | Matches brand spec exactly |
| Fonts loading | Custom fonts rendering, not browser system fallbacks |
| Gross proportions | Section heights/widths roughly match design reference |
| No unstyled elements | No raw browser-default HTML visible |
| **Favicon in HTML head** | `curl -sk [site-url]/ \| grep -i 'rel="icon"'` returns a match |
| **Page title set** | `curl -sk [site-url]/ \| grep '<title>'` shows site name, not "Drupal" |

**Pass**: all seven confirmed → proceed to Phase 9.
**Fail**: fix CSS token, font loading, or missing head metadata → `drush cr` → re-run this check before Phase 9.

---

## Phase 9: Canvas Page Programmatic Assembly

> [!IMPORTANT]
> **Mandatory pre-reading before writing any script in this phase:**
> 1. [`docs/frameworks/drupal/theming/component-cookbook.md`](component-cookbook.md) — authoritative prop/slot names for every component. Never write an `inputs` JSON from memory.
> 2. [`docs/frameworks/drupal/theming/canvas-scripting-protocol.md`](canvas-scripting-protocol.md) — mandatory pre-flight checklist (schema check, template read, module availability, asset reachability, DB state, logo path, placeholder content scrub), script writing rules, and verification cadence.
>
> Both documents must be read **in full** before the first `drush scr` is written. Skipping either document is the single most common cause of multi-session fix loops.

The Canvas module stores home pages as `canvas_page` entities — **not** standard nodes. They cannot be created with `node_create`. All structural page content must be wired via the `canvas_page`'s `components` field.

### 9.1 Locating the Canvas home page

```bash
# Confirm the site front page route:
[runtime_wrapper] drush config:get system.site page.front
# output: /page/1  →  canvas_page entity ID 1. Edit at /page/[id]/edit
```

> [!IMPORTANT]
> Do NOT assume the front page is a node. `system.site page.front` may return `/page/[id]` (Canvas), not `/node/[nid]`.

### 9.2 Canvas component tree structure

The `components` field is a **flat array**. Nesting is expressed by `parent_uuid` references — not by PHP array nesting. Every component item requires these keys:

| Key | Notes |
|---|---|
| `component_id` | Full SDC ID e.g. `sdc.dripyard_base.section` |
| `component_version` | Set to `NULL` — Canvas auto-resolves on `preSave()`. Never hard-code a hash. |
| `uuid` | Must be unique. Use `Uuid::generate()` or a deterministic `md5(seed)` formatted as UUID. |
| `parent_uuid` | `NULL` for root items. Must exactly match the parent's `uuid`. |
| `slot` | `NULL` for root. Must match a named slot in the parent's `.component.yml`. |
| `inputs` | JSON array. **Must exactly match the component's schema props.** |
| `label` | `NULL` is safe. |
| `weight` | Integer position relative to siblings. |

### 9.3 SDC schema validation rules

> [!CAUTION]
> Canvas validates every `inputs` array against the component's `.component.yml` schema on save. Any violation silently drops the component or throws a `RuntimeError` during rendering. Always cross-reference the actual `.component.yml` file before setting props.

Known schema gotchas from `dripyard_base`:

| Component | Common mistake | Correct prop |
|---|---|---|
| `heading` | Key named `heading` | Use `text` for the heading string |
| `heading` | `margin_top: 0` (integer) | Must be an enum string e.g. `"none"`, `"sm"`, `"md"`, `"lg"` |
| `canvas-image` | Omitting `loading` | `loading` is **required**: `"eager"` or `"lazy"`. Null throws a `RuntimeError` from `image-or-media`. |
| `icon-list-item` | Using `text` for the label | Use `title` |

> [!TIP]
> If a `canvas-image` has no real image source yet, **replace it with `sdc.[theme].text`** as a placeholder. The `text` component has no required props that cause rendering failures.

<examples>
<example id="heading-inputs-correct">
// CORRECT — 'text' key; margin_top is an enum string:
'inputs' => json_encode(['text' => 'Our Services', 'margin_top' => 'none', 'heading_level' => 'h2'])
</example>
<example id="heading-inputs-wrong">
// WRONG — 'heading' key and integer margin_top cause a silent component drop:
'inputs' => json_encode(['heading' => 'Our Services', 'margin_top' => 0])
</example>
<example id="canvas-image-correct">
// CORRECT — 'loading' is required; omitting it throws a RuntimeError:
'inputs' => json_encode(['image' => [...], 'loading' => 'lazy'])
</example>
<example id="canvas-image-wrong">
// WRONG — missing 'loading' causes RuntimeError from image-or-media:
'inputs' => json_encode(['image' => [...]])
</example>
<example id="entity-id-correct">
// CORRECT — resolve IDs dynamically; works in all environments:
$nodes = \Drupal::entityTypeManager()->getStorage('node')
  ->loadByProperties(['title' => 'Services', 'type' => 'page']);
$node = reset($nodes); $nid = $node->id();
</example>
<example id="entity-id-wrong">
// WRONG — hard-coded ID breaks in staging/production:
$nid = 42;
</example>
</examples>

### 9.4 Diagnosing Canvas rendering errors

```bash
# Check watchdog for RuntimeError entries:
[runtime_wrapper] drush watchdog:show --count=10 --severity=3

# Inspect the raw stored component by UUID:
[runtime_wrapper] drush sql-query "SELECT components_component_id, components_component_version, \
  components_inputs FROM canvas_page__components WHERE components_uuid='[uuid]';"

# If DB data is correct but error persists — flush render cache at DB level:
[runtime_wrapper] drush sql-query "TRUNCATE TABLE cache_render; TRUNCATE TABLE cache_menu;"
[runtime_wrapper] drush cr
```

> [!NOTE]
> A `RuntimeError` referencing a UUID whose DB data is correct usually means a **stale render cache** — not bad data. Always truncate `cache_render` before concluding the stored data is wrong.

### 9.5 Canvas assembly cadence

Assemble the Canvas page one visual section at a time, in top-to-bottom order matching the design. Each section is one script, one verification, one commit.

```
[Section name]  →  write script  →  per-section gate  →  commit  →  next section
```

**Rules:**
- One script covers exactly one visual section (hero, features, carousel, tabbed section, etc.). Never combine unrelated mutations in a single script.
- Every script ends with a DB verification query before clearing cache:
  ```php
  // At the end of every assembly script, before cache clear:
  $rows = \Drupal::database()->select('canvas_page__components', 'c')
    ->fields('c', ['components_uuid', 'components_component_id', 'components_inputs'])
    ->condition('c.components_uuid', $uuid_you_just_wrote)
    ->execute()->fetchAll();
  print_r($rows); // Must return exactly one row with correct data
  ```
- Commit after each verified section: `git commit -m "feat(canvas): assemble [section name] section"`
- If a script fails, restore from the Phase 3 Canvas DB snapshot rather than writing a second fix script on top of an uncertain state.

### 9.6 Per-section structural gate *(run after every assembly script)*

Before committing a section and moving to the next, two checks must pass:

```bash
# 1. UUID exists in DB (replace [uuid] with the root component UUID you just wrote):
[runtime_wrapper] drush sql-query \
  "SELECT components_uuid, components_component_id FROM canvas_page__components \
   WHERE entity_id=1 AND components_uuid='[uuid]';"
# Must return exactly 1 row.

# 2. Section renders in the DOM:
curl -sk [site-url]/ | grep -i "[unique class or landmark text from this section]"
# Must return a match.
```

**Fail path**: do not write a second fix script on top of uncertain state. Restore from the Phase 3 Canvas DB snapshot, identify the root cause against the pre-flight checklist in `canvas-scripting-protocol.md`, and re-run the section script.

### 9.7 End-of-phase full tree audit *(run once after all sections assembled)*

```bash
# Count total components — must match your cookbook's expected total:
[runtime_wrapper] drush sql-query \
  "SELECT COUNT(*) FROM canvas_page__components WHERE entity_id=1 AND deleted=0;"

# Check for orphaned components:
[runtime_wrapper] drush php-eval "
\$rows = \Drupal::database()->select('canvas_page__components','c')
  ->fields('c',['components_uuid','components_parent_uuid','components_component_id'])
  ->condition('entity_id',1)->condition('deleted',0)->execute()->fetchAll();
\$uuids = array_column(\$rows,'components_uuid');
foreach (\$rows as \$r) {
  if (\$r->components_parent_uuid && !in_array(\$r->components_parent_uuid,\$uuids)) {
    echo 'ORPHAN: '.\$r->components_uuid.' parent='.\$r->components_parent_uuid.PHP_EOL;
  }
}
echo 'Done.'.PHP_EOL;
"
# Must return 'Done.' with zero ORPHAN lines.
```

**Pass**: all sections verified, no orphans → commit the full assembly snapshot → proceed to Phase 10.
**Fail**: fix the specific orphan or missing component → re-run §9.7 before proceeding.

---

## Phase 10: Canvas Assembly Verification

This is the primary visual regression pass for the project. Run the full panel-by-panel protocol from [`visual-regression-strategy.md`](visual-regression-strategy.md). All nine slices must be compared against the live site before Phase 11 begins.

**Scope**: Every Canvas section — header/nav, hero, features, carousel, content engine, teams, graph, FAQ, footer.

**Pass conditions** (all must be true before Phase 11):
- All 9 design slices return ✅ Match or ⚠️ Minor Gap
- Zero ❌ Major Gap findings outstanding
- Canvas placeholder copy scan returns 0 matches (no Keytail/NeonByte/lorem ipsum)
- All orphan checks from §9.7 passed

**Fail path**: For each ❌ — fix the specific Canvas component → re-run only the affected design slice → commit → continue. Do not advance to Phase 11 until all slices are ✅ or ⚠️.

---

## Phase 11: Menu & Block Wiring (Programmatic)

Never use the Drupal admin UI to wire menus or place blocks. Use `drush scr` scripts for all wiring.

### 11.1 Menu population pattern


```php
<?php
use Drupal\menu_link_content\Entity\MenuLinkContent;

// Clear before repopulating to avoid duplicates:
$old = \Drupal::entityTypeManager()->getStorage('menu_link_content')
  ->loadByProperties(['menu_name' => 'main']);
foreach ($old as $item) { $item->delete(); }

MenuLinkContent::create([
  'title'     => 'Services',
  'link'      => ['uri' => 'internal:/services'],
  'menu_name' => 'main',
  'weight'    => 0,
  'expanded'  => FALSE,
])->save();

\Drupal::service('plugin.manager.menu.link')->rebuild();
```

> [!WARNING]
> **Menu links to inaccessible routes are silently hidden for anonymous users.** If a menu item disappears, check the target node's publication state. If content moderation is active, `$node->set('status', 1)->save()` alone does NOT publish a node — you must set `$node->set('moderation_state', 'published')->save()`. Verify with: `drush php-eval "\$n = \Drupal::entityTypeManager()->getStorage('node')->load([nid]); echo \$n->moderation_state->value;"`

### 11.2 Block placement pattern

```php
<?php
use Drupal\block\Entity\Block;

Block::create([
  'id'       => '[theme_machine_name]_book_navigation',
  'theme'    => '[theme_machine_name]',
  'region'   => 'sidebar_first',
  'plugin'   => 'book_navigation',
  'weight'   => 0,
  'status'   => TRUE,
  'settings' => ['id' => 'book_navigation', 'label_display' => '0',
                 'block_mode' => 'book pages', 'provider' => 'book'],
  'visibility' => [
    'node_type' => [
      'id'      => 'entity_bundle:node',
      'bundles' => ['book' => 'book'],
      'negate'  => FALSE,
      'context_mapping' => ['node' => '@node.node_route_context:node'],
    ],
  ],
])->save();
```

### 11.3 Config sync directory

DDEV defaults `config_sync_directory` to `sites/default/files/sync` (gitignored) unless overridden. To track config in the project root's `config/sync` directory, add this to `settings.php` **before** the DDEV include block:

```php
// Point config sync to the tracked directory at the project root.
// Must appear BEFORE the IS_DDEV_PROJECT include so DDEV's fallback is skipped.
$settings['config_sync_directory'] = '../config/sync';
```

Then export: `[runtime_wrapper] drush config:export --yes`

> [!NOTE]
> `settings.php` is gitignored (contains secrets). This setting must be added on each environment or via a post-provision hook. It does not get committed.

### 11.4 Structural Verification Gate *(all checks must pass before proceeding to Phase 13 Content Migration)*

| Check | Command | Pass condition |
|---|---|---|
| Main nav has items | `[runtime_wrapper] drush php-eval "print_r(\Drupal::entityTypeManager()->getStorage('menu_link_content')->loadByProperties(['menu_name'=>'main']));"` | ≥ 1 item returned |
| Footer nav has items | same, swap `'main'` for footer menu machine name | ≥ 1 item returned |
| Expected blocks in regions | `[runtime_wrapper] drush php-eval "\$blocks=\Drupal::entityTypeManager()->getStorage('block')->loadByProperties(['theme'=>'[theme_machine_name]']); foreach(\$blocks as \$b){echo \$b->id().': '.\$b->getRegion().PHP_EOL;}"` | all expected blocks show a region ≠ `none` |
| Anonymous front page | `curl -k -o /dev/null -s -w "%{http_code}" [site-url]/` | `200` (not `403` or `302`) |
| Nav items visible to anon | `curl -sk [site-url]/ \| grep -i "[first nav item text]"` | match found |
| No new errors | `[runtime_wrapper] drush watchdog:show --count=10 --severity=3` | 0 new errors |

**Fail path**: fix the specific wiring issue → re-run only the failed check → commit → proceed to Phase 12.

---

## Phase 12: Navigation Verification

Run text-presence checks first with `curl -sk [site-url]/ | grep -i "[nav-label]"` for each expected label. Then open the live site in a browser subagent to confirm visual rendering and link resolution. One subagent call.

| Check | Pass condition |
|---|---|
| Header nav labels | Match `menu_link_content` list exactly (correct text, correct order) |
| Header nav links | Each resolves to the correct route (not 404) |
| Footer nav labels and links | Match the footer menu |
| Sidebar/book nav | Visible on a book page if sidebar region is wired |
| No broken nav items | No empty `<li>` or `href="#"` placeholders |

**Pass**: all nav checks green → commit → proceed to Phase 13.
**Fail**: fix menu wiring or block placement → re-run §11.4 structural gate → re-run this check before Phase 13.

---

## Phase 13: Content Migration

> [!IMPORTANT]
> **Mandatory pre-reading**: Read [`docs/frameworks/drupal/theming/content-migration-cookbook.md`](content-migration-cookbook.md) in full before writing any script or running any Drush command in this phase. It contains all inventory commands, migration patterns, dependency ordering, the form framework assessment, and the verification gate.

1. **DDEV multi-project**: Start the source site alongside the target — `cd [source-path] && ddev start`. Both run simultaneously; the shared `ddev-router` handles both by subdomain. No conflict expected.
2. **§-1 Module Audit first** (cookbook §-1): Compare enabled modules between source and target. Install any modules the migrated content depends on **before** touching config or content. Webform, Redirect, and GA4 are common gaps between legacy sites and fresh DCMS installs.
3. **Run inventory** (cookbook §-1 → §0 → §8 inventory commands): Execute against the source site. Present each category as a structured table — one category at a time. Do not dump all categories simultaneously.
4. **User selection gate**: For each category, the user assigns a disposition to every item (bring as-is / modify / placeholder stub / skip). **Do NOT proceed to migration until all categories have explicit dispositions.**
5. **Execute migration in dependency order** (cookbook §-1 → §0 → §1 → §2 → §3 → §4 → §5 → §6 → §7 → §8). One category per script. Verify each category before moving to the next. Commit after each verified category.
6. **Verification gate** (cookbook §Verification): Run node counts, alias spot-checks, media counts, image style audit, and Canvas placeholder scan. Must pass before Phase 14.

> [!CAUTION]
> **`block_content` broken-install risk**: On DCMS 2.0, a `config:import --partial` that touches `core.extension` can register `block_content` as enabled without running its install hook (no tables created). The site then crashes on any full bootstrap. **Prevention**: enable `block_content` via `drush pm:enable` before running any config import. **Resolution**: see cookbook §7 caution block.

> [!CAUTION]
> **Content Moderation overrides `status => 1`**: On DCMS 2.0 with Content Moderation active, `Node::create(['status' => 1])` creates a draft node (unpublished). You must also set `'moderation_state' => 'published'` in the create array, or call `$node->set('moderation_state', 'published')->save()` after creation.

---

## Phase 14: Content Rendering Verification

Open each migrated content type in a browser subagent and confirm it renders without structural breakage. One subagent call, four URLs.

| Content type | URL | Must show |
|---|---|---|
| Basic Page | `/services` | Body copy, correct layout, no unstyled content |
| Article | `/articles/[any-slug]` | Body, tags, created date, featured image if applicable |
| Book page | any book path | Body + sidebar nav block visible and linked |
| Contact page | `/contact-us` | Webform with all 5 fields (Name, Email, Company, Phone, Message) |

**Pass**: all four render correctly → proceed to Phase 15.
**Fail**: fix the content type template or field rendering → re-run the affected URL → commit before Phase 15.

---

## Phase 15: Content Audit


By the time Phase 15 begins, five VR gates have already fired (Phases 6, 8, 10, 12, 14).
This is the final content correctness check before the acceptance screenshot pass.

**Phase 16 must not begin until Phase 15 passes.**

### Audit procedure

Scan every Canvas text-bearing component for placeholder copy before any screenshot is taken. Base themes (NeonByte, Keytail, Dripyard) ship demo content that is structurally invisible — it passes layout checks but contains the wrong words.

```bash
# Scan all Canvas inputs for known placeholder phrases:
[runtime_wrapper] drush sql-query \
  "SELECT delta, components_component_id, components_inputs \
   FROM canvas_page__components WHERE entity_id=1 ORDER BY delta;" \
  | grep -iE "keytail|neonbyte|SDRs hit|Get found|lorem ipsum|Search and outreach"
# Must return 0 matches.

# Verify hero h1 contains approved client copy:
curl -sk [site-url]/ | grep -i "[approved hero headline]"
# Must return a match.

# Verify nav labels match approved content:
curl -sk [site-url]/ | grep -iE "[nav-label-1]|[nav-label-2]"
```

**Pass**: 0 placeholder matches, all approved copy present → proceed to Phase 16.
**Fail**: update via the keyed-replacement pattern in `canvas-scripting-protocol.md` → re-run the scan → do not open a browser until this gate is green.

> [!CAUTION]
> A Phase 16 finding should **never** be "wrong text." If it is, Phase 15 was not run correctly.

---

## Phase 16: Final Acceptance Verification

This is the final holistic sign-off, not the primary VR pass (that was Phase 10).
Scope is narrower: confirm no regressions were introduced during Phases 11–14, and
that the complete site with real content still matches the design reference.

> [!IMPORTANT]
> **Do not attempt visual regression in a single subagent call.** Follow the
> panel-by-panel protocol in:
> **[`docs/frameworks/drupal/theming/visual-regression-strategy.md`](visual-regression-strategy.md)**
>
> Key rules:
> - One subagent call = one design slice vs. one live viewport.
> - Use pre-sliced assets in `designs/` (`00_menu.webp` … `08_footer.webp`).
> - Log findings in a session-local `visual-regression-report.md` file (ephemeral — do not commit; delete after the acceptance pass is complete).
> - Evaluate layout, color, spacing, and typography **only** — content correctness was Phase 15.
> - For efficiency rules (curl-first, animation timing, batched screenshots), see [`operational-guidance.md`](operational-guidance.md).

**Expected outcome**: Fewer findings than Phase 10 because upstream gates caught structural issues. Any ⚠️ Minor Gap findings are scoped and scheduled; any ❌ Major Gap is fixed before go-live sign-off.

**Failure path**: Report the specific discrepancy → fix the isolated CSS/Canvas change → re-run only the affected slice → commit.

---

## Phase 17: Infrastructure & Head Hygiene Verification

Run this phase **before any production deployment**. Everything here is headless — pure `curl` and `drush`. No browser, no subagent, no screenshots.

> [!IMPORTANT]
> This phase is **not optional** before go-live. These checks are invisible to visual regression. A perfect Phase 16 VR pass does not confirm any of the items below.

### 17.1 HTML `<head>` checks

```bash
SITE="https://[site-url]"

# Title: must be "[Page] | [Site Name]" — not bare "Drupal" or empty
curl -sk $SITE/ | grep '<title>'
# Expected: <title>Home | Performant Labs</title>

# Favicon wired (confirm Phase 2 fix survived)
curl -sk $SITE/ | grep -i 'rel="icon"'
# Expected: <link rel="icon" type="image/svg+xml" href="...favicon.svg">
# EMPTY = broken. Fix via hook_page_attachments_alter in the custom theme.

# Generator meta — MUST BE ABSENT on production
curl -sk $SITE/ | grep 'name="Generator"'
# Expected: no output.
# If present: add Generator removal to hook_page_attachments_alter.
# Note: Neonbyte-based themes — target tag key 'system_meta_generator'.

# Canonical URL — note the path, confirm it is consistent and intentional
curl -sk $SITE/ | grep 'rel="canonical"'
# For Canvas front pages: canonical will be the path alias (e.g. /home), not /
# This is acceptable IF /home is accessible and consistent. If strict /
# canonicalization is required, install metatag and override canonical_url.
```

**Pass conditions:**

| Check | Pass |
|---|---|
| `<title>` | `[Page] \| [Site Name]` format |
| `rel="icon"` | Present |
| `name="Generator"` | **Absent** |
| `rel="canonical"` | Present and points to a real, accessible URL |

### 17.2 HTTP response headers

```bash
SITE="https://[site-url]"

# Page cache working — must be HIT on second request
curl -sI $SITE/ | grep -i 'x-drupal-cache'
# Expected: x-drupal-cache: HIT

# Security headers — both must be present
curl -sI $SITE/ | grep -iE 'x-frame-options|x-content-type-options'

# x-generator header — MUST BE ABSENT on production (CMS version disclosure)
curl -sI $SITE/ | grep -i 'x-generator'
# If present: suppress in nginx/Apache config on production server.
# Example nginx: more_clear_headers 'X-Generator';
# (requires headers_more module — this is a server config concern, not Drupal)
```

### 17.3 SEO baseline

```bash
SITE="https://[site-url]"

# robots.txt — must NOT block all crawlers
curl -sk $SITE/robots.txt | head -10
# Confirm "Disallow: /" is NOT the first/only rule.

# sitemap.xml — MUST return 200 before production deploy
curl -sk -o /dev/null -w '%{http_code}' $SITE/sitemap.xml
# 404 = go-live blocker. Install simple_sitemap:
#   ddev composer require drupal/simple_sitemap
#   ddev drush pm:enable simple_sitemap -y
#   ddev drush simple-sitemap:generate
```

### 17.4 Content & config hygiene

```bash
ddev drush php-eval "
\$site = \Drupal::config('system.site');
echo 'Site name: ' . \$site->get('name') . PHP_EOL;
echo 'Admin email: ' . \$site->get('mail') . PHP_EOL;
// Admin email must NOT be admin@example.com or any placeholder.
"
```

### 17.5 Architecture notes for common gaps

| Item | How to fix |
|---|---|
| Missing `<meta name="description">` | Install `metatag`; Canvas's `canvas_page` entity supports it natively once the module is present (field added automatically via `hook_entity_base_field_info`) |
| Missing OG tags (`og:title`, `og:image`, …) | Same — metatag handles these on canvas_page entities |
| Missing `apple-touch-icon` | Add to `hook_page_attachments_alter` alongside the favicon injection |
| Missing `Referrer-Policy` header | Add to nginx/Apache production server config (not Drupal) |
| Front-page canonical is `/home` not `/` | Acceptable if `/home` is a real, accessible URL. If strict canonicalization needed: metatag → `canonical_url` override on the canvas_page entity |
| `x-generator` header present | Suppress at nginx/Varnish level on production — Drupal itself cannot remove response headers |

### 17.6 Go-live blockers

The following MUST be clean before deploying to production:

- [ ] `/sitemap.xml` returns 200
- [ ] `<link rel="icon">` present in `<head>`
- [ ] `<title>` is not "Drupal" or empty
- [ ] Admin email is not a placeholder (`@example.com`)
- [ ] `name="Generator"` absent from HTML (information disclosure)

**Pass**: all six confirmed → proceed to production deploy.
**Fail**: fix the specific item → re-run the relevant curl check → commit.

### 17.7 Optional: Promote SOP Artifacts to Drupal Prompt Library (`drupal/ai` ≥ 1.2.0)

The `<non_negotiable_rules>` in Phase 0 and the component cookbook serve the same functional role as Drupal's **Prompt Library** — reusable, project-specific instructions injected into AI agent sessions. If `drupal/ai ≥ 1.2.0` is installed, promote these to first-class Drupal config entities so they survive outside this SOP document and are automatically available to any AI agent working on the site:

| SOP Artifact | Prompt Library entity (suggested ID) |
|---|---|
| Phase 0 `<non_negotiable_rules>` | `ai_prompt.general.site_build_rules` |
| `component-cookbook.md` | `ai_prompt.canvas.component_reference` |
| `canvas-scripting-protocol.md` | `ai_prompt.canvas.scripting_protocol` |
| Phase 17 go-live checklist | `ai_prompt.general.production_checklist` |

Manage Prompt Library entities at `/admin/config/ai/prompts`. Export after creation: `[runtime_wrapper] drush config:export --yes`.

> [!TIP]
> Shipping prompts as Drupal config is the community standard for AI-powered
> Drupal distributions. Prompt entities travel with `config/sync/`, survive
> theme rebuilds and environment rebuilds, and are available to Canvas AI
> agents without loading this SOP file as context.


---

## References

### AI & Prompt Engineering
- [Claude Prompting Best Practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices) — Anthropic's official reference for prompt engineering with Claude's latest models. Covers clarity, context, XML structuring, tool use, thinking/reasoning, agentic systems, and subagent orchestration. Consult this when authoring or refining AI instructions in any phase of this SOP.

### Drupal Core & Config
- [Configuration Management Workflow (Drush)](https://www.drupal.org/docs/administering-a-drupal-site/configuration-management/workflow-using-drush) — Authoritative guide for `config:import` / `config:export` workflows used throughout this SOP.

### Drupal AI Ecosystem
- [drupal/ai](https://www.drupal.org/project/ai) — The vendor-agnostic AI abstraction layer for Drupal. Connects to OpenAI, Anthropic (Claude), Google Gemini, AWS Bedrock, and self-hosted models (Ollama). Prerequisite for AI Context entities, Prompt Library, and Canvas AI.
- [drupal/canvas](https://www.drupal.org/project/canvas) — The Canvas page builder (stable 1.0, Nov 2025; default in Drupal CMS 2.0). The primary assembly surface targeted by Phases 9–10 of this SOP.
- [drupal/key](https://www.drupal.org/project/key) — Secure credential storage for API keys. Community non-negotiable: never store AI provider keys in config exports or `.env` files committed to git. Required when integrating `drupal/ai`.
- [drupal/eca](https://www.drupal.org/project/eca) — Event-Condition-Action module. The community's preferred no-code engine for AI-powered background workflows (auto alt text, content tagging, moderation triggers).
- [Dries Buytaert's blog](https://dri.es) — Primary strategic commentary on Drupal's AI direction, Canvas, MCP integration, and the "AI-native" roadmap from Drupal's founder and project lead.
- [Drupal AI Initiative](https://www.drupal.org/about/strategic-initiatives) — The official initiative coordinating AI module development, funding, and roadmap. Follow the `#ai` channel on Drupal Slack for real-time progress.
- [DrupalForge AI Demo](https://drupalforge.org) — No-install live sandbox for testing Drupal CMS AI features (Canvas AI, agent swarms, Prompt Library) without a local environment setup.

### DDEV
- [DDEV Documentation](https://docs.ddev.com/en/stable/) — Reference for all `ddev` commands, addon installation, and local environment configuration.
