/**
 * Ingest module — `POST /api/v1/projects/:slug/runs` route.
 *
 * Accepts CTRF JSON reports via `application/json` or `multipart/form-data`,
 * validates with Zod, persists TestRun + TestResult rows, and fires
 * `run.ingested` on the EventBus.
 *
 * This is the headline pipe — every downstream feature (Dashboard, AI
 * categorization, retention, search) depends on rows landing here.
 *
 * @see skills/ctrf-ingest-validation.md — canonical ingest contract
 * @see skills/fastify-route-convention.md — plugin pattern, service boundary
 * @see skills/zod-schema-first.md — CtrfReportSchema is the single source
 * @see docs/planning/database-design.md §DD-019 — idempotency policy
 */

import type { FastifyPluginAsync } from 'fastify';
import { ZodError, z } from 'zod';
import { IngestService } from './service.js';
import { Project } from '../../entities/index.js';
import type { EventBus } from '../../services/event-bus.js';
import { parseMaxJsonSize } from './size-limit.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Regex for printable ASCII validation of `Idempotency-Key` header.
 * Characters 0x20 (space) through 0x7E (~).
 *
 * @see docs/planning/database-design.md §DD-019 — key validation
 */
const PRINTABLE_ASCII_RE = /^[\x20-\x7E]+$/;

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

/**
 * Fastify plugin registering the CTRF ingest route.
 *
 * The route relies on the global auth preHandler for `x-api-token`
 * validation (Branch 3). Once authenticated, `request.apiKeyUser`
 * contains the API key's metadata including `projectId` for scope checks.
 */
const ingestPlugin: FastifyPluginAsync = async (fastify) => {
  const service = new IngestService();

  // Resolve max JSON body size from env (default 10 MB)
  const maxJsonBytes = parseMaxJsonSize(process.env['MAX_CTRF_JSON_SIZE']);

  fastify.post('/api/v1/projects/:slug/runs', {
    /**
     * Per-route body size limit.
     * Caps the JSON payload to protect the event loop from huge
     * `JSON.parse()` calls. Artifact file parts (CTRF-003) have
     * separate, larger limits.
     *
     * @see docs/planning/deployment-architecture.md §MAX_CTRF_JSON_SIZE
     */
    bodyLimit: maxJsonBytes,

    /**
     * Per-route rate limit: 120 req/hour per token.
     *
     * Keyed on the `x-api-token` header so each CI token gets its own
     * bucket. Invalid tokens fail auth before hitting the rate limiter.
     *
     * @see docs/planning/database-design.md §DD-012 Layer 2 (CTRF ingest row)
     * @see docs/planning/database-design.md §DD-029 — consolidation decision
     */
    config: {
      rateLimit: {
        max: 120,
        timeWindow: '1 hour',
        keyGenerator: (req: { headers: Record<string, string | string[] | undefined> }) => {
          // Key on the token header value; the global auth preHandler
          // already rejected requests without a valid token, so this
          // always has a value in the happy path.
          return `ingest:${req.headers['x-api-token'] ?? req.headers['x-forwarded-for'] ?? 'unknown'}`;
        },
      },
    },

    schema: {
      params: z.object({
        slug: z.string().min(1),
      }),
    },
  }, async (request, reply) => {
    // -- Auth check -------------------------------------------------------
    // The global preHandler already validated the API key. If we reach here
    // without `apiKeyUser`, the token was absent or invalid — the preHandler
    // would have already sent 401.
    if (!request.apiKeyUser) {
      return reply.status(401).send({
        error: 'Invalid or missing API token',
        code: 'MISSING_API_TOKEN',
      });
    }

    // -- Resolve project from slug ----------------------------------------
    const { slug } = request.params as { slug: string };
    const em = request.em;

    const project = await em.findOne(Project, { slug }, {
      populate: ['organization'],
    });

    if (!project) {
      return reply.status(404).send({
        error: 'Project not found',
        code: 'PROJECT_NOT_FOUND',
      });
    }

    // -- Token scope check ------------------------------------------------
    // The API key's metadata.projectId must match the resolved project.
    // This prevents a CI token scoped to project A from posting runs to
    // project B.
    const tokenProjectId = request.apiKeyUser.metadata?.['projectId'];
    if (tokenProjectId != null && Number(tokenProjectId) !== project.id) {
      return reply.status(403).send({
        error: 'API token is not scoped to this project',
        code: 'CROSS_PROJECT_TOKEN',
      });
    }

    // -- Parse CTRF body from JSON or multipart ---------------------------
    let rawCtrf: unknown;
    const contentType = request.headers['content-type'] ?? '';

    if (contentType.includes('multipart/form-data')) {
      // Multipart: extract the `ctrf` field
      rawCtrf = await parseMultipartCtrf(request);
      if (rawCtrf === null) {
        return reply.status(422).send({
          error: 'Missing "ctrf" field in multipart body',
          code: 'MISSING_CTRF_FIELD',
        });
      }
    } else {
      // JSON body — Fastify already parsed it
      rawCtrf = request.body;
    }

    // -- Validate Idempotency-Key header ----------------------------------
    const idempotencyKey = extractIdempotencyKey(request.headers);
    if (idempotencyKey === false) {
      return reply.status(422).send({
        error: 'Invalid Idempotency-Key: must be 1–128 printable ASCII characters',
        code: 'INVALID_IDEMPOTENCY_KEY',
      });
    }

    // -- Resolve EventBus -------------------------------------------------
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const eventBus = (fastify as any).eventBus as EventBus;

    // -- Delegate to service layer ----------------------------------------
    try {
      const result = await service.ingest(em, project, rawCtrf, {
        idempotencyKey: idempotencyKey ?? undefined,
        eventBus,
      });

      if (result.replay) {
        reply.header('X-Idempotent-Replay', 'true');
        return reply.status(200).send({ runId: result.runId });
      }

      return reply.status(201).send({ runId: result.runId });
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.status(422).send({
          error: 'Invalid CTRF report',
          code: 'INVALID_CTRF',
          issues: error.issues,
        });
      }
      throw error; // Let the global error handler deal with it
    }
  });
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract and validate the `Idempotency-Key` header.
 *
 * @returns The validated key string, `null` if absent, or `false` if malformed.
 */
