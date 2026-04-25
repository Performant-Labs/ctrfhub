# Task Brief — CTRF-001: Zod CTRF schema and unit tests

## Preconditions (verified by Argos)

- [x] Dependencies satisfied: INFRA-001 (vitest config + scripts) is merged. Nothing else needed — this is a pure schema-and-unit-tests story.
- [x] No P0 gap blocks this story: G-P2-004 (the `status: 'other'` gap) is referenced as part of the acceptance criteria below — its resolution IS this story.
- [x] Branch cut: `story/CTRF-001` from `main`
- [x] `tasks.md` flipped `[ ]` → `[/]` on the story branch (commit `chore(CTRF-001): assign`)
- [x] **Parallel story:** AUTH-001 (Better Auth integration + global preHandler bodies) is being implemented by **Daedalus** on the bare-metal Mac at the same time. **Zero file overlap** — AUTH-001 lives in `src/auth.ts`, `src/app.ts`, `src/modules/auth/`; you're entirely in `src/modules/ingest/schemas.ts` + `src/__tests__/unit/`. You are **Talos** in the macOS VM; this is potentially your inaugural CTRFHub story.

## Story

**Description.** Define the Zod schema that validates incoming CTRF JSON reports. This schema is the **single source of truth** for both runtime validation and TypeScript types throughout the ingest pipeline (CTRF-002 will mount it on the route via `ZodTypeProvider`). Pure schema work — no routes, no services, no DB. Just the Zod definition + comprehensive unit tests.

**Acceptance criteria.** (verbatim from `docs/planning/tasks.md` §CTRF-001, broken into bullets)

- `src/modules/ingest/schemas.ts` exports `CtrfReportSchema` (and the derived TS type via `z.infer<typeof CtrfReportSchema>`).
- The schema covers the full CTRF spec — every required and optional field per the canonical CTRF JSON Schema.
- The schema **accepts** `status: 'other'` as a valid test status. Per gap G-P2-004 in `docs/planning/gaps.md`: the upstream CTRF spec adds `'other'` to the status enum but earlier readings of the spec missed this. CTRF-001's resolution of G-P2-004 is the schema change here.
- Unit tests at `src/__tests__/unit/ctrf-validator.test.ts` cover:
  - A valid (full-shape) CTRF report passes parsing.
  - Each missing required field individually rejected with a Zod-shaped error (CTRF-002 will translate these into 422 HTTP responses; for this story, just assert the Zod error shape).
  - Wrong types in fields rejected (e.g., `passed: "five"` instead of a number).
  - `status: 'other'` accepted (regression guard for G-P2-004).
- **100% branch coverage** on `CtrfReportSchema` per `vitest.config.ts` thresholds (which actually require 80/80/75; CTRF-001's stricter goal is 100% on the schema specifically since it's the validation gate for all ingest).

**Test tiers required.** unit only.

**Page verification tiers.** none — schema only, no rendered routes.

**Critical test paths.** (verbatim from tasks.md, broken out)

- Valid CTRF report passes (the happy path the rest of the test suite anchors on — pull a real example from the CTRF spec or mint one that exercises every optional field).
- Missing required fields rejected with a Zod-shaped error (will become a 422 response in CTRF-002).
- Wrong types rejected.
- `status: 'other'` accepted (resolves G-P2-004).
- 100% branch coverage on `CtrfReportSchema`.

## Required reading

**Skills (full paths — read before any code).**

- `skills/zod-schema-first.md` — **Read this whole skill.** This is the canonical statement of "Zod is the single source of truth; do not write parallel TS interfaces." Your `CtrfReportSchema` and its `z.infer<>` type are the prototype for every later schema in the project. Get this one right; the pattern propagates.
- `skills/ctrf-ingest-validation.md` — **Read this whole skill.** Specifies the ingest endpoint contract (`POST /api/v1/projects/:slug/runs` with `x-api-token`), the Zod-validation-before-DB-write rule, and the "no separate `/api/artifact` endpoint" rule. You don't implement the route here (that's CTRF-002), but the schema you write needs to be shaped for that route's body validation.
- `skills/vitest-three-layer-testing.md` §Layer 1 — Pure-function unit tests with no I/O. Your tests are exactly Layer 1: parse-and-assert, no Fastify, no DB, no app instance. The §Layer 1 examples show the canonical pattern.

**Planning doc sections.**

