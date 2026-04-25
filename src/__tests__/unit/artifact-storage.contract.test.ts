/**
 * ArtifactStorage contract tests — INFRA-004
 *
 * These tests verify the ArtifactStorage contract against the MemoryArtifactStorage
 * test double. The test structure is designed to be **reusable** — when a production
 * implementation (LocalArtifactStorage, S3ArtifactStorage) is built, it should pass
 * the same contract tests by swapping the factory function.
 *
 * Layer 1 (unit) — the MemoryArtifactStorage has zero I/O.
 *
 * @see src/lib/artifact-storage.ts — the interface under contract
 * @see skills/vitest-three-layer-testing.md §Interface-based test doubles
 */

import { MemoryArtifactStorage } from '../doubles/MemoryArtifactStorage.js';
import type { ArtifactStorage } from '../../lib/artifact-storage.js';

// ── Factory ──────────────────────────────────────────────────────────────────
// To reuse this file for a new implementation, replace this factory:
function createStorage(): ArtifactStorage & {
  storedCount(): number;
  has(key: string): boolean;
  keys(): string[];
  clear(): void;
} {
  return new MemoryArtifactStorage();
}

// ── Contract tests ───────────────────────────────────────────────────────────

describe('ArtifactStorage contract', () => {
  let storage: ReturnType<typeof createStorage>;

  beforeEach(() => {
    storage = createStorage();
  });

  // ── put / get round-trip ─────────────────────────────────────────────────

  it('put() then get() returns the stored artifact', async () => {
    const key = 'orgs/1/projects/2/runs/3/results/4/screenshot.png';
    const data = Buffer.from('fake-png-bytes');
    const contentType = 'image/png';

    await storage.put({ key, data, contentType });

    const result = await storage.get(key);
    expect(result).not.toBeNull();
    expect(result!.key).toBe(key);
    expect(result!.data).toEqual(data);
    expect(result!.contentType).toBe(contentType);
  });

  it('put() overwrites existing artifact at same key (idempotent re-upload)', async () => {
    const key = 'orgs/1/projects/2/runs/3/results/4/trace.zip';
    const originalData = Buffer.from('original');
    const updatedData = Buffer.from('updated');

    await storage.put({ key, data: originalData, contentType: 'application/zip' });
    await storage.put({ key, data: updatedData, contentType: 'application/zip' });

    const result = await storage.get(key);
    expect(result).not.toBeNull();
    expect(result!.data).toEqual(updatedData);
  });

  // ── get (missing) ───────────────────────────────────────────────────────

  it('get() returns null for a key that was never stored', async () => {
    const result = await storage.get('does/not/exist.txt');
    expect(result).toBeNull();
  });

  // ── delete ──────────────────────────────────────────────────────────────

  it('delete() removes a previously stored artifact', async () => {
    const key = 'orgs/1/projects/2/runs/3/results/4/log.txt';
    await storage.put({ key, data: Buffer.from('log content'), contentType: 'text/plain' });

    await storage.delete(key);

    const result = await storage.get(key);
    expect(result).toBeNull();
  });

  it('delete() is idempotent — silently succeeds for non-existent key', async () => {
    // Should not throw
    await expect(storage.delete('never/existed.txt')).resolves.toBeUndefined();
  });

  // ── exists ──────────────────────────────────────────────────────────────

  it('exists() returns true for a stored artifact', async () => {
    const key = 'orgs/1/projects/2/runs/3/results/4/video.webm';
    await storage.put({ key, data: Buffer.from('video'), contentType: 'video/webm' });

    expect(await storage.exists(key)).toBe(true);
  });

  it('exists() returns false for a non-existent key', async () => {
    expect(await storage.exists('does/not/exist.webm')).toBe(false);
  });

  it('exists() returns false after delete()', async () => {
    const key = 'orgs/1/projects/2/runs/3/results/4/deleted.png';
    await storage.put({ key, data: Buffer.from('data'), contentType: 'image/png' });
    await storage.delete(key);

    expect(await storage.exists(key)).toBe(false);
  });

  // ── Multiple artifacts ─────────────────────────────────────────────────

  it('stores multiple artifacts under different keys', async () => {
    const keys = ['a/1.png', 'b/2.txt', 'c/3.zip'];
    for (const key of keys) {
      await storage.put({ key, data: Buffer.from(key), contentType: 'application/octet-stream' });
    }

    for (const key of keys) {
      expect(await storage.exists(key)).toBe(true);
      const result = await storage.get(key);
      expect(result).not.toBeNull();
      expect(result!.data).toEqual(Buffer.from(key));
    }
  });
});

// ── Assertion helper tests (MemoryArtifactStorage-specific) ───────────────

describe('MemoryArtifactStorage assertion helpers', () => {
  let storage: MemoryArtifactStorage;

  beforeEach(() => {
    storage = new MemoryArtifactStorage();
  });

  it('storedCount() returns 0 on empty storage', () => {
    expect(storage.storedCount()).toBe(0);
  });

  it('storedCount() reflects number of stored artifacts', async () => {
    await storage.put({ key: 'a.png', data: Buffer.from('a'), contentType: 'image/png' });
    await storage.put({ key: 'b.png', data: Buffer.from('b'), contentType: 'image/png' });
    expect(storage.storedCount()).toBe(2);
  });

  it('has() returns correct boolean', async () => {
    await storage.put({ key: 'exists.png', data: Buffer.from('x'), contentType: 'image/png' });
    expect(storage.has('exists.png')).toBe(true);
    expect(storage.has('missing.png')).toBe(false);
  });

  it('keys() returns all stored keys', async () => {
    await storage.put({ key: 'a.png', data: Buffer.from('a'), contentType: 'image/png' });
    await storage.put({ key: 'b.txt', data: Buffer.from('b'), contentType: 'text/plain' });
    expect(storage.keys()).toEqual(expect.arrayContaining(['a.png', 'b.txt']));
    expect(storage.keys()).toHaveLength(2);
  });

  it('clear() removes all artifacts', async () => {
    await storage.put({ key: 'a.png', data: Buffer.from('a'), contentType: 'image/png' });
    await storage.put({ key: 'b.png', data: Buffer.from('b'), contentType: 'image/png' });

    storage.clear();

    expect(storage.storedCount()).toBe(0);
    expect(storage.has('a.png')).toBe(false);
    expect(storage.keys()).toHaveLength(0);
  });
});
