/**
 * Magic-bytes validation for uploaded artifact files.
 *
 * Reads the first 16 bytes of an uploaded file and verifies the magic bytes
 * match the declared Content-Type. Rejects mismatched uploads so adversarial
 * content (e.g., a script disguised as a PNG) is caught before storage.
 *
 * @see skills/artifact-security-and-serving.md — magic-bytes validation rules
 * @see skills/ctrf-ingest-validation.md — artifact co-upload validation
 */

// ---------------------------------------------------------------------------
// Magic-byte signatures
// ---------------------------------------------------------------------------

/**
 * Known magic-byte patterns for the content types we accept.
 *
 * Each entry maps a Content-Type to the expected byte sequence (as a hex
 * string, spaces optional). For video/mp4 the magic starts at offset 4.
 *
 * @see https://en.wikipedia.org/wiki/List_of_file_signatures
 */
const MAGIC_SIGNATURES: ReadonlyMap<string, { bytes: number[]; offset?: number }> =
  new Map([
    ['image/png', { bytes: [0x89, 0x50, 0x4e, 0x47] }],
    ['image/jpeg', { bytes: [0xff, 0xd8, 0xff] }],
    ['video/mp4', { bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 }],
    ['application/zip', { bytes: [0x50, 0x4b, 0x03, 0x04] }],
  ]);

// ---------------------------------------------------------------------------
// Type classification helpers
// ---------------------------------------------------------------------------

/**
 * Classify a Content-Type into an artifact category for size-limit purposes.
 *
 * @returns The category: 'image', 'video', 'zip', or 'log'.
 */
export function classifyContentType(contentType: string): 'image' | 'video' | 'zip' | 'log' {
  const ct = contentType.toLowerCase();
  if (ct.startsWith('image/')) return 'image';
  if (ct.startsWith('video/')) return 'video';
  if (ct === 'application/zip') return 'zip';
  return 'log';
}

// ---------------------------------------------------------------------------
// Core validation
// ---------------------------------------------------------------------------

/**
 * Validate that the first bytes of a file match its declared Content-Type.
 *
 * For known types (PNG, JPEG, MP4, ZIP), checks the magic bytes against
 * the signature table. For unknown types (e.g., text/plain), accepts the
 * file but marks it as unverified — the caller should still enforce size
 * limits.
 *
 * Returns `false` if the magic bytes do NOT match the declared type
 * (i.e., the file is lying about what it is).
 *
 * @param headerBytes - The first 16 bytes of the file (must be ≥ 4 bytes).
 * @param declaredContentType - The Content-Type claimed by the uploader.
 * @returns `true` if the magic bytes are consistent with the declared type.
 */
export function validateMagicBytes(
  headerBytes: Uint8Array,
  declaredContentType: string,
): boolean {
  if (headerBytes.length < 4) {
    // Too small to carry a meaningful signature — treat as mismatch
    // for known types; accept for unknown types.
    return !MAGIC_SIGNATURES.has(declaredContentType.toLowerCase());
  }

  const signature = MAGIC_SIGNATURES.get(declaredContentType.toLowerCase());
  if (!signature) {
    // Unknown type — accept (e.g., text/plain logs have no magic).
    return true;
  }

  const offset = signature.offset ?? 0;
  for (let i = 0; i < signature.bytes.length; i++) {
    if (headerBytes[offset + i] !== signature.bytes[i]) {
      return false;
    }
  }

  return true;
}

/**
 * Read the first `length` bytes from a Node.js readable stream.
 *
 * Used to extract the magic-byte header from multipart file parts without
 * consuming the entire stream.
 *
 * @param stream - The readable stream to read from.
 * @param length - Number of bytes to read (default 16).
 * @returns A promise resolving to the header bytes.
 */
export async function readHeaderBytes(
  stream: AsyncIterable<Buffer>,
  length: number = 16,
): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of stream) {
    chunks.push(chunk);
    total += chunk.length;
    if (total >= length) break;
  }

  return Buffer.concat(chunks).subarray(0, length);
}
