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

export default defineConfig({
  /** Entities will be added here as they are created in INFRA-004+ */
  entities: [],

  /** PostgreSQL migrations live in their own directory */
  migrations: {
    path: './src/migrations/pg',
    pathTs: './src/migrations/pg',
  },

  /**
   * CLI-only: used when running `npm run migrate:create:pg`.
   * At runtime, `clientUrl` is overridden by `DATABASE_URL`.
   */
  clientUrl: process.env['DATABASE_URL'] ?? 'postgresql://ctrfhub:ctrfhub@localhost:5432/ctrfhub',

  /** Enable debug logging in development */
  debug: process.env['NODE_ENV'] !== 'production',
});
