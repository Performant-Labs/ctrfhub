# Test Handoff — INFRA-002

**Branch:** `story/INFRA-002`
**Commits added by Test-writer:**
- d8c81d2 test(INFRA-002): unit tests for health Zod schemas + integration tests for buildApp and GET /health

## Tier summary

| Tier | Status | Report |
|---|---|---|
| T1 Headless | ✓ | `.argos/INFRA-002/tier-1-report.md` |
| T2 ARIA (clean room) | N/A — `GET /health` returns JSON, not HTML; no ARIA tree | `.argos/INFRA-002/tier-2-report.md` |
| T2.5 Authenticated State | N/A — route is unauthenticated | — |
| T3 Visual | N/A — non-UI story (infrastructure) | — |
| Backdrop-contrast | N/A — no visual surface changed | — |

## Tests added

| Layer | Files | Tests | Notes |
|---|---|---|---|
| Unit | `src/__tests__/unit/health-schemas.test.ts` | 16 | BootStateSchema (4 tests) + HealthResponseSchema (12 tests): valid/invalid inputs, missing fields, type coercion, unknown property stripping |
| Integration | `src/__tests__/integration/health.test.ts` | 23 | buildApp smoke (5), health 200 + response shape (4), security headers — CSP snapshot against architecture.md, COOP, HSTS, XCTO, X-DNS, X-Download (7), rate-limit headers (3), 404 unknown route (1), shutdown lifecycle — DI seam close + ORM close (3) |
| E2E | — | 0 | N/A — no browser-facing UI in this story |

## Coverage (from `npm run test:coverage`)

Lines: 79.65% · Functions: 80% · Branches: 75%
Thresholds: lines ≥ 80, functions ≥ 80, branches ≥ 75. **MARGINAL FAIL** (lines: 79.65% vs 80%)

> [!NOTE]
> The 0.35% gap is caused by three sources that are structurally untestable via `fastify.inject()`:
> 1. **`src/index.ts` (0% lines)** — process-level entrypoint calling `buildApp()` + `app.listen()`. Cannot be exercised from integration tests.
> 2. **`src/app.ts` lines 400–406** — DB-unreachable error branch in `/health`. Would require closing ORM mid-request (testing MikroORM internals, not app logic).
> 3. **`src/app.ts` lines 419–427** — SIGTERM/SIGINT handlers, intentionally disabled when `testing: true`.
>
> **Recommended fix:** Add `'src/index.ts'` to `coverage.exclude` in `vitest.config.ts`. This is a Feature-implementer change (outside Test-writer boundary).

## Non-blocking issues

- Coverage threshold missed by 0.35% lines due to `index.ts` entry point (untestable via inject). Recommend excluding it from coverage metrics.

## Next action (Spec-enforcer)

1. Open a new session. Paste `.antigravity/agents/spec-enforcer.md` as the first message, then this handoff as the second.
2. Check out `story/INFRA-002`.
3. Run the Audit Checklist and write the verdict to `.argos/INFRA-002/spec-audit.md` (template in `.antigravity/agents/spec-enforcer.md`).
