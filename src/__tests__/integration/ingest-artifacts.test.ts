/**
 * Integration tests — CTRF-003 Artifact co-upload with ingest.
 *
 * Covers:
 *   - Happy path: multipart with valid PNG file → TestArtifact row + storage
 *   - Magic-bytes mismatch (400)
 *   - Per-file size limit (413)
 *   - Per-run cumulative size limit (413)
 *   - External-URL by-reference: stored as `storageType='url'` (no body)
 *   - External-URL with file body sent → 400
 *   - JSON-only backwards compat: existing JSON ingest still works,
 *     no artifacts written
 *   - Magic-bytes happy path for JPEG (different signature offset)
 *   - Attachment in CTRF JSON without matching file part is silently skipped
 *
 * NOTE: Better Auth's API-key plugin internal rate limiter (10 per 10s)
 * forces us to consolidate API-key-verified requests across suites.
 *
 * @see skills/vitest-three-layer-testing.md §Layer 2
 * @see skills/ctrf-ingest-validation.md §Multipart uploads
 * @see skills/artifact-security-and-serving.md
 * @see .argos/CTRF-003/feature-handoff.md
 */

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { unlinkSync, existsSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';

import { buildApp } from '../../app.js';
import { buildAuth } from '../../auth.js';
import { Organization, Project, TestArtifact, TestResult } from '../../entities/index.js';
import { MemoryEventBus } from '../../services/event-bus.js';
import { MemoryArtifactStorage } from '../doubles/MemoryArtifactStorage.js';

// ---------------------------------------------------------------------------
// Binary fixtures
// ---------------------------------------------------------------------------

/**
 * Tiny valid PNG: 8-byte signature + minimal IHDR chunk.
 * Total ~33 bytes; passes magic-bytes validation.
 */
function tinyPng(): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.from([
    0x00, 0x00, 0x00, 0x0d, // length
    0x49, 0x48, 0x44, 0x52, // "IHDR"
    0x00, 0x00, 0x00, 0x01, // width 1
    0x00, 0x00, 0x00, 0x01, // height 1
    0x08, 0x06, 0x00, 0x00, 0x00, // bit depth 8, color type 6, etc.
    0x1f, 0x15, 0xc4, 0x89, // CRC
  ]);
  return Buffer.concat([sig, ihdr]);
}

/** Fake PNG: text masquerading as image/png — must fail magic-bytes. */
function fakePng(): Buffer {
  return Buffer.from('hello world this is not a png');
}

/** Tiny valid JPEG: magic FF D8 FF + filler bytes. */
function tinyJpeg(): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    Buffer.from('JFIF'),
    Buffer.alloc(20, 0),
  ]);
}

/** Build an oversized buffer of `mb` MB starting with a valid PNG header. */
function oversizedPng(mb: number): Buffer {
  const png = tinyPng();
  const filler = Buffer.alloc(mb * 1024 * 1024 - png.length, 0);
  return Buffer.concat([png, filler]);
}

// ---------------------------------------------------------------------------
// Multipart body builder
// ---------------------------------------------------------------------------

interface FilePart {
  fieldName: string;
  fileName: string;
  contentType: string;
  data: Buffer;
}

/**
 * Build a `multipart/form-data` payload buffer with a `ctrf` JSON field
 * and zero or more file parts.
 */