- `docs/planning/product.md` §Feature 2 (CTRF Ingestion) — describes what CTRF reports contain semantically.
- `docs/planning/database-design.md` §TestRun, §TestResult — these entities (already shipped in INFRA-004) consume the parsed CTRF report. The schema's field names and types should map cleanly into these entities (the mapping itself is CTRF-002's territory; just make sure the types are compatible).
- `docs/planning/gaps.md §G-P2-004` — the `status: 'other'` gap that this story resolves. After CTRF-001 merges, that gap entry should be marked Resolved (Argos handles that in the close-out PR body, not in your branch).
- The CTRF JSON Schema itself: <https://ctrf.io/schema/v1.0.0/ctrf.schema.json> (or the version we pin). This is the upstream spec; the Zod schema is your TypeScript-flavored mirror of it.

## Files in scope

- `src/modules/ingest/schemas.ts` — new (`CtrfReportSchema` + derived type export)
- `src/__tests__/unit/ctrf-validator.test.ts` — new (the test file; the name `ctrf-validator.test.ts` is verbatim from the tasks.md acceptance criteria)
- (Possibly) `src/modules/ingest/index.ts` — barrel export if the convention emerges

## Anti-patterns (will fail spec-enforcer review — see `CLAUDE.md` "Forbidden patterns")

- Parallel TypeScript interfaces alongside the Zod schema (e.g., `interface CtrfReport { ... }` next to `CtrfReportSchema`) → `zod-schema-first.md`. Use `type CtrfReport = z.infer<typeof CtrfReportSchema>` only.
- Defining the schema inline in a (future) handler instead of in `schemas.ts` → `zod-schema-first.md`.
- Permissive validation that lets garbage through (e.g., `z.any()` for unknown fields). The schema is the validation gate; weak schemas defeat the purpose. Use `z.passthrough()` or `z.strict()` consciously, not `z.any()`.
- Using `z.string()` where the CTRF spec says enum (e.g., `status` is `'passed' | 'failed' | 'skipped' | 'pending' | 'other'`, not free-form string).

## Next action (Feature-implementer = Talos)

1. Open a fresh AntiGravity session in the macOS VM. Paste `.antigravity/agents/feature-implementer.md` first, then this Brief (`.argos/CTRF-001/brief.md`) second.
2. `git checkout story/CTRF-001` (already cut and pushed by Argos).
3. Read the three skills + planning sections above. The CTRF JSON Schema URL is the source of truth for field names/types/optionality.
4. Implement:
   - `src/modules/ingest/schemas.ts` — `CtrfReportSchema` first
   - `src/__tests__/unit/ctrf-validator.test.ts` — start with the happy path (valid full report passes), then add one rejection test per required field, then wrong-type rejections, then the `status: 'other'` regression guard
   - Run `npm run test:coverage` and confirm 100% branch coverage on the schema. If you're below 100%, the gap is usually a discriminated-union branch you didn't exercise.
5. Commit with `feat(CTRF-001): …`, `test(CTRF-001): …`, `fix(CTRF-001): …`. `chore(CTRF-001): …` is reserved for Argos status flips.
6. Write the feature-handoff to `.argos/CTRF-001/feature-handoff.md`. Be precise about: which CTRF spec version you targeted, any optional fields you chose to omit (if any) and why, any places where the Zod type doesn't quite match the upstream JSON Schema and why.
7. Hand back to André so he can open the spec-audit step.

## Notes from Argos

- This is a self-contained story — no Fastify, no DB, no Better Auth. If you find yourself importing `fastify` or `@mikro-orm/*`, you've drifted out of scope.
- `status: 'other'` is the gap-fix landmine. Make sure your Zod enum literally includes `'other'` AND your tests exercise the `'other'` path. A future spec-audit will flag this if missing.
- The 100% branch coverage threshold is project-wide for this schema (not just the vitest config's 75%). Use `it.each([...statuses])` patterns where helpful to enumerate enum branches concisely.
- The CTRF spec evolves. Pin the version you target in a comment at the top of `schemas.ts` so future updates are an explicit decision, not a silent drift.
- If you're Talos's inaugural run on the new VM workspace: nothing about your setup should differ from what `agents.md` and `.antigravity/agents/feature-implementer.md` describe. The point of the VM is just isolation from Daedalus's working tree, not a different toolchain. If anything in the workflow feels different from what those docs say, flag it in the feature-handoff so we can iron out VM-specific friction before more parallel work happens.
- Ignore AUTH-001 entirely. Daedalus is on it on the Mac; the two stories don't share files. Even if AUTH-001 finishes first and merges, your branch's rebase-or-merge won't conflict with it.
