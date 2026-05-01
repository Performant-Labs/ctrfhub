/**
 * Artifact validation helpers — per-file and per-run size limits, content-type
 * allow-lists, and error responses.
 *
 * @see skills/artifact-security-and-serving.md — Per-file size limits
 * @see skills/ctrf-ingest-validation.md — artifact co-upload validation
 */

import { classifyContentType } from './magic-bytes.js';

// ---------------------------------------------------------------------------
// Per-file size limits (in bytes)
// ---------------------------------------------------------------------------

/**
 * Maximum allowed size per artifact file, categorized by content type.
 *
 * | Category | Limit |
 *|----------|-------|
 *| Image    | 10 MB |
 *| Video    | 100 MB |
 *| ZIP      | 200 MB |
 *| Log      | 5 MB  |
 *
 * @see skills/artifact-security-and-serving.md — Per-file size limits
 */
const PER_FILE_LIMITS: Record<'image' | 'video' | 'zip' | 'log', number> = {
  image: 10 * 1024 * 1024,    // 10 MB
  video: 100 * 1024 * 1024,   // 100 MB
  zip:   200 * 1024 * 1024,   // 200 MB
  log:   5 * 1024 * 1024,     // 5 MB
};

/** Default per-run total artifact size limit: 500 MB. */
const DEFAULT_MAX_RUN_TOTAL = 500 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Limit lookup
// ---------------------------------------------------------------------------

/**
 * Get the per-file size limit for a given Content-Type.
 *
 * @param contentType - The MIME type of the artifact.
 * @returns Maximum allowed file size in bytes.
 */
export function getPerFileLimit(contentType: string): number {
  const category = classifyContentType(contentType);
  return PER_FILE_LIMITS[category];
}

/**
 * Parse the per-run total artifact size limit from the environment.
 *
 * Reads `MAX_ARTIFACT_SIZE_PER_RUN` as a byte count. Accepts plain numbers
 * (bytes) or human-readable suffixes (K, M, G). Defaults to 500 MB.
 *
 * @param envValue - The raw environment variable value, or `undefined`.
 * @returns The limit in bytes.
 */
export function parseMaxArtifactSizePerRun(envValue: string | undefined): number {
  if (envValue === undefined || envValue === '') {
    return DEFAULT_MAX_RUN_TOTAL;
  }

  const trimmed = envValue.trim().toUpperCase();

  // Try human-readable suffixes first
  const suffixMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*([KMG]?)B?$/);
  if (suffixMatch) {
    const value = parseFloat(suffixMatch[1] ?? '0');
    const suffix = suffixMatch[2] ?? '';
    switch (suffix) {
      case 'K':
        return Math.floor(value * 1024);
      case 'M':
        return Math.floor(value * 1024 * 1024);
      case 'G':
        return Math.floor(value * 1024 * 1024 * 1024);
      default:
        return Math.floor(value);
    }
  }

  // Plain number (bytes)
  const plain = Number(trimmed);
  if (Number.isFinite(plain) && plain > 0) {
    return plain;
  }

  return DEFAULT_MAX_RUN_TOTAL;
}

// ---------------------------------------------------------------------------
// Validation functions
// ---------------------------------------------------------------------------

/**
 * Validate a single artifact's size against its per-file limit.
 *
 * @param sizeBytes - The file size in bytes.
 * @param contentType - The declared Content-Type.
 * @returns `null` if within limits, or an error description if exceeded.
 */
export function validateFileSize(
  sizeBytes: number,
  contentType: string,
): string | null {
  const limit = getPerFileLimit(contentType);
  if (sizeBytes > limit) {
    return `Artifact exceeds per-file size limit for ${contentType}: ${sizeBytes} > ${limit} bytes`;
  }
  return null;
}

/**
 * Validate the running total of artifact sizes against the per-run limit.
 *
 * @param currentTotal - The cumulative size of all artifacts accepted so far this run.
 * @param newFileSize - The size of the new artifact being added.
 * @param maxRunTotal - The configured per-run total limit.
 * @returns `null` if within limits, or an error description if exceeded.
 */
export function validateRunTotal(
  currentTotal: number,
  newFileSize: number,
  maxRunTotal: number,
): string | null {
  if (currentTotal + newFileSize > maxRunTotal) {
    return `Artifact would exceed per-run total size limit: ${currentTotal + newFileSize} > ${maxRunTotal} bytes`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// External URL detection
// ---------------------------------------------------------------------------

/**
 * Check whether a path string is an external URL (http:// or https://).
 *
 * External-URL attachments are stored by reference only — no file body
 * should be uploaded for them.
 *
 * @param path - The attachment path from the CTRF JSON.
 * @returns `true` if the path is an HTTP(S) URL.
 */
export function isExternalUrl(path: string): boolean {
  return path.startsWith('http://') || path.startsWith('https://');
}
