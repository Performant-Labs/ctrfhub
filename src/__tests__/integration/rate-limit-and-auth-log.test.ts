/**
 * Integration tests — DD-029 rate-limit 429 contract + DD-029 invalid-API-key
 * structured-log decision.
 *
 * Covers the two acceptance criteria from
 * `.argos/stories/audit-composition-root-S1/brief.md §Test tiers required`:
 *
 *   1. The 429 response shape on `/api/v1/*` routes:
 *      - HTTP status 429
 *      - JSON body byte-for-byte equal to
 *        `{"error":"rate_limited","code":"too_many_requests","retry_after_s":<int>}`
 *        — exactly three keys; **no `statusCode` key**.
 *      - Response headers carry the RFC 9728 draft-spec family
 *        (`ratelimit-limit`, `ratelimit-remaining`, `ratelimit-reset`) +
 *        `retry-after` for older-client compat. The legacy `x-ratelimit-*`
 *        family is **not** emitted.
 *      - A single Pino structured-log line is emitted with
 *        `event=ratelimit.exceeded` and the canonical DD-029 five-field
 *        shape (`event`, `endpoint`, `key_hash`, `limit`, `backend`).
 *        The raw limiter key never appears in any log field.
 *
 *   2. The auth preHandler's invalid-API-key branch emits a Pino structured
 *      log line **before** the 401 reply:
 *      - HTTP status 401, body `{ error: 'Invalid API key', code: 'INVALID_API_KEY' }`.
 *      - Single Pino warn line with `event=auth.api_key_invalid` and
 *        `ip: request.ip`, message `"Invalid API key on x-api-token"`.
 *      - No raw token bytes leak into any log field.
 *      - The SECURITY comment guarding the branch is preserved verbatim.
 *
 * @see docs/planning/database-design.md §DD-029 (`:1191-1198` body, `:1233-1241` log shape)
 * @see docs/planning/database-design.md §DD-012 (`:1171` 600/1m row)
 * @see src/app.ts:285-329 errorResponseBuilder
 * @see src/app.ts:331-349 onExceeded
 * @see src/app.ts:745-751 auth.api_key_invalid log line
 * @see .argos/stories/audit-composition-root-S1/brief.md
 */

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { unlinkSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';

import { buildApp } from '../../app.js';
import { buildAuth } from '../../auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Pre-create Better Auth's schema on a SQLite file so signup succeeds in the
 * fixture. Same pattern as `src/__tests__/integration/auth.test.ts`.
 */
async function seedAuthSchema(dbPath: string): Promise<void> {
  const auth = await buildAuth(dbPath);
  const ctx = await auth.$context;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (ctx as any).runMigrations();
}

/** Build a unique temp DB path. The fixture unlinks on close. */
function makeTempDbPath(): string {
  return join(tmpdir(), `ctrfhub-s1-${randomUUID()}.db`);
}

/**
 * Pino log capture without a DI seam.
 *
 * `buildApp({ testing: true })` constructs Fastify with `logger: false`, so
 * `app.log` is a no-op stub. Crucially `app.log === request.log` in that
 * configuration (Fastify shares the same logger object across the request
 * lifecycle when no per-request logger is materialized), and the level
 * methods (`warn`, `info`, …) live on the prototype of `app.log`.
 *
 * Spying at the prototype level captures every `request.log.warn(…)` call
 * regardless of which handler emitted it, with no application-code change
 * required. The brief explicitly forbids introducing a new DI seam, so this
 * prototype-spy approach is the chosen pattern for S1.
 */
type CapturedLog = { level: 'warn'; obj: Record<string, unknown>; msg: string };

function installLogCapture(app: FastifyInstance): {
  captured: CapturedLog[];
  restore: () => void;
} {
  const captured: CapturedLog[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proto: any = Object.getPrototypeOf(app.log);
  const originalWarn = proto.warn;
  proto.warn = function (obj: unknown, msg?: unknown) {
    captured.push({
      level: 'warn',
      obj: (obj ?? {}) as Record<string, unknown>,
      msg: String(msg ?? ''),
    });
    return originalWarn.call(this, obj, msg);
  };
  return {
    captured,
    restore: () => {
      proto.warn = originalWarn;
    },
  };
}

/**
 * Recursive search for a needle string across every primitive value in an
 * arbitrarily-nested log payload. Used to prove the raw token / raw key never
 * appears anywhere in the structured log object.
 */
function deepContainsString(value: unknown, needle: string): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.includes(needle);
  if (typeof value === 'number' || typeof value === 'boolean') return false;
  if (Array.isArray(value)) return value.some((v) => deepContainsString(v, needle));
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((v) =>
      deepContainsString(v, needle),
    );
  }
  return false;
}

