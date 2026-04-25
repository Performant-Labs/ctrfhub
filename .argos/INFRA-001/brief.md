# Task Brief — INFRA-001: Project scaffold and toolchain

## Preconditions (verified by Argos)

- [x] Dependencies satisfied: none (this is the kickoff story)
- [x] No P0 gap blocks this story: G-P0-001 affects DASH-001 and later UI stories — not INFRA-001. G-P0-002 affects Eta-template stories — not INFRA-001. G-P0-003 affects SET-* stories — not INFRA-001. G-P0-004 is ✅ closed.
- [x] Branch cut: `story/INFRA-001` from `main` @ dd6c5b4
- [x] `tasks.md` flipped `[ ]` → `[/]` on the story branch (commit `chore(INFRA-001): assign`)

## Story

**Description.** Project scaffold and toolchain. No application code yet — this is the foundation everything else stands on.

**Acceptance criteria.** (verbatim from `docs/planning/tasks.md` §INFRA-001, broken into bullets for scannability)

- `npm install` succeeds against the new `package.json`
- `tsc --noEmit` passes on empty `src/`
- ESLint config in place; lint passes on the empty source
- `package.json` has all required scripts: `dev`, `build`, `test`, `test:unit`, `test:int`, `test:e2e`, `test:coverage`, `migrate:pg`, `migrate:sqlite`, `migrate:create:pg`, `migrate:create:sqlite`, `css:dev`, `css:build`
- `vitest.config.ts` exists with coverage thresholds **80% lines / 80% functions / 75% branches** (a floor, not a goal)
- `e2e/playwright.config.ts` exists with two-viewport matrix `[1280×800, 375×800]`
- Three MikroORM config files exist: `mikro-orm.config.ts` (base), `mikro-orm.config.pg.ts`, `mikro-orm.config.sqlite.ts`
- `src/client/htmx-events.ts` bootstrapped — empty constants module ready for HTMX event names to land in later stories

**Test tiers required.** unit (one test that proves the vitest config wires up correctly — trivial assertion + the coverage threshold is the real assertion: a deliberately low-coverage test should fail the gate)

**Page verification tiers.** none (no rendered routes yet — there is no app to verify)

**Critical test paths.**
- Coverage thresholds 80/80/75 are enforced by `vitest.config.ts` (verify by running `test:coverage` against the included unit test and confirming it hits the threshold; deliberately fail the gate with an empty test file to prove the floor is real)
- Both MikroORM dialect configs (`mikro-orm.config.pg.ts`, `mikro-orm.config.sqlite.ts`) load without error — try `tsx mikro-orm.config.pg.ts` and `tsx mikro-orm.config.sqlite.ts` (or equivalent import-then-print)
- `tsc --noEmit` passes against the empty `src/`

## Required reading

**Skills (full paths — read before any code).**

- `skills/mikroorm-dual-dialect.md` — Entities and migrations must work on both PG and SQLite. Portable `p.*` types only. Dialect switching via env var. Drives the three MikroORM config files. (No entities ship in this story; the configs just have to be ready.)
- `skills/zod-schema-first.md` — Zod is the single source of truth for runtime validation and TS types. Toolchain prep should not introduce ad-hoc TS interfaces that will conflict with Zod schemas added in later stories.
- `skills/vitest-three-layer-testing.md` — The three-layer pyramid (unit / integration / E2E) with the `buildApp()` test factory, `MemoryArtifactStorage` / `MockAiProvider` doubles, the dog-food E2E rule, and coverage thresholds as a floor. Drives both `vitest.config.ts` and `e2e/playwright.config.ts`.
- `skills/htmx-4-forward-compat.md` — Three forward-compat rules for HTMX 2.x → 4.0. Most relevant here: all HTMX event names must come from `src/client/htmx-events.ts` constants — never raw strings. Drives the bootstrap of that file (empty module, ready to be filled in by AUTH-002 / DASH-001 / etc.).
- `skills/viewport-mobile-first-desktop-only.md` — Desktop-only product (`<meta viewport content="width=1280">`), mobile-first authoring discipline. Two-viewport Playwright matrix: 1280×800 primary, 375×800 narrow-smoke (no-horizontal-scroll check only). Drives `playwright.config.ts`.

**Planning doc sections.**

- `docs/planning/project-plan.md` §Stack — Node.js 22 LTS · Fastify · TypeScript (strict) · Zod · MikroORM v7 (Postgres prod / SQLite single-node) · HTMX 2.x · Alpine.js 3 · Tailwind 4 · Flowbite · idiomorph · Eta · Chart.js · Better Auth · Docker Compose. Drives `package.json` dependency choices.
- `docs/planning/project-plan.md` §HTMX 4.0 Forward-Compatibility Rules — informs the structure of `src/client/htmx-events.ts`.
- `docs/planning/architecture.md` §Backend — MikroORM row mandates the dual-dialect setup.
- `docs/planning/testing-strategy.md` §all — three-layer pyramid + coverage thresholds 80/80/75 + Playwright dog-food rule (CTRF reporter → ingest into running CTRFHub; can't be exercised yet but the playwright config should leave room).

## Next action (Feature-implementer)

1. Open a new session. Paste `.antigravity/agents/feature-implementer.md` as the first message, then this Brief (`.argos/INFRA-001/brief.md`) as the second.
2. Check out `story/INFRA-001` locally (already cut and pushed by Argos).
3. Read the Skills + Planning sections above.
4. Implement. Commit on `story/INFRA-001` with messages `feat(INFRA-001): …` / `refactor(INFRA-001): …` / `fix(INFRA-001): …` for code; `chore(INFRA-001): …` is reserved for Argos status flips.
5. Write the feature-handoff to `.argos/INFRA-001/feature-handoff.md` (template in `.antigravity/agents/feature-implementer.md`). The Test-writer reads only that handoff to pick up where you left off — be precise.
6. Return control to André so he can open the Test-writer session.

## Notes from Argos

- This is the very first story exercising the multi-session relay end-to-end. Expect minor friction in the workflow itself; flag anything that feels wrong in the feature-handoff so we can capture it as a workflow bug to fix in a follow-up.
- `package.json` should NOT pin Tailwind plugins or Flowbite versions speculatively — only what's needed for the `css:dev` / `css:build` scripts to exist. INFRA-003 will own the actual Tailwind setup.
- Keep `src/client/htmx-events.ts` truly empty — `export {};` plus a TODO comment explaining the file's purpose is enough. Real constants land per HTMX-using story.
- The `e2e/playwright.config.ts` should declare the `playwright-ctrf-json-reporter` reporter even though no specs exist yet — that wiring is part of the dog-food rule.
