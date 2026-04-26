/**
 * MAX_CTRF_JSON_SIZE parser — converts human-readable size strings
 * (e.g. "10mb") to bytes for Fastify's `bodyLimit`.
 *
 * @see docs/planning/deployment-architecture.md §MAX_CTRF_JSON_SIZE
 * @see docs/planning/parking-lot.md §PL-003
 */

/** Default max CTRF JSON size: 10 MB. */
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Parse a human-readable size string (e.g. "10mb", "5kb") into bytes.
 *
 * Supported suffixes: `b`, `kb`, `mb`, `gb` (case-insensitive).
 * Returns `DEFAULT_MAX_BYTES` (10 MB) if the input is undefined,
 * empty, or unparseable.
 *
 * @param value - The size string from `process.env.MAX_CTRF_JSON_SIZE`.
 * @returns Size in bytes.
 */
export function parseMaxJsonSize(value: string | undefined): number {
  if (!value) return DEFAULT_MAX_BYTES;

  const trimmed = value.trim().toLowerCase();
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/);
  if (!match) return DEFAULT_MAX_BYTES;

  const num = parseFloat(match[1]!);
  const unit = match[2] ?? 'b';

  switch (unit) {
    case 'b':
      return Math.floor(num);
    case 'kb':
      return Math.floor(num * 1024);
    case 'mb':
      return Math.floor(num * 1024 * 1024);
    case 'gb':
      return Math.floor(num * 1024 * 1024 * 1024);
    default:
      return DEFAULT_MAX_BYTES;
  }
}
