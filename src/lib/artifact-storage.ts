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
}
