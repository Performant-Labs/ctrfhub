/**
 * Magic-bytes validation — verifies that a file's leading bytes match
 * its declared Content-Type.
 *
 * The table covers the artifact types accepted by CTRF ingest:
 * PNG, JPEG, MP4, ZIP. Text/plain has no magic signature — it is
 * accepted if no other signature matches (and the claim is text/plain).
 *
 * @see skills/artifact-security-and-serving.md §At ingest — validate before storing
 * @see skills/ctrf-ingest-validation.md §Multipart uploads
 */

/** Minimum header bytes needed for all checks (MP4 needs offset 4–7). */
export const MAGIC_HEADER_SIZE = 12;

interface MagicSignature {
  bytes: number[];
  offset: number;
}

const SIGNATURES: Record<string, MagicSignature[]> = {
  'image/png': [{ bytes: [0x89, 0x50, 0x4e, 0x47], offset: 0 }],
  'image/jpeg': [{ bytes: [0xff, 0xd8, 0xff], offset: 0 }],
  'video/mp4': [{ bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 }],
  'application/zip': [{ bytes: [0x50, 0x4b, 0x03, 0x04], offset: 0 }],
};

/**
 * Content types that have a verifiable magic-byte signature.
 */
const VERIFIABLE_TYPES = new Set(Object.keys(SIGNATURES));

/**
 * Detect the actual content type from the file's leading bytes.
 *
 * @returns The detected MIME type, or `null` if no signature matched.
 */
export function detectContentType(header: Buffer): string | null {
  for (const [mimeType, sigs] of Object.entries(SIGNATURES)) {
    for (const sig of sigs) {
      if (header.length < sig.offset + sig.bytes.length) continue;
      const match = sig.bytes.every(
        (byte, i) => header[sig.offset + i] === byte,
      );
      if (match) return mimeType;
    }
  }
  return null;
}

/**
 * Validate that a file's leading bytes match its declared Content-Type.
 *
 * Rules:
 * - If the declared type has a known magic signature, the bytes must match.
 * - If the declared type is `text/plain`, it must NOT match any binary signature.
 * - If the declared type has no known signature (and isn't text/plain),
 *   it is accepted without byte-level verification.
 *
 * @returns `true` if valid, `false` if the magic bytes contradict the claim.
 */
export function validateMagicBytes(
  header: Buffer,
  declaredContentType: string,
): boolean {
  const normalised = declaredContentType.toLowerCase().split(';')[0]!.trim();

  if (VERIFIABLE_TYPES.has(normalised)) {
    const detected = detectContentType(header);
    return detected === normalised;
  }

  if (normalised === 'text/plain') {
    const detected = detectContentType(header);
    return detected === null;
  }

  // Unknown type with no signature — accept (contentTypeVerified = false on the row)
  return true;
}

/**
 * Whether the declared content type has a known magic-byte signature.
 */
export function hasKnownSignature(contentType: string): boolean {
  const normalised = contentType.toLowerCase().split(';')[0]!.trim();
  return VERIFIABLE_TYPES.has(normalised) || normalised === 'text/plain';
}
