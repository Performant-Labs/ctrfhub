/**
 * ArtifactStorage — abstraction over artifact persistence backends.
 *
 * Implementations:
 * - `LocalArtifactStorage` (default) — writes files to a configurable local directory
 * - `S3ArtifactStorage` (optional)   — delegates to an S3-compatible object store
 * - `MemoryArtifactStorage` (test)   — in-memory Map; used in integration tests
 *
 * Every storage operation is keyed by a hierarchical `storageKey`
 * (e.g. `orgs/1/projects/7/runs/99/results/450/screenshot.png`).
 *
 * @see docs/planning/architecture.md §Artifact Storage
 * @see skills/artifact-security-and-serving.md
 */

import fs from 'node:fs/promises';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/**
 * Metadata about a stored artifact, returned by `get()`.
 */
export interface StoredArtifact {
  /** The storage key used to store/retrieve this artifact. */
  key: string;

  /** The raw file contents. */
  data: Buffer;

  /** MIME content type (e.g. "image/png", "video/webm"). */
  contentType: string;
}

/**
 * Options for storing an artifact via `put()`.
 */
export interface PutArtifactOptions {
  /** Hierarchical storage key (e.g. "orgs/1/projects/7/runs/99/..."). */
  key: string;

  /** Raw file contents to store. */
  data: Buffer;

  /** MIME content type (e.g. "image/png"). */
  contentType: string;
}

/**
 * Interface for artifact storage backends.
 *
 * Contract: all methods are async to support both local I/O and
 * remote object stores. Implementations must be safe for concurrent
 * access (multiple ingest requests writing different keys).
 */
export interface ArtifactStorage {
  /**
   * Store an artifact.
   *
   * If an artifact already exists at the given key, it is overwritten
   * (idempotent re-upload scenario).
   */
  put(options: PutArtifactOptions): Promise<void>;

  /**
   * Retrieve an artifact by its storage key.
   *
   * @returns The stored artifact, or `null` if not found.
   */
  get(key: string): Promise<StoredArtifact | null>;

  /**
   * Delete an artifact by its storage key.
   *
   * Silently succeeds if the key does not exist (idempotent).
   */
  delete(key: string): Promise<void>;

  /**
   * Check whether an artifact exists at the given key.
   */
  exists(key: string): Promise<boolean>;

  /**
   * Release any held resources (file handles, directory watchers).
   *
   * Called during application shutdown. No-ops for stateless backends.
   */
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// LocalArtifactStorage — writes to a local directory on disk
// ---------------------------------------------------------------------------

/**
 * File-system-backed artifact storage.
 *
 * Writes artifacts to `ARTIFACT_DIR` (default `./data/artifacts`) using the
 * hierarchical storage key as the relative file path. Creates parent
 * directories lazily on `put()`.
 *
 * @see docs/planning/architecture.md §Artifact Storage
 */
export class LocalArtifactStorage implements ArtifactStorage {
  private readonly rootDir: string;

  /**
   * @param rootDir - Base directory for artifact files.
   *   Defaults to `process.env.ARTIFACT_DIR ?? './data/artifacts'`.
   */
  constructor(rootDir?: string) {
    this.rootDir = rootDir ?? process.env['ARTIFACT_DIR'] ?? './data/artifacts';
  }

  async put(options: PutArtifactOptions): Promise<void> {
    const filePath = path.join(this.rootDir, options.key);
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, options.data);
  }

  async get(key: string): Promise<StoredArtifact | null> {
    const filePath = path.join(this.rootDir, key);
    try {
      const data = await fs.readFile(filePath);
      // Infer content type from file extension as a fallback.
      // In production the caller should store the content type alongside
      // the key (e.g., in the TestArtifact row).
      const ext = path.extname(filePath).toLowerCase();
      const contentType = CONTENT_TYPE_BY_EXT.get(ext) ?? 'application/octet-stream';
      return { key, data, contentType };
    } catch (err) {
      const errno = (err as NodeJS.ErrnoException).code;
      if (errno === 'ENOENT') return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    const filePath = path.join(this.rootDir, key);
    try {
      await fs.unlink(filePath);
    } catch (err) {
      const errno = (err as NodeJS.ErrnoException).code;
      if (errno === 'ENOENT') return; // Idempotent — silently succeed
      throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    const filePath = path.join(this.rootDir, key);
    try {
      const stat = await fs.stat(filePath);
      return stat.isFile();
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    // LocalArtifactStorage has no resources to release.
  }
}

// ---------------------------------------------------------------------------
// Content-type lookup by file extension (for LocalArtifactStorage.get())
// ---------------------------------------------------------------------------

const CONTENT_TYPE_BY_EXT = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'],
  ['.mp4', 'video/mp4'],
  ['.webm', 'video/webm'],
  ['.zip', 'application/zip'],
  ['.txt', 'text/plain'],
  ['.log', 'text/plain'],
  ['.json', 'application/json'],
  ['.html', 'text/html'],
  ['.xml', 'application/xml'],
  ['.pdf', 'application/pdf'],
]);
