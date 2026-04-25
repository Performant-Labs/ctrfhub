# Tier 1 Headless Report — INFRA-002

**Executed:** 2026-04-25 05:22
**Method:** `fastify.inject()` (no browser)

## Checks

| # | What is being verified | Command | Expected | Actual | Status |
|---|---|---|---|---|---|
| 1 | `GET /health` returns 200 when ready | `app.inject({ method: 'GET', url: '/health' })` | 200 | 200 | ✓ |
| 2 | Response shape: `{ status, bootState, dbReady }` | Parse body | `{ status: 'ok', bootState: 'ready', dbReady: true }` | Exact match | ✓ |
| 3 | Content-Type is application/json | Check headers | `application/json` | `application/json; charset=utf-8` | ✓ |
| 4 | No auth required (skipAuth: true) | Inject with no auth headers | 200 | 200 | ✓ |
| 5 | CSP header contains all architecture.md directives | Check `content-security-policy` | All 7 directives + frame-src origins | All present | ✓ |
| 6 | COOP: same-origin (DD-028 I7) | Check `cross-origin-opener-policy` | `same-origin` | `same-origin` | ✓ |
| 7 | HSTS present with max-age | Check `strict-transport-security` | Contains `max-age=` | Present | ✓ |
| 8 | X-Content-Type-Options: nosniff | Check header | `nosniff` | `nosniff` | ✓ |
| 9 | X-DNS-Prefetch-Control present | Check header | Defined | Defined | ✓ |
| 10 | X-Download-Options present | Check header | Defined | Defined | ✓ |
| 11 | Rate-limit header X-RateLimit-Limit = 600 | Check header | `600` | `600` | ✓ |
| 12 | Rate-limit remaining header present | Check header | Defined | Defined | ✓ |
| 13 | Unknown route returns 404 | `app.inject({ method: 'GET', url: '/nonexistent' })` | 404 | 404 | ✓ |
| 14 | `app.close()` completes without error | `await app.close()` | No throw | No throw | ✓ |
| 15 | DI seam close() methods called on shutdown | Track flags on injected doubles | All 3 true | All 3 true | ✓ |
| 16 | ORM closed after app.close() | `await orm.isConnected()` after close | false | false | ✓ |
| 17 | Boot state is "ready" after buildApp resolves | `app.getBootState()` | `'ready'` | `'ready'` | ✓ |
| 18 | BootStateSchema accepts valid values | Zod safeParse | success: true | success: true | ✓ |
| 19 | BootStateSchema rejects invalid values | Zod safeParse | success: false | success: false | ✓ |
| 20 | HealthResponseSchema validates complete shape | Zod safeParse | success: true | success: true | ✓ |
| 21 | HealthResponseSchema rejects missing fields | Zod safeParse | success: false | success: false | ✓ |

## Excerpt of raw output

```
 ✓ src/__tests__/unit/health-schemas.test.ts (16 tests) 5ms
 ✓ src/__tests__/unit/scaffold.test.ts (7 tests) 192ms
 ✓ src/__tests__/integration/health.test.ts (23 tests) 139ms

 Test Files  3 passed (3)
      Tests  46 passed (46)
   Duration  941ms
```

## Verdict

**PASS** — all 46 tests green (16 unit + 7 scaffold + 23 integration). Proceed to Tier 2.