// ---------------------------------------------------------------------------
// Test (1) — DD-029 429 contract on /api/v1/* (rate-limit-and-auth-log §1)
// ---------------------------------------------------------------------------
//
// Strategy: seed one user (so Branch 1 of the auth preHandler does not 302 to
// /setup), then register a test-only route at `/api/v1/__test__/rate-limit-probe`
// with `config.rateLimit.max = 1`. The route opts in to `skipAuth: true` so
// Branch 3-5 of the preHandler are bypassed; the global rate-limit
// `errorResponseBuilder` and `onExceeded` hooks still fire because they are
// route-level `onRequest` hooks attached by `@fastify/rate-limit` and they run
// independently of the auth preHandler.
//
// Request 1 returns 200; request 2 trips the limiter and exercises the full
// DD-029 contract — body shape, headers, observability log.

describe('audit-composition-root-S1 §1 — DD-029 429 contract for /api/v1/*', () => {
  let app: FastifyInstance;
  let dbPath: string;
  let captured: CapturedLog[];
  let restoreLog: () => void;
  let firstRes: import('light-my-request').Response;
  let limitedRes: import('light-my-request').Response;

  beforeAll(async () => {
    dbPath = makeTempDbPath();
    await seedAuthSchema(dbPath);
    app = await buildApp({ testing: true, db: dbPath });

    // Register the test-only probe route. `config.rateLimit` is the per-route
    // override @fastify/rate-limit recognizes (see node_modules/@fastify/
    // rate-limit/index.js:142). `skipAuth: true` flags Branch 2 of the auth
    // preHandler so the limiter is exercised in isolation.
    app.get(
      '/api/v1/__test__/rate-limit-probe',
      {
        config: {
          skipAuth: true,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          rateLimit: { max: 1, timeWindow: '1 minute' } as any,
        },
      },
      async () => ({ ok: true }),
    );

    // Seed one user so the empty-DB Branch 1 redirect does not fire.
    const signUpRes = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { 'content-type': 'application/json' },
      payload: {
        email: `s1-ratelimit-${randomUUID()}@example.com`,
        password: 'P@ssw0rd-test-1234',
        name: 'S1 Rate Limit',
      },
    });
    if (signUpRes.statusCode >= 400) {
      throw new Error(`Sign-up failed (status ${signUpRes.statusCode}): ${signUpRes.body}`);
    }

    // Install the log capture AFTER signup so signup noise does not pollute.
    const cap = installLogCapture(app);
    captured = cap.captured;
    restoreLog = cap.restore;

    // Drive request 1 (200) and request 2 (429). Same default app.inject IP
    // so the per-route bucket is keyed identically across both.
    firstRes = await app.inject({ method: 'GET', url: '/api/v1/__test__/rate-limit-probe' });
    limitedRes = await app.inject({ method: 'GET', url: '/api/v1/__test__/rate-limit-probe' });
  });

  afterAll(async () => {
    restoreLog();
    await app.close();
    if (existsSync(dbPath)) {
      try {
        unlinkSync(dbPath);
      } catch {
        /* best effort */
      }
    }
  });

  // ── Status + body shape ───────────────────────────────────────────────

  it('first request under the limit returns 200', () => {
    expect(firstRes.statusCode).toBe(200);
  });

  it('over-the-limit request returns 429', () => {
    expect(limitedRes.statusCode).toBe(429);
  });

  it('429 body has exactly the three DD-029 wire-format keys (no statusCode leak)', () => {
    // DD-029 (`database-design.md:1191-1198`) pins the body to three keys.
    // The iter-1 review caught a `statusCode` leak; this assertion is the
    // regression guard that proves `Object.defineProperty(body, 'statusCode',
    // { enumerable: false })` keeps the field out of the JSON serialization.
    const parsed = JSON.parse(limitedRes.body) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(['code', 'error', 'retry_after_s']);
    expect(parsed).not.toHaveProperty('statusCode');
  });

  it('429 body fields match DD-029 byte-for-byte', () => {
    // database-design.md:1191-1198 fixes the literal strings.
    const parsed = JSON.parse(limitedRes.body) as {
      error: string;
      code: string;
      retry_after_s: number;
    };
    expect(parsed.error).toBe('rate_limited');
    expect(parsed.code).toBe('too_many_requests');
    expect(Number.isInteger(parsed.retry_after_s)).toBe(true);
    expect(parsed.retry_after_s).toBeGreaterThan(0);
  });

  // ── Headers ───────────────────────────────────────────────────────────

  it('429 emits the RFC 9728 draft-spec ratelimit-* headers (DD-029)', () => {
    // DD-029 (`database-design.md:1181-1188`, `:1202`) requires the draft-spec
    // family `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` plus
    // `Retry-After`. Node lowercases header names on the way out.
    expect(limitedRes.headers['ratelimit-limit']).toBeDefined();
    expect(limitedRes.headers['ratelimit-remaining']).toBeDefined();
    expect(limitedRes.headers['ratelimit-reset']).toBeDefined();
    expect(limitedRes.headers['retry-after']).toBeDefined();
    // Retry-After is integer seconds per DD-029 :1187.
    expect(Number.isInteger(Number(limitedRes.headers['retry-after']))).toBe(true);
  });

  it('429 does NOT emit the legacy x-ratelimit-* header family (DD-029 :3208)', () => {
    // DD-029 :1202: "Only RFC 9728 `RateLimit-*` header names are emitted —
    // the non-standard `X-RateLimit-*` variant used by some older APIs is
    // deliberately omitted." This guards against accidentally re-enabling the
    // default `@fastify/rate-limit` header set (which uses the `x-` prefix).
    expect(limitedRes.headers['x-ratelimit-limit']).toBeUndefined();
    expect(limitedRes.headers['x-ratelimit-remaining']).toBeUndefined();
    expect(limitedRes.headers['x-ratelimit-reset']).toBeUndefined();
  });

  // ── Pino observability ────────────────────────────────────────────────

  it('emits a single ratelimit.exceeded log line with DD-029 canonical shape', () => {
    // DD-029 point 7 (`database-design.md:1233-1241`) pins the canonical
    // sample to five fields with snake_case names: event, endpoint, key_hash,
    // limit, backend.
    const lines = captured.filter((c) => c.obj.event === 'ratelimit.exceeded');
    expect(lines.length).toBe(1);
    const line = lines[0]!;
    expect(line.obj).toMatchObject({
      event: 'ratelimit.exceeded',
      endpoint: 'GET /api/v1/__test__/rate-limit-probe',
      limit: '600/1m',
      backend: 'fastify-rate-limit',
    });
    // key_hash is the first 8 hex chars of SHA-256(limiterKey). The exact
    // value depends on app.inject's resolved IP, which we cannot pin in
    // userland — but the shape ([0-9a-f]{8}) is the invariant we care about.
    expect(line.obj.key_hash).toMatch(/^[0-9a-f]{8}$/);
    expect(line.msg).toBe('Rate limit exceeded');
  });

  it('limiter key (raw IP / user-id) never appears in any log field', () => {
    // The log line's diagnostic value depends on operators NOT being able to
    // reverse the hash to a raw IP from the log alone. We assert the
    // commonly-resolved inject IPs (127.0.0.1, ::1) are absent everywhere in
    // the log payload.
    const lines = captured.filter((c) => c.obj.event === 'ratelimit.exceeded');
    for (const line of lines) {
      expect(deepContainsString(line.obj, '127.0.0.1')).toBe(false);
      expect(deepContainsString(line.obj, '::1')).toBe(false);
    }
  });

  it('key_hash matches first 8 hex of SHA-256 over the resolved limiter key (raw IP)', () => {
    // The keyGenerator falls back to request.ip when no user is attached.
    // For app.inject the resolved IP is one of the standard test loopbacks.
    // Recomputing the hash from a small candidate set proves both that the
    // hash is computed correctly and that the underlying key is one of the
    // IPs we expect (i.e. not a leaked user-id or token-id).
    const line = captured.find((c) => c.obj.event === 'ratelimit.exceeded');
    expect(line).toBeDefined();
    const candidates = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
    const hashes = candidates.map((c) =>
      createHash('sha256').update(c).digest('hex').slice(0, 8),
    );
    expect(hashes).toContain(line!.obj.key_hash);
  });
});

