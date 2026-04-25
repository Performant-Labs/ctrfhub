/**
 * IngestIdempotencyKey entity — maps a client-supplied `Idempotency-Key`
 * header to the `test_runs` row it produced.
 *
 * Short-lived (24h TTL, pruned by nightly sweep). Exists solely to handle
 * the "CI retried the HTTP POST on a network blip" case.
 *
 * CTRFHub-owned: this table IS created by CTRFHub migrations.
 *
 * @see docs/planning/database-design.md §4.23
 * @see skills/ctrf-ingest-validation.md §Idempotency key
 * @see skills/mikroorm-dual-dialect.md — portable types only
 */

import { defineEntity, p } from '@mikro-orm/core';
import { ProjectSchema } from './Project.js';
import { TestRunSchema } from './TestRun.js';

const IngestIdempotencyKeySchema = defineEntity({
  name: 'IngestIdempotencyKey',
  tableName: 'ingest_idempotency_keys',
  properties: {
    id:              p.integer().primary(),
    project:         () => p.manyToOne(ProjectSchema),
    idempotencyKey:  p.string().length(128),
    testRun:         () => p.manyToOne(TestRunSchema),
    createdAt:       p.datetime().defaultRaw('CURRENT_TIMESTAMP'),
  },
  // Note: UNIQUE (project_id, idempotency_key) is enforced in the migration
  // DDL. MikroORM v7's defineEntity() doesn't support a top-level `indexes`
  // option — composite unique constraints are expressed in migrations.
});

/**
 * IngestIdempotencyKey entity class.
 */
export class IngestIdempotencyKey extends IngestIdempotencyKeySchema.class {}
IngestIdempotencyKeySchema.setClass(IngestIdempotencyKey);

export { IngestIdempotencyKeySchema };
