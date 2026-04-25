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

export default defineConfig({
  /** Entities will be added here as they are created in INFRA-004+ */
  entities: [],

  /** SQLite migrations live in their own directory */
  migrations: {
    path: './src/migrations/sqlite',
    pathTs: './src/migrations/sqlite',
  },

  /**
   * Default to an in-memory database for development/testing.
   * At runtime, `dbName` is overridden by `SQLITE_PATH`.
   */
  dbName: process.env['SQLITE_PATH'] ?? ':memory:',

  /** Enable debug logging in development */
  debug: process.env['NODE_ENV'] !== 'production',
});
