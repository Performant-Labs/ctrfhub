/**
 * LocalArtifactStorage — writes artifacts to a local filesystem directory.
 *
 * Default storage backend for single-node deployments and development.
 * Files are stored under `ARTIFACT_DIR` (default `./data/artifacts`)
 * using the hierarchical storage key as the path.
 *
 * @see src/lib/artifact-storage.ts — the interface this implements
 * @see skills/artifact-security-and-serving.md
 */

import { mkdir, readFile, unlink, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { ArtifactStorage, PutArtifactOptions, StoredArtifact } from './artifact-storage.js';

export class LocalArtifactStorage implements ArtifactStorage {
  private readonly baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? process.env['ARTIFACT_DIR'] ?? './data/artifacts';
  }

  async put(options: PutArtifactOptions): Promise<void> {
    const filePath = this.resolvePath(options.key);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, options.data);
  }

  async get(key: string): Promise<StoredArtifact | null> {
    const filePath = this.resolvePath(key);
    try {
      const data = await readFile(filePath);
      const ext = key.split('.').pop()?.toLowerCase() ?? '';
      const contentType = EXTENSION_MIME[ext] ?? 'application/octet-stream';
      return { key, data, contentType };
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    const filePath = this.resolvePath(key);
    try {
      await unlink(filePath);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    const filePath = this.resolvePath(key);
    try {
      await stat(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    // No resources to release for local FS storage
  }

  private resolvePath(key: string): string {
    // Prevent path traversal
    const normalised = key.replace(/\.\./g, '').replace(/\/\//g, '/');
    return join(this.baseDir, normalised);
  }
}

const EXTENSION_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  mp4: 'video/mp4',
  webm: 'video/webm',
  zip: 'application/zip',
  txt: 'text/plain',
  log: 'text/plain',
  html: 'text/html',
};
