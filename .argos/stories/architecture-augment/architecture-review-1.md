# Architecture review — architecture-augment — iteration 1

**Reviewer:** architecture-reviewer (Claude Opus 4.7) — review mode
**Date:** 2026-05-19
**Verdict:** PASS
**Diff base:** main @ 76715f2
**Diff head:** story/architecture-augment @ 13be137

## Summary

PASS. This is a docs/governance story; the diff touches only `docs/planning/architecture.md`
plus this story's namespace scaffolding. All six brief augmentations are present, internally
consistent, correctly cited, and faithful to observable patterns in `src/`. The two "Known
drift" items (no repository classes; two route-registration shapes) are correctly stated as
drift — intended rule as standard, drift parenthesized, "André adjudicates" — and not silently
codified. No `block`-severity findings; three minor `warn`/`nit` observations below.

## Findings

| # | Severity | File:line | Drift dimension | Finding | Suggested fix |
|---|---|---|---|---|---|
| 1 | nit | `docs/planning/architecture.md` (§Layering / §Document Authority anchor refs) | citation | In-doc cross-references use Markdown auto-anchors. `[§Code Conventions → MikroORM usage](#code-conventions)`, `[§Layering → Known drift](#layering-and-dependency-direction)`, and `[§Security → Global auth preHandler](#security)` point at section-level anchors, not the named subsections — the `→ subsection` suffix is prose, not a resolvable fragment. They resolve to the right *section*, so navigation works, but the suffix overstates anchor precision. | Optional: drop the `→ subsection` from the link text, or accept as-is — F's handoff already flags anchor format as a known limitation. Non-blocking. |
| 2 | warn | `docs/planning/architecture.md` §Code Conventions → File organization | pattern consistency | The `src/` file-organization map states `modules/<name>/` contains `routes.ts, schemas.ts, service.ts`. The `health` module has only `schemas.ts` — its route is registered inline in `app.ts §10` (`app.get('/health', ...)`), not via a module `routes.ts`. The §Module-boundaries text does soften this ("when it has non-trivial logic — `service.ts`"), but the map and the "One concern per file" bullet do not account for a module whose route lives in the composition root. | Add one clause noting that a trivial route (e.g. `/health`) may be registered directly in `buildApp()` rather than getting its own `routes.ts`. Minor — does not affect A's audit yardstick materially. |
| 3 | nit | `docs/planning/architecture.md` §Operational Invariants → Asset-pipeline bridging | faithfulness | The doc says `@fastify/static` root is `dist/assets/`. `src/app.ts §5` registers root `path.join(__dirname, 'assets')` — which is `src/assets/` in dev and `dist/assets/` in the compiled image. The doc's claim is correct *for production* (and it says "Production serves..."), but the app.ts source comment reads "serve compiled assets... from src/assets/". The doc is right; just noting the source comment is the misleading one, not the doc. No action needed on this story. | None — observation only. The doc statement is accurate. |

## Verification performed

**Completeness vs. brief (all 6 augmentations present):**
1. §Layering and Dependency Direction — present, with ASCII dependency diagram, six normative
   layer rules, module-boundary + shared-seam rules, "Known drift" note. ✓
2. §Code Conventions — present: naming table, `src/` file-org map, Zod-schema location (N1),
   error handling, route registration, MikroORM usage, transaction boundaries, logging,
   abstraction level; each cites a canonical example file. ✓
3. §Operational Invariants — present: five normative blocks, one per PR #71–#75. ✓
4. §Document Authority and Exception Process — present: canonical-doc statement, discrepancy
   resolution table, four-step exception process. ✓
5. Stale-section refresh — Image-build section shows the asset-bridge `cp` step and BuildKit
   cache mounts; CI/CD section gained the Issue-management subsection; asset pipeline reframed
   as invariant U3. ✓
6. project-architecture.md discrepancy — resolved via documented "keep both, split by subject"
   choice in §Document Authority. ✓ (Bonus §Security preHandler subsection resolves N2/N3.)

**Citation integrity:** All five PR merge SHAs verified against `git log main`: #71=142fb97,
#72=c9f4beb, #73=4240e74, #74=5aa281d, #75=76715f2 — all correct. The dangling `architecture.md
§Layering` citation in `docs/orchestrator-workflows/auditarchitecture.md:70` now resolves: the
new section title is "Layering and Dependency Direction", leading with the literal word
"Layering". The companion `project-architecture.md §Module boundaries` citation
(`auditarchitecture.md:71`) still dangles — F correctly flags this as an open follow-up for
André inside §Document Authority rather than silently editing the forbidden workflow file.

**Faithfulness to the codebase (spot-checked):**
- Layering chain (route→service→EM→entity): matches. `ingestPlugin` delegates to `IngestService`;
  `IngestService` JSDoc states it "never accesses Fastify request/reply objects"; service
  receives `EntityManager` as a plain arg.
- "Known drift — no repository classes": confirmed — services call `em.*` directly; no
  `*Repository` classes exist. Correctly stated as drift, not codified as the rule.
- Two route-registration shapes: confirmed — `registerAuthRoutes` (named export,
  `src/modules/auth/routes.ts`) vs. `ingestPlugin` (default `FastifyPluginAsync`,
  `src/modules/ingest/routes.ts`). Both wired in `buildApp()`. `setupRoutes` (the cited
  counter-example) exists nowhere in `src/` — correctly used only as a hypothetical.
- Naming, constants (`CHUNK_SIZE = 500`), `ReferenceOnlyError`, Zod schema location
  (`schemas.ts` per module), entity imports (`TestRun.ts` imports `ProjectSchema`),
  `mikro-orm.config.<dialect>.ts` — all verified accurate.
- preHandler branch ordering (§Security N2): matches `src/app.ts §9` — Branch 0 `/assets/`
  prefix bypass, Branch 1 public allow-list, Branch 2 `skipAuth`, Branch 3+ resolution.
- `scripts/copy-vendor-assets.mjs`, `scripts/docker-build-cached.sh`, `postinstall` hook,
  `npm run docker:build:cached` — all exist as cited.

**Drift in assertions:** No new rule contradicts existing `architecture.md` content,
`skills/*`, or `CLAUDE.md`. The forbidden-pattern citations (ZodTypeProvider exception for
`/api/auth/*`, no ad-hoc `z.object` in handlers, dual-dialect SQL) are consistent with
`CLAUDE.md`'s forbidden-patterns list.

**Constraint compliance:** Diff touches only `docs/planning/architecture.md` and this story's
`.argos/` namespace (`brief.md`, `evidence-arch-md-review.md`, `feature-handoff.md` — all
expected scaffolding). No `src/` change, no test change, no other `docs/planning/*` file, no
`auditarchitecture.md` edit, no `.claude/agents/architecture-reviewer.md` edit. The
`docs/ai_guidance` symlink change is NOT in the diff (verified: `git diff` for that path is
empty) — it remains an uncommitted working-tree change on `main`, correctly excluded.

## Notes for the implementer (BLOCK only)

N/A — verdict is PASS.

## Patterns referenced

- `src/app.ts` — composition root; §5 `@fastify/static`, §9 global auth preHandler ordering.
- `src/modules/ingest/routes.ts` — default-exported `FastifyPluginAsync` route shape.
- `src/modules/auth/routes.ts` — named `registerAuthRoutes` route shape; ZodTypeProvider exception.
- `src/modules/ingest/service.ts` — service-layer pattern, `CHUNK_SIZE`, `ReferenceOnlyError`.
- `docs/orchestrator-workflows/auditarchitecture.md` — the workflow whose `§Layering` citation
  this story's new section was verified to resolve.