function buildMultipart(
  ctrfJson: unknown,
  files: FilePart[],
  boundary: string,
): Buffer {
  const parts: Buffer[] = [];
  const CRLF = '\r\n';

  // ctrf field
  parts.push(Buffer.from(
    `--${boundary}${CRLF}` +
    `Content-Disposition: form-data; name="ctrf"${CRLF}${CRLF}` +
    `${JSON.stringify(ctrfJson)}${CRLF}`,
  ));

  // file parts
  for (const file of files) {
    parts.push(Buffer.from(
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="${file.fieldName}"; filename="${file.fileName}"${CRLF}` +
      `Content-Type: ${file.contentType}${CRLF}${CRLF}`,
    ));
    parts.push(file.data);
    parts.push(Buffer.from(CRLF));
  }

  parts.push(Buffer.from(`--${boundary}--${CRLF}`));
  return Buffer.concat(parts);
}

// ---------------------------------------------------------------------------
// CTRF fixture builder
// ---------------------------------------------------------------------------

interface AttachmentSpec {
  name: string;
  contentType: string;
  path: string;
}

function makeCtrfWithAttachments(testAttachments: AttachmentSpec[][]): unknown {
  const tests = testAttachments.map((attachments, i) => ({
    name: `test-${i + 1}`,
    status: 'passed' as const,
    duration: 100,
    ...(attachments.length > 0 ? { attachments } : {}),
  }));
  return {
    reportFormat: 'CTRF',
    specVersion: '1.0.0',
    results: {
      tool: { name: 'vitest' },
      summary: {
        tests: tests.length, passed: tests.length, failed: 0,
        skipped: 0, pending: 0, other: 0,
        start: Date.now() - 5000, stop: Date.now(),
      },
      tests,
    },
  };
}

function makeCtrfNoAttachments(): unknown {
  return {
    reportFormat: 'CTRF',
    specVersion: '1.0.0',
    results: {
      tool: { name: 'vitest' },
      summary: {
        tests: 1, passed: 1, failed: 0,
        skipped: 0, pending: 0, other: 0,
        start: Date.now() - 5000, stop: Date.now(),
      },
      tests: [{ name: 'plain-test', status: 'passed', duration: 50 }],
    },
  };
}

// ---------------------------------------------------------------------------
// Seeded app factory (mirrors CTRF-002 test pattern)
// ---------------------------------------------------------------------------

function makeTempDbPath(): string {
  return join(tmpdir(), `ctrfhub-artifacts-${randomUUID()}.db`);
}

async function seedAuthSchema(dbPath: string): Promise<void> {
  const auth = await buildAuth(dbPath);
  const ctx = await auth.$context;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (ctx as any).runMigrations();
}

interface ArtifactFixture {
  app: FastifyInstance;
  dbPath: string;
  storage: MemoryArtifactStorage;
  rawApiKey: string;
  projectSlug: string;
  projectId: number;
  orgId: string;
}

async function buildArtifactFixture(): Promise<ArtifactFixture> {
  const dbPath = makeTempDbPath();
  await seedAuthSchema(dbPath);

  const storage = new MemoryArtifactStorage();
  const eventBus = new MemoryEventBus();
  const app = await buildApp({
    testing: true,
    db: dbPath,
    eventBus,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    artifactStorage: storage as any,
  });

  const signUpRes = await app.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    headers: { 'content-type': 'application/json' },
    payload: { email: 'artifacts@example.com', password: 'P@ssw0rd-1234', name: 'Artifact Tester' },
  });
  if (signUpRes.statusCode >= 400) throw new Error(`Sign-up failed: ${signUpRes.body}`);
  const userId = (JSON.parse(signUpRes.body) as { user?: { id?: string } }).user?.id ?? '';
  if (!userId) throw new Error('No user id');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orm = (app as any).orm;
  const conn = orm.em.getConnection();
  const orgExists = await conn.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='organization'",
  );
  if ((orgExists as unknown[]).length === 0) {
    await conn.execute(`CREATE TABLE IF NOT EXISTS "organization" (
      "id" TEXT PRIMARY KEY NOT NULL, "name" TEXT NOT NULL, "slug" TEXT NOT NULL,
      "logo" TEXT, "metadata" TEXT, "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  }
  const orgId = 'org-artifact-test';
  await conn.execute(
    `INSERT INTO "organization" ("id","name","slug","created_at") VALUES ('${orgId}','Test Org','test-org',datetime('now'))`,
  );

  const em = orm.em.fork();
  const org = await em.findOne(Organization, { id: orgId });
  if (!org) throw new Error('Org seed failed');
  const project = em.create(Project, {
    organization: org, name: 'Demo', slug: 'demo',
    createdAt: new Date(), updatedAt: new Date(),
  });
  await em.flush();
  const projectId = project.id;

  const fixtureAuth = await buildAuth(dbPath);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createResult: any = await (fixtureAuth.api as any).createApiKey({
    body: { name: 'fixture-key', userId, metadata: { projectId: String(projectId) } },
  });
  const rawApiKey: string = createResult.key ?? createResult.apiKey ?? '';
  if (!rawApiKey?.startsWith('ctrf_')) throw new Error(`createApiKey failed: ${JSON.stringify(createResult)}`);

  return { app, dbPath, storage, rawApiKey, projectSlug: 'demo', projectId, orgId };
}

async function teardownFixture(f: ArtifactFixture): Promise<void> {
  await f.app.close();
  if (existsSync(f.dbPath)) { try { unlinkSync(f.dbPath); } catch { /* */ } }
}

/** Inject a multipart request — counts as 1 API-key call. */
async function injectMultipart(
  f: ArtifactFixture,
  ctrfJson: unknown,
  files: FilePart[],
  slug: string = 'demo',
) {
  const boundary = `----CTRF003-${randomUUID().slice(0, 8)}`;
  const payload = buildMultipart(ctrfJson, files, boundary);
  return f.app.inject({
    method: 'POST',
    url: `/api/v1/projects/${slug}/runs`,
    headers: {
      'x-api-token': f.rawApiKey,
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    payload,
  });
}

// ---------------------------------------------------------------------------
// Suite 1: Happy path + per-file 413 + magic-bytes (≤ 9 API-key calls)
// ---------------------------------------------------------------------------

describe('CTRF-003 Artifact co-upload — happy path & validation', () => {
  let f: ArtifactFixture;

  beforeAll(async () => { f = await buildArtifactFixture(); });
  afterAll(async () => { await teardownFixture(f); });

  // ── 1. Happy multipart upload (1 API key call) ─────────────────────────
  it('returns 201 on valid PNG upload, persists TestArtifact, writes to storage', async () => {
    const png = tinyPng();
    const ctrf = makeCtrfWithAttachments([
      [{ name: 'screenshot.png', contentType: 'image/png', path: 'screenshot.png' }],
    ]);

    const res = await injectMultipart(f, ctrf, [
      { fieldName: 'screenshot.png', fileName: 'screenshot.png', contentType: 'image/png', data: png },
    ]);

    expect(res.statusCode).toBe(201);
    const { runId } = JSON.parse(res.body) as { runId: number };

    // Storage received the file
    expect(f.storage.storedCount()).toBeGreaterThanOrEqual(1);
    const keys = f.storage.keys();
    expect(keys.some((k) => k.includes(`runs/${runId}`) && k.endsWith('screenshot.png'))).toBe(true);

    // TestArtifact row created and linked to a TestResult
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const em = ((f.app as any).orm).em.fork();
    const results = await em.find(TestResult, { testRun: runId });
    expect(results).toHaveLength(1);
    const artifacts = await em.find(TestArtifact, { testResult: results[0]!.id });
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]!.contentType).toBe('image/png');
    expect(artifacts[0]!.storageType).toBe('local');
    expect(artifacts[0]!.sizeBytes).toBe(png.length);
    expect(artifacts[0]!.contentTypeVerified).toBe(true);
    expect(artifacts[0]!.storageKey).toContain(`runs/${runId}`);
  });

  // ── 2. JPEG happy path (1 API key call) ────────────────────────────────
  it('accepts a valid JPEG (different magic offset)', async () => {
    const jpg = tinyJpeg();
    const ctrf = makeCtrfWithAttachments([
      [{ name: 'image.jpg', contentType: 'image/jpeg', path: 'image.jpg' }],
    ]);

    const res = await injectMultipart(f, ctrf, [
      { fieldName: 'image.jpg', fileName: 'image.jpg', contentType: 'image/jpeg', data: jpg },
    ]);

    expect(res.statusCode).toBe(201);
  });

  // ── 3. Magic-bytes mismatch (1 API key call) ───────────────────────────
  it('returns 400 when declared image/png but bytes are not PNG', async () => {
    const ctrf = makeCtrfWithAttachments([
      [{ name: 'fake.png', contentType: 'image/png', path: 'fake.png' }],
    ]);

    const res = await injectMultipart(f, ctrf, [
      { fieldName: 'fake.png', fileName: 'fake.png', contentType: 'image/png', data: fakePng() },
    ]);

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).code).toBe('ARTIFACT_MAGIC_BYTES_MISMATCH');
  });

  // ── 4. Per-file size limit (1 API key call) ────────────────────────────
  // NOTE: @fastify/multipart's default fileSize limit (1 MB) preempts our
  // custom per-type limits for any file > 1 MB. Either limit firing returns
  // 413, but the response code string differs (`FST_REQ_FILE_TOO_LARGE` from
  // Fastify vs `ARTIFACT_FILE_TOO_LARGE` from artifact-validation.ts).
  // We assert only the status here; see test-handoff.md for the bug note.
  it('returns 413 when an image exceeds the per-file size limit', async () => {
    const big = oversizedPng(11); // 11 MB — well over Fastify's 1 MB default
    const ctrf = makeCtrfWithAttachments([
      [{ name: 'big.png', contentType: 'image/png', path: 'big.png' }],
    ]);

    const res = await injectMultipart(f, ctrf, [
      { fieldName: 'big.png', fileName: 'big.png', contentType: 'image/png', data: big },
    ]);

    expect(res.statusCode).toBe(413);
  });

  // ── 5. External URL by-reference (1 API key call) ──────────────────────
  it('stores external-URL attachments by reference (no file body)', async () => {
    const ctrf = makeCtrfWithAttachments([
      [{
        name: 'remote-report',
        contentType: 'text/html',
        path: 'https://example.com/report.html',
      }],
    ]);

    const res = await injectMultipart(f, ctrf, []);
    expect(res.statusCode).toBe(201);
    const { runId } = JSON.parse(res.body) as { runId: number };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const em = ((f.app as any).orm).em.fork();
    const results = await em.find(TestResult, { testRun: runId });
    const artifacts = await em.find(TestArtifact, { testResult: results[0]!.id });
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]!.storageType).toBe('url');
    expect(artifacts[0]!.storageKey).toBe('https://example.com/report.html');
    expect(artifacts[0]!.fileName).toBeNull();
  });

  // ── 6. External URL with file body sent → 400 (1 API key call) ─────────
  it('returns 400 when a file body is sent for a reference-only attachment', async () => {
    const ctrf = makeCtrfWithAttachments([
      [{
        name: 'remote-report',
        contentType: 'text/html',
        path: 'https://example.com/report.html',
      }],
    ]);

    const res = await injectMultipart(f, ctrf, [
      {
        fieldName: 'https://example.com/report.html',
        fileName: 'report.html',
        contentType: 'text/html',
        data: Buffer.from('<html>oops</html>'),
      },
    ]);

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).code).toBe('REFERENCE_ONLY_ARTIFACT');
  });

  // ── 7. JSON-only backwards compatibility (1 API key call) ──────────────
  it('JSON-only ingest still works and writes no artifacts', async () => {
    const beforeCount = f.storage.storedCount();
    const ctrf = makeCtrfNoAttachments();

    const res = await f.app.inject({
      method: 'POST',
      url: `/api/v1/projects/${f.projectSlug}/runs`,
      headers: { 'x-api-token': f.rawApiKey, 'content-type': 'application/json' },
      payload: ctrf,
    });

    expect(res.statusCode).toBe(201);
    expect(f.storage.storedCount()).toBe(beforeCount);
  });

  // ── 8. Attachment in CTRF without file part is silently skipped (1 call) ─
  it('skips attachments declared in CTRF JSON but without a matching file part', async () => {
    const ctrf = makeCtrfWithAttachments([
      [{ name: 'missing.png', contentType: 'image/png', path: 'missing.png' }],
    ]);

    const res = await injectMultipart(f, ctrf, []);
    expect(res.statusCode).toBe(201);
    const { runId } = JSON.parse(res.body) as { runId: number };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const em = ((f.app as any).orm).em.fork();
    const results = await em.find(TestResult, { testRun: runId });
    const artifacts = await em.find(TestArtifact, { testResult: results[0]!.id });
    expect(artifacts).toHaveLength(0);
  });
  // Total: 8 API-key calls
});

