/**
 * MemoryArtifactStorage — in-memory test double for the ArtifactStorage interface.
 *
 * Used in integration tests via `buildApp({ artifactStorage: new MemoryArtifactStorage() })`.
 * Stores artifacts in a Map keyed by storage key. Provides additional assertion
 * helpers (`.storedCount()`, `.has(key)`, `.keys()`) for test verification.
 *
 * This class implements the same contract that a production `LocalArtifactStorage`
 * or `S3ArtifactStorage` would. The contract test file
 * (`artifact-storage.contract.test.ts`) can be reused for any implementation.
 *
 * @see src/lib/artifact-storage.ts — the interface this implements
 * @see skills/vitest-three-layer-testing.md §Interface-based test doubles
 */

import type { ArtifactStorage, PutArtifactOptions, StoredArtifact } from '../../lib/artifact-storage.js';

interface StoredEntry {
  data: Buffer;
  contentType: string;
}

/**
 * In-memory artifact storage for testing.
 *
 * All operations are synchronous under the hood but return Promises
 * to match the ArtifactStorage interface contract.
 */
export class MemoryArtifactStorage implements ArtifactStorage {
  /** Internal storage map: key → { data, contentType } */
  private readonly store = new Map<string, StoredEntry>();

  async put(options: PutArtifactOptions): Promise<void> {
    this.store.set(options.key, {
      data: options.data,
      contentType: options.contentType,
    });
  }

  async get(key: string): Promise<StoredArtifact | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    return { key, data: entry.data, contentType: entry.contentType };
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.store.has(key);
  }

  /** No-op close — required by `AppOptions.artifactStorage` shutdown hook. */
  async close(): Promise<void> {
    // nothing to release
  }

  // ── Assertion helpers (test-only) ─────────────────────────────

  /** Number of artifacts currently stored. */
  storedCount(): number {
    return this.store.size;
  }

  /** Whether an artifact exists at the given key. Synchronous for test assertions. */
  has(key: string): boolean {
    return this.store.has(key);
  }

  /** All storage keys currently held. */
  keys(): string[] {
    return [...this.store.keys()];
  }

  /** Clear all stored artifacts. Useful in beforeEach() cleanup. */
  clear(): void {
    this.store.clear();
  }
}
