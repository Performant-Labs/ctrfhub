/**
 * MikroORM PostgreSQL dialect configuration.
 *
 * Used by:
 * - The MikroORM CLI for `npm run migrate:create:pg` and `npm run migrate:pg`
 * - The runtime config (`mikro-orm.config.ts`) when `DATABASE_URL` is set
 *
 * Entities are shared with the SQLite config — only the driver and
 * migration path differ. Entity files must use only portable `p.*` types.
 *
 * @see skills/mikroorm-dual-dialect.md
 */

import { defineConfig } from '@mikro-orm/postgresql';
import { Organization } from './entities/Organization.js';
import { User } from './entities/User.js';
import { Project } from './entities/Project.js';
import { TestRun } from './entities/TestRun.js';
import { TestResult } from './entities/TestResult.js';
import { TestArtifact } from './entities/TestArtifact.js';
import { IngestIdempotencyKey } from './entities/IngestIdempotencyKey.js';

export default defineConfig({
  entities: [Organization, User, Project, TestRun, TestResult, TestArtifact, IngestIdempotencyKey],

  /** PostgreSQL migrations live in their own directory */
  migrations: {
    path: './src/migrations/pg',
    pathTs: './src/migrations/pg',
    glob: '!(*.d).{js,ts}',
  },

  /**
   * Better Auth manages its own tables — exclude them from migration generation.
   * CTRFHub entities for Organization and User exist only for ORM relationship
   * mapping; the actual DDL is handled by Better Auth's migration tooling.
   *
   * @see docs/planning/database-design.md §4 (Better Auth note)
   */
  schemaGenerator: {
    /**
     * Better Auth manages its own tables — exclude them from migration generation.
     * `apikey` was added in AUTH-001 when the @better-auth/api-key plugin landed.
     */
    skipTables: ['organization', 'user', 'session', 'account', 'verification', 'apikey'],
  },

  /**
   * CLI-only: used when running `npm run migrate:create:pg`.
   * At runtime, `clientUrl` is overridden by `DATABASE_URL`.
   */
  clientUrl: process.env['DATABASE_URL'] ?? 'postgresql://ctrfhub:ctrfhub@localhost:5432/ctrfhub',

  /** Enable debug logging in development */
  debug: process.env['NODE_ENV'] !== 'production',
});
