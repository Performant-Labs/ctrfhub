/**
 * TestArtifact entity — files associated with a test result.
 *
 * Supports screenshots, videos, traces, logs, HTML reports, and external
 * URL references. Backed by the ArtifactStorage interface — local disk for
 * MVP, S3-compatible for scale-out.
 *
 * CTRFHub-owned: this table IS created by CTRFHub migrations.
 *
 * @see docs/planning/database-design.md §4.6
 * @see skills/artifact-security-and-serving.md
 * @see skills/mikroorm-dual-dialect.md — portable types only
 */

import { defineEntity, p } from '@mikro-orm/core';
import { TestResultSchema } from './TestResult.js';

const TestArtifactSchema = defineEntity({
  name: 'TestArtifact',
  tableName: 'test_artifacts',
  properties: {
    id:                   p.integer().primary(),
    testResult:           () => p.manyToOne(TestResultSchema),
    displayName:          p.string().length(255),
    fileName:             p.string().length(500).nullable(),
    contentType:          p.string().length(100),
    artifactType:         p.string().length(20),
    storageType:          p.string().length(10),
    storageKey:           p.string().length(1000),
    referenceUrl:         p.string().length(2048).nullable(),
    sizeBytes:            p.integer().nullable(),
    contentTypeVerified:  p.boolean().default(true),
    createdAt:            p.datetime().defaultRaw('CURRENT_TIMESTAMP'),
  },
});

/**
 * TestArtifact entity class.
 *
 * Domain methods can be added here as needed by downstream stories.
 */
export class TestArtifact extends TestArtifactSchema.class {
  /**
   * Whether this artifact is an external URL reference (not a stored file).
   */
  get isExternalUrl(): boolean {
    return this.storageType === 'url';
  }

  /**
   * Whether this artifact's content type was verified via magic-bytes check.
   */
  get isVerified(): boolean {
    return this.contentTypeVerified;
  }
}
TestArtifactSchema.setClass(TestArtifact);

export { TestArtifactSchema };
