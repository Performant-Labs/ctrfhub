/**
 * Artifact validation — per-file size limits, per-run total enforcement,
 * and artifact-type classification from MIME content types.
 *
 * @see skills/artifact-security-and-serving.md §Per-file size limits
 * @see skills/ctrf-ingest-validation.md §Multipart uploads
 */

import { parseMaxJsonSize } from '../modules/ingest/size-limit.js';

// ---------------------------------------------------------------------------
// Per-file size limits (bytes)
// ---------------------------------------------------------------------------

const SIZE_LIMITS: Record<string, number> = {
  image: 10 * 1024 * 1024,       // 10 MB
  video: 100 * 1024 * 1024,      // 100 MB
  archive: 200 * 1024 * 1024,    // 200 MB
  log: 5 * 1024 * 1024,          // 5 MB
};

const DEFAULT_FILE_LIMIT = 5 * 1024 * 1024; // 5 MB fallback

// ---------------------------------------------------------------------------
// Per-run total limit
// ---------------------------------------------------------------------------

const DEFAULT_MAX_PER_RUN = 500 * 1024 * 1024; // 500 MB (brief says 500 MB default)

/**
 * Resolve the per-run artifact size limit from the environment.
 * Reads `MAX_ARTIFACT_SIZE_PER_RUN` (supports human-readable sizes like "500mb").
 */
export function getMaxArtifactSizePerRun(): number {
  return parseMaxJsonSize(process.env['MAX_ARTIFACT_SIZE_PER_RUN']) || DEFAULT_MAX_PER_RUN;
}

// ---------------------------------------------------------------------------
// Artifact type classification
// ---------------------------------------------------------------------------

/**
 * Classify a MIME content type into an artifact type string.
 *
 * Used for:
 * - Selecting the correct per-file size limit
 * - Setting `TestArtifact.artifactType`
 */
export function classifyArtifactType(contentType: string): string {
  const ct = contentType.toLowerCase().split(';')[0]!.trim();

  if (ct.startsWith('image/')) return 'image';
  if (ct.startsWith('video/')) return 'video';
  if (ct === 'application/zip') return 'archive';
  if (ct === 'text/plain') return 'log';

  // HTML reports, traces, etc.
  if (ct === 'text/html') return 'report';
  if (ct.startsWith('application/')) return 'archive';

  return 'log';
}

/**
 * Get the per-file size limit for the given content type.
 */
export function getFileSizeLimit(contentType: string): number {
  const type = classifyArtifactType(contentType);
  return SIZE_LIMITS[type] ?? DEFAULT_FILE_LIMIT;
}

/**
 * Check whether a single file exceeds its per-file size limit.
 *
 * @returns An error message if exceeded, or `null` if within limits.
 */
export function checkFileSizeLimit(
  contentType: string,
  sizeBytes: number,
): string | null {
  const limit = getFileSizeLimit(contentType);
  if (sizeBytes > limit) {
    const type = classifyArtifactType(contentType);
    const limitMB = Math.round(limit / (1024 * 1024));
    return `${type} artifact exceeds ${limitMB} MB limit (got ${Math.round(sizeBytes / (1024 * 1024))} MB)`;
  }
  return null;
}

/**
 * Check whether the running total of artifact bytes for a run exceeds the per-run limit.
 *
 * @returns An error message if exceeded, or `null` if within limits.
 */
export function checkRunTotalLimit(
  totalBytes: number,
): string | null {
  const limit = getMaxArtifactSizePerRun();
  if (totalBytes > limit) {
    const limitMB = Math.round(limit / (1024 * 1024));
    return `Total artifact size exceeds per-run limit of ${limitMB} MB`;
  }
  return null;
}
