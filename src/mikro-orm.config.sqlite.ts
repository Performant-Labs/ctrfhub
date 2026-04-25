/**
 * MikroORM SQLite dialect configuration.
 *
 * Used by:
 * - The MikroORM CLI for `npm run migrate:create:sqlite` and `npm run migrate:sqlite`
 * - The runtime config (`mikro-orm.config.ts`) when `DATABASE_URL` is NOT set
 * - Integration tests via `buildApp({ db: ':memory:' })`
 *
 * Entities are shared with the Postgres config — only the driver and
 * migration path differ. Entity files must use only portable `p.*` types.
 *
 * @see skills/mikroorm-dual-dialect.md
 */

import { defineConfig } from '@mikro-orm/sqlite';
import { Organization } from './entities/Organization.js';
import { User } from './entities/User.js';
import { Project } from './entities/Project.js';
import { TestRun } from './entities/TestRun.js';
import { TestResult } from './entities/TestResult.js';
import { TestArtifact } from './entities/TestArtifact.js';

export default defineConfig({
  entities: [Organization, User, Project, TestRun, TestResult, TestArtifact],

  /** SQLite migrations live in their own directory */
  migrations: {
    path: './src/migrations/sqlite',
    pathTs: './src/migrations/sqlite',
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
    skipTables: ['organization', 'user', 'session', 'account', 'verification'],
  },

  /**
   * Default to an in-memory database for development/testing.
   * At runtime, `dbName` is overridden by `SQLITE_PATH`.
   */
  dbName: process.env['SQLITE_PATH'] ?? ':memory:',

  /** Enable debug logging in development */
  debug: process.env['NODE_ENV'] !== 'production',
});
