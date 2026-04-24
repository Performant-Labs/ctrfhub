# Visual Regression Strategy

This document defines **how AI agents must execute Visual Regression (VR) gates** across any project. It is the tool-agnostic counterpart to [`verification-cookbook.md`](verification-cookbook.md), which covers the full Three-Tier Verification Hierarchy.

Scope:

- This doc is **about Tier 3 (Visual / Screenshot / Pixel) gates only** — when to run them, how to size them, how to interleave them with structural work, how to prevent them from crashing your agent runs.
- For Tier 1 (Headless / HTTP) and Tier 2 (ARIA / Structural) techniques, read [`verification-cookbook.md`](verification-cookbook.md).
- For concrete worked examples in specific stacks, see the stack-specific docs listed under [Stack-specific strategy docs](#stack-specific-strategy-docs) below.

> [!IMPORTANT]
> **Tier 3 never runs before Tier 2.** A Tier 2 ARIA structural audit must have passed for the relevant page before a screenshot is taken. Do NOT open a browser subagent or run a visual regression job until the structural skeleton is confirmed. Rationale: structural failures surface in the ARIA tree in under 10 s; the same failures in Tier 3 burn 60–90 s per attempt plus waste screenshots that have to be re-taken after the fix.

---

## Core Principle — VR is a phase gate, not an end-of-project step

You cannot build on top of problems you haven't caught. VR must be a **blocking gate** at the end of every meaningful structural unit of work:

- A UI story / PR that adds or changes a page
- A phase in a multi-phase build-out (e.g., structure → design → assembly → content)
- A release candidate
- A layout-token or design-token change that affects >1 surface

If VR is deferred to "the end," regressions compound silently. A structural break in step N that only gets found at step N+3 typically requires unwinding steps N+1 through N+3 to fix cleanly.

---

## The Pre-Condition Ladder

Before triggering any Tier 3 (visual) pass, this ladder must be green:

1. **Tier 1 Headless pass** — HTTP 2xx, expected DOM tags present, expected CSS variables resolved, no server-side errors in logs. 1–5 s.
2. **Tier 2 ARIA pass** — accessibility tree contains the expected landmarks, heading levels, labelled controls, and link targets. 5–10 s.
3. **Explicit request for visual verification** — either a design-reference comparison, a layout-token change, a colour/contrast concern, or a hover/animation behaviour that curl and ARIA cannot observe.

If item 3 is absent, **do not run Tier 3.** Structural correctness without a visual need is complete after Tier 2.

> [!IMPORTANT]
> **Backdrop / layout-token changes require a WCAG contrast re-check at Tier 2 before Tier 3.** Any change to a CSS custom property that alters background colour, overlay opacity, or text-on-image composition is a mandatory contrast audit — not a visual preference. Tier 2 can compute contrast from computed styles; Tier 3 is just confirmation.

---

## Budget Rules — why VR calls crash without them

Browser-subagent and Playwright screenshot passes are the most expensive, context-heavy operations in any agent workflow. They crash for one family of reasons: **too much to reason about in one call**. These rules prevent that.

### Rule 1 — One subagent call = one viewport vs. one reference

Never load the full-site composite design alongside six live viewport screenshots in a single call. Pre-slice the reference and the live page into matching chunks, and do one comparison per call.

### Rule 2 — Keep reference assets small

A 2000×9900 px full-page composite is a context-budget bomb. Accept only pre-sliced assets sized to a single viewport (typically ≤ 2000×1200 px). If the design is only available as a full composite, the first step is slicing, not comparing.

### Rule 3 — Write observations incrementally

Every check should flush its finding to a persistent file (log, report, or scratchpad) **before** the agent tries to produce its next screenshot or analysis. Accumulating everything in-memory and writing at the end is how agents lose their entire pass when they hit a context limit.

### Rule 4 — Curl first, browser last

Before launching any Tier 3 call, ask of each item you want to confirm: **can curl answer this?** Tier 1 Headless + Tier 2 ARIA cover:

| Question | Tier | Why not Tier 3 |
|---|---|---|
| Is the page loading? | 1 | HTTP status is a curl check, not a screenshot. |
| Is the expected copy on the page? | 1 | `curl … \| grep 'expected string'` verifies text in <1 s. |
| Is the heading structure correct? | 2 | ARIA tree exposes all H1–H6 levels. |
| Are all nav links non-404? | 1 | A status-code sweep is cheap; only hover/mobile menu needs a browser. |
| Is the palette applied? | 1 | `grep` for the CSS custom property value. |
| Does the layout render at the right breakpoint? | 3 | ✓ legitimate Tier 3 — layout is visual. |
| Does a hover state reveal the expected content? | 3 | ✓ legitimate Tier 3 — hover is visual. |
| Do images actually render (not 500 on derivative generation)? | 1 | Check each srcset URL for HTTP 200 + `image/*` content-type. |

### Rule 5 — Full-page screenshot ≠ visual regression

A single 9900 px full-page screenshot is not a regression check — it's a context-destroying data blob. Tier 3 means: a focused slice (hero, nav, section, component) compared against a matching reference or baseline. Full-page captures are acceptable as *artifacts* (stored for later human review) but not as *analysis inputs*.

---

## Gate Structure

A VR gate is a named, blocking checkpoint with four parts:

1. **Scope** — exactly which pages, components, or breakpoints this gate covers. Smaller = faster to recover when it fails.
2. **Pre-conditions** — which Tier 1 and Tier 2 checks must be green before this gate can start.
3. **Checks** — the specific visual claims being verified (e.g., "primary CTA has amber fill at #F59E0B ± tolerance", "hero section occupies >60% of the above-the-fold region at 1280×720").
4. **Pass / Fail action** — what happens on each outcome. "Fail" must trigger a fix → re-run of the relevant Tier 1/2 precondition → re-run of this gate. Never: patch and continue.

Typical gate cadence in a multi-phase build:

| Gate | When | Scope |
|---|---|---|
| Structure VR | After initial page scaffolding lands | Page renders, regions present, no unstyled elements |
| Design-fidelity VR | After design tokens and typography wire up | Header + hero slices only; brand colours, font loading |
| Assembly VR | After each panel / section is built | Panel-by-panel against the matching design slice |
| Navigation VR | After menus and links are wired | Header/footer nav, hover states, mobile menu |
| Content-rendering VR | After content is migrated / seeded | One viewport per content type |
| Final-acceptance VR | Release candidate | Narrow scope if upstream gates caught issues; broad scope if not |

This is a template. Adapt the names and count to your project's phase model. The discipline is: **every structural unit of work ends with a VR gate before the next one begins.**

---

## Anti-Patterns

These are the failure modes that keep repeating. Watch for them in your own runs and in PR reviews.

**"One mega-VR at the end."** Everything built green individually, then at the end a single VR call is supposed to validate the whole site. It crashes or returns vague impressions. Fix: gate each phase.

**"Screenshots first, then structural."** Agent opens the browser before curl/ARIA are run. Pays 60–90 s per iteration on a problem that would have shown up as a missing DOM node in 2 s. Fix: enforce the pre-condition ladder above.

**"Full-page reference asset."** A 10,000 px PNG reference passed into a call alongside screenshots. Context blows up. Fix: pre-slice references to viewport-sized chunks.

**"Analysis accumulating in the subagent scratchpad."** The agent takes 5 screenshots, compares all 5, then tries to write one big report. Crashes midway, loses everything. Fix: flush findings after each slice.

**"VR without a design reference."** Running Tier 3 to decide whether something "looks right" with no objective baseline. Produces subjective prose, not pass/fail. Fix: every Tier 3 gate compares against either (a) a prior baseline image, (b) a design-spec slice, or (c) a concrete numeric claim about computed styles / bounding boxes.

**"Patching and continuing past a failed gate."** Fixing the artifact the VR call produced (e.g., re-cropping) instead of fixing the underlying structural break. Fix: a failed gate reverts to the preceding Tier 2 check, which reverts to the preceding Tier 1 check — all the way down until you find the root cause.

---

## Minimum viable VR kit

You need three things in any stack:

1. **A browser that can take viewport and element-scoped screenshots** — Playwright, Puppeteer, or a built-in browser subagent. Must support custom viewport size and user-agent.
2. **A way to compare images** — either pixel-diff (resemble.js, pixelmatch) for strict regression, or LLM vision for loose-comparison against a design. Pixel-diff is faster and deterministic; LLM vision handles "does this look like the design?" questions that pixel-diff can't answer.
3. **A persistent store for screenshots and findings** — a directory in the repo or a run-artifact store. Screenshots without a diff history are just pictures.

Optional but recommended:

- A baseline-image convention (per page × breakpoint), stored alongside the code.
- A CI hook that runs VR on PRs that touch layout tokens or component markup.
- A running log of VR findings with dates and cause analyses (see `visual-regression-report.md` in stack-specific cookbooks for the pattern).

---

## Stack-specific strategy docs

These docs apply the general rules above to specific stacks. When you're working in one of these stacks, read both this doc and the stack-specific one.

| Stack | Document | Scope |
|---|---|---|
| Drupal (Canvas theme generation SOP) | [`../frameworks/drupal/theming/visual-regression-strategy.md`](../frameworks/drupal/theming/visual-regression-strategy.md) | Phase-gate numbering mapped to AI-Guided Theme Generation, ddev + drush execution, Canvas component assembly VR, `designs/` directory conventions |

(Add a row here for any project that ships its own VR strategy doc. If you're in CTRFHub, Node/Fastify/HTMX, or another stack and find yourself writing one: put it alongside the stack's other guidance under `frameworks/<stack>/` and link it here.)

---

## See also

- [`verification-cookbook.md`](verification-cookbook.md) — canonical Three-Tier Verification Hierarchy; Tier 1 and Tier 2 techniques.
- `../frameworks/drupal/theming/visual-regression-report.md` — running log template showing how VR findings are recorded per-run.