function extractIdempotencyKey(
  headers: Record<string, string | string[] | undefined>,
): string | null | false {
  const raw = headers['idempotency-key'];
  if (raw === undefined || raw === null) return null;

  const key = Array.isArray(raw) ? raw[0] : raw;
  if (!key) return null;

  // Length validation: 1–128 chars
  if (key.length < 1 || key.length > 128) return false;

  // Charset validation: printable ASCII only (0x20–0x7E)
  if (!PRINTABLE_ASCII_RE.test(key)) return false;

  return key;
}

/**
 * Parse the `ctrf` field from a multipart request.
 *
 * Discards any file parts (artifact uploads are CTRF-003 scope).
 * Returns `null` if no `ctrf` field is found.
 *
 * @see skills/ctrf-ingest-validation.md §Multipart uploads
 */
async function parseMultipartCtrf(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  request: any,
): Promise<unknown | null> {
  // @fastify/multipart attaches `.parts()` to the request
  const parts = request.parts();
  let ctrfJson: string | null = null;

  for await (const part of parts) {
    if (part.type === 'field' && part.fieldname === 'ctrf') {
      ctrfJson = part.value as string;
    }
    // File parts are intentionally discarded (CTRF-003 scope).
    // If it's a file, consume the stream to avoid backpressure.
    if (part.type === 'file') {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _chunk of part.file) {
        // Drain the stream — artifact storage is CTRF-003 scope
      }
    }
  }

  if (!ctrfJson) return null;

  try {
    return JSON.parse(ctrfJson);
  } catch {
    return null; // Malformed JSON in the ctrf field — will fail Zod validation
  }
}

export default ingestPlugin;
