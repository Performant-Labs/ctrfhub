/**
 * Ingest module — `POST /api/v1/projects/:slug/runs` route.
 *
 * Accepts CTRF JSON reports via `application/json` or `multipart/form-data`,
 * validates with Zod, persists TestRun + TestResult rows, and fires
 * `run.ingested` on the EventBus.
 *
 * When multipart, artifact files are co-uploaded alongside the CTRF JSON.
 * Each file part is validated (magic bytes, per-file size limit, per-run
 * total) before any bytes are written to storage.
 *
 * @see skills/ctrf-ingest-validation.md — canonical ingest contract
 * @see skills/fastify-route-convention.md — plugin pattern, service boundary
 * @see skills/zod-schema-first.md — CtrfReportSchema is the single source
 * @see skills/artifact-security-and-serving.md — magic bytes, size limits
 * @see docs/planning/database-design.md §DD-019 — idempotency policy
 */

import type { FastifyPluginAsync } from 'fastify';
import { ZodError, z } from 'zod';
import { IngestService, ReferenceOnlyError } from './service.js';
import { Project } from '../../entities/index.js';
import type { EventBus } from '../../services/event-bus.js';
import type { ArtifactStorage } from '../../lib/artifact-storage.js';
import { parseMaxJsonSize } from './size-limit.js';
import { validateMagicBytes, MAGIC_HEADER_SIZE } from '../../lib/magic-bytes.js';
import {
  checkFileSizeLimit,
  checkRunTotalLimit,
} from '../../lib/artifact-validation.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PRINTABLE_ASCII_RE = /^[\x20-\x7E]+$/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A buffered artifact file extracted from multipart. */
export interface BufferedArtifact {
  fieldName: string;
  data: Buffer;
  contentType: string;
  fileName: string;
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

const ingestPlugin: FastifyPluginAsync = async (fastify) => {
  const service = new IngestService();

  const maxJsonBytes = parseMaxJsonSize(process.env['MAX_CTRF_JSON_SIZE']);

  fastify.post('/api/v1/projects/:slug/runs', {
    bodyLimit: maxJsonBytes,

    config: {
      rateLimit: {
        max: 120,
        timeWindow: '1 hour',
        keyGenerator: (req: { headers: Record<string, string | string[] | undefined> }) => {
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
    const tokenProjectId = request.apiKeyUser.metadata?.['projectId'];
    if (tokenProjectId != null && Number(tokenProjectId) !== project.id) {
      return reply.status(403).send({
        error: 'API token is not scoped to this project',
        code: 'CROSS_PROJECT_TOKEN',
      });
    }

    // -- Parse CTRF body from JSON or multipart ---------------------------
    let rawCtrf: unknown;
    let artifactFiles: BufferedArtifact[] = [];
    const contentType = request.headers['content-type'] ?? '';

    if (contentType.includes('multipart/form-data')) {
      const parsed = await parseMultipartIngest(request);
      if (parsed.error) {
        const status = parsed.errorStatus ?? 422;
        return reply.status(status).send({
          error: parsed.error,
          code: parsed.errorCode ?? 'MULTIPART_ERROR',
        });
      }
      rawCtrf = parsed.ctrf;
      artifactFiles = parsed.files;
    } else {
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

    // -- Resolve DI seams -------------------------------------------------
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const eventBus = (fastify as any).eventBus as EventBus;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const artifactStorage = (fastify as any).artifactStorage as ArtifactStorage | undefined;

    // -- Delegate to service layer ----------------------------------------
    try {
      const result = await service.ingest(em, project, rawCtrf, {
        idempotencyKey: idempotencyKey ?? undefined,
        eventBus,
        artifactFiles,
        artifactStorage,
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
      if (error instanceof ReferenceOnlyError) {
        return reply.status(400).send({
          error: error.message,
          code: 'REFERENCE_ONLY_ARTIFACT',
        });
      }
      throw error;
    }
  });
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractIdempotencyKey(
  headers: Record<string, string | string[] | undefined>,
): string | null | false {
  const raw = headers['idempotency-key'];
  if (raw === undefined || raw === null) return null;

  const key = Array.isArray(raw) ? raw[0] : raw;
  if (!key) return null;

  if (key.length < 1 || key.length > 128) return false;
  if (!PRINTABLE_ASCII_RE.test(key)) return false;

  return key;
}

/** Result of parsing a multipart ingest request. */
interface MultipartParseResult {
  ctrf: unknown | null;
  files: BufferedArtifact[];
  error?: string;
  errorCode?: string;
  errorStatus?: number;
}

/**
 * Parse a multipart ingest request: extract the `ctrf` JSON field and
 * buffer all artifact file parts.
 *
 * Validates each file part inline:
 * - Magic-bytes check against declared Content-Type (→ 400)
 * - Per-file size limit (→ 413)
 * - Per-run cumulative size limit (→ 413)
 */
async function parseMultipartIngest(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  request: any,
): Promise<MultipartParseResult> {
  const parts = request.parts();
  let ctrfJson: string | null = null;
  const files: BufferedArtifact[] = [];
  let runTotalBytes = 0;

  for await (const part of parts) {
    if (part.type === 'field' && part.fieldname === 'ctrf') {
      ctrfJson = part.value as string;
      continue;
    }

    if (part.type === 'file') {
      const chunks: Buffer[] = [];
      for await (const chunk of part.file) {
        chunks.push(chunk as Buffer);
      }
      const data = Buffer.concat(chunks);
      const declaredType = part.mimetype ?? 'application/octet-stream';
      const fileName = part.filename ?? part.fieldname ?? 'unknown';

      // Per-file size limit check
      const fileSizeError = checkFileSizeLimit(declaredType, data.length);
      if (fileSizeError) {
        return {
          ctrf: null,
          files: [],
          error: fileSizeError,
          errorCode: 'ARTIFACT_FILE_TOO_LARGE',
          errorStatus: 413,
        };
      }

      // Per-run cumulative size check
      runTotalBytes += data.length;
      const runTotalError = checkRunTotalLimit(runTotalBytes);
      if (runTotalError) {
        return {
          ctrf: null,
          files: [],
          error: runTotalError,
          errorCode: 'ARTIFACT_RUN_TOTAL_TOO_LARGE',
          errorStatus: 413,
        };
      }

      // Magic-bytes validation
      const header = data.subarray(0, MAGIC_HEADER_SIZE);
      if (!validateMagicBytes(header, declaredType)) {
        return {
          ctrf: null,
          files: [],
          error: `Magic bytes do not match declared Content-Type "${declaredType}" for file "${fileName}"`,
          errorCode: 'ARTIFACT_MAGIC_BYTES_MISMATCH',
          errorStatus: 400,
        };
      }

      files.push({
        fieldName: part.fieldname,
        data,
        contentType: declaredType,
        fileName,
      });
    }
  }

  if (!ctrfJson) {
    return {
      ctrf: null,
      files: [],
      error: 'Missing "ctrf" field in multipart body',
      errorCode: 'MISSING_CTRF_FIELD',
      errorStatus: 422,
    };
  }

  try {
    const ctrf = JSON.parse(ctrfJson);
    return { ctrf, files };
  } catch {
    return {
      ctrf: null,
      files: [],
      error: 'Invalid JSON in "ctrf" field',
      errorCode: 'INVALID_CTRF_JSON',
      errorStatus: 422,
    };
  }
}

export default ingestPlugin;
