/**
 * S3ArtifactStorage — stub for future S3/MinIO-backed artifact storage.
 *
 * Every method throws NotImplementedError. This class exists only to
 * satisfy the type system and document the future interface. The real
 * implementation ships in a later story.
 *
 * @see src/lib/artifact-storage.ts — the interface this implements
 */

import type { ArtifactStorage, PutArtifactOptions, StoredArtifact } from './artifact-storage.js';

class NotImplementedError extends Error {
  constructor(method: string) {
    super(`S3ArtifactStorage.${method}() is not implemented — see future story`);
    this.name = 'NotImplementedError';
  }
}

export class S3ArtifactStorage implements ArtifactStorage {
  async put(_options: PutArtifactOptions): Promise<void> {
    throw new NotImplementedError('put');
  }

  async get(_key: string): Promise<StoredArtifact | null> {
    throw new NotImplementedError('get');
  }

  async delete(_key: string): Promise<void> {
    throw new NotImplementedError('delete');
  }

  async exists(_key: string): Promise<boolean> {
    throw new NotImplementedError('exists');
  }
}