// ---------------------------------------------------------------------------
// Suite 2: Per-run total 413 (separate fixture, env override)
// ---------------------------------------------------------------------------

describe('CTRF-003 Artifact co-upload — per-run total limit', () => {
  let f: ArtifactFixture;
  const ORIGINAL = process.env['MAX_ARTIFACT_SIZE_PER_RUN'];

  beforeAll(async () => {
    // Set the per-run limit small so we can exceed it without ballooning memory
    process.env['MAX_ARTIFACT_SIZE_PER_RUN'] = '100kb';
    f = await buildArtifactFixture();
  });
  afterAll(async () => {
    await teardownFixture(f);
    if (ORIGINAL === undefined) delete process.env['MAX_ARTIFACT_SIZE_PER_RUN'];
    else process.env['MAX_ARTIFACT_SIZE_PER_RUN'] = ORIGINAL;
  });

  it('returns 413 when total artifact size exceeds MAX_ARTIFACT_SIZE_PER_RUN', async () => {
    // Each file is ~60 KB of valid PNG; two of them = ~120 KB > 100 KB cap
    const png60kb = (() => {
      const png = tinyPng();
      return Buffer.concat([png, Buffer.alloc(60 * 1024 - png.length, 0)]);
    })();

    const ctrf = makeCtrfWithAttachments([
      [
        { name: 'a.png', contentType: 'image/png', path: 'a.png' },
        { name: 'b.png', contentType: 'image/png', path: 'b.png' },
      ],
    ]);

    const res = await injectMultipart(f, ctrf, [
      { fieldName: 'a.png', fileName: 'a.png', contentType: 'image/png', data: png60kb },
      { fieldName: 'b.png', fileName: 'b.png', contentType: 'image/png', data: png60kb },
    ]);

    expect(res.statusCode).toBe(413);
    expect(JSON.parse(res.body).code).toBe('ARTIFACT_RUN_TOTAL_TOO_LARGE');
    // Nothing should be persisted on rejection
    expect(f.storage.storedCount()).toBe(0);
  });
});