// ---------------------------------------------------------------------------
// Test (2) — DD-029 invalid-API-key observability decision
// ---------------------------------------------------------------------------
//
// Strategy: seed a user (so Branch 1 is bypassed), then drive a request that
// carries an `x-api-token` value that no apikey row resolves. The auth
// preHandler short-circuits to a 401 INVALID_API_KEY response and emits the
// `event=auth.api_key_invalid` warn line. We capture all `request.log.warn`
// calls via the prototype spy and assert the line shape + the absence of the
// raw token in any captured field.

describe('audit-composition-root-S1 §2 — invalid-API-key observability', () => {
  let app: FastifyInstance;
  let dbPath: string;
  let captured: CapturedLog[];
  let restoreLog: () => void;

  beforeAll(async () => {
    dbPath = makeTempDbPath();
    await seedAuthSchema(dbPath);
    app = await buildApp({ testing: true, db: dbPath });
    // Seed one user so Branch 1 doesn't pre-empt the invalid-key branch.
    const signUpRes = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { 'content-type': 'application/json' },
      payload: {
        email: `s1-authlog-${randomUUID()}@example.com`,
        password: 'P@ssw0rd-test-1234',
        name: 'S1 Auth Log',
      },
    });
    if (signUpRes.statusCode >= 400) {
      throw new Error(`Sign-up failed (status ${signUpRes.statusCode}): ${signUpRes.body}`);
    }
    const cap = installLogCapture(app);
    captured = cap.captured;
    restoreLog = cap.restore;
  });

  afterAll(async () => {
    restoreLog();
    await app.close();
    if (existsSync(dbPath)) {
      try {
        unlinkSync(dbPath);
      } catch {
        /* best effort */
      }
    }
  });

  // We use a sentinel token that begins with `ctrf_` (so it passes the
  // shape-check the brief flagged about the `ctrf_*` literal prefix) but
  // includes a unique suffix that cannot match any real apikey row.
  const KNOWN_INVALID_TOKEN = 'ctrf_test-known-invalid-DEADBEEF-1234';

  it('returns 401 with INVALID_API_KEY code and the documented error body', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/runs',
      headers: { 'x-api-token': KNOWN_INVALID_TOKEN },
    });
    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body).toEqual({ error: 'Invalid API key', code: 'INVALID_API_KEY' });
  });

  it('emits the auth.api_key_invalid warn line with ip and the canonical message', async () => {
    // Reset capture for this test so we only see this request's emissions.
    captured.length = 0;
    await app.inject({
      method: 'GET',
      url: '/runs',
      headers: { 'x-api-token': KNOWN_INVALID_TOKEN },
    });
    const lines = captured.filter((c) => c.obj.event === 'auth.api_key_invalid');
    expect(lines.length).toBe(1);
    const line = lines[0]!;
    expect(line.obj).toMatchObject({
      event: 'auth.api_key_invalid',
    });
    // `ip: request.ip` per the brief and src/app.ts:748. Inject's loopback
    // shows up as 127.0.0.1 by default.
    expect(typeof line.obj.ip).toBe('string');
    expect((line.obj.ip as string).length).toBeGreaterThan(0);
    expect(line.msg).toBe('Invalid API key on x-api-token');
  });

  it('raw token bytes do NOT appear in any captured log field (IP-only correlation)', async () => {
    // F's iter-1 decision (ratified by A): no tokenPrefix, no keyHash on this
    // log line. The diagnostic field is `ip` alone. This test is the
    // regression guard against re-introducing token bytes — even a prefix —
    // since `ctrf_*` tokens carry a known literal prefix that would leak a
    // partial value.
    captured.length = 0;
    await app.inject({
      method: 'GET',
      url: '/runs',
      headers: { 'x-api-token': KNOWN_INVALID_TOKEN },
    });
    const lines = captured.filter((c) => c.obj.event === 'auth.api_key_invalid');
    expect(lines.length).toBeGreaterThanOrEqual(1);
    for (const line of lines) {
      expect(deepContainsString(line.obj, KNOWN_INVALID_TOKEN)).toBe(false);
      // Belt-and-braces: also assert the bare 'DEADBEEF' suffix is absent —
      // catches an accidental `.slice(8, -1)`-style partial leak.
      expect(deepContainsString(line.obj, 'DEADBEEF')).toBe(false);
      // And the literal `ctrf_` prefix never appears in a value (it might
      // legitimately appear in the message string, but that string is fixed
      // and asserted in the previous test, so any occurrence here would be a
      // value-side leak).
      expect(deepContainsString(line.obj, 'ctrf_')).toBe(false);
    }
  });

  it('preserves the SECURITY comment on the invalid-API-key branch (brief §AC)', () => {
    // The brief carries this as an explicit "must remain unchanged"
    // invariant for src/app.ts. We assert it by reading the file rather than
    // pinning a line number (line numbers shifted from the brief's :567-568
    // when iter-1 added the createHash import). The comment text is what
    // matters; its precise line is incidental.
    const appSrc = readFileSync(resolve(__dirname, '../../app.ts'), 'utf-8');
    expect(appSrc).toContain(
      "SECURITY: Never log or echo the raw `x-api-token` value.",
    );
    expect(appSrc).toContain(
      'Log only presence (truthy/falsy), never the token string itself.',
    );
  });
});
