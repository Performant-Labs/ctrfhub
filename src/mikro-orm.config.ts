/**
 * MikroORM base configuration — runtime dialect selector.
 *
 * Reads `DATABASE_URL` (Postgres) or `SQLITE_PATH` (SQLite) from the
 * environment to pick the correct driver at startup. This file is the
 * entry point used by the application at boot; the dialect-specific
 * configs (`mikro-orm.config.pg.ts`, `mikro-orm.config.sqlite.ts`) are
 * used only by the MikroORM CLI for migration generation.
 *
 * @see skills/mikroorm-dual-dialect.md
 */

/**
 * Determines whether to use PostgreSQL or SQLite based on env vars.
 * Dynamically imports and returns the appropriate dialect config.
 *
 * At runtime the returned config is passed directly to `MikroORM.init()`.
 * The dialect-specific configs are self-contained — this function only
 * selects between them and overrides connection-specific values.
 */
export async function resolveOrmConfig() {
  const databaseUrl = process.env['DATABASE_URL'];

  if (databaseUrl) {
    // PostgreSQL — override clientUrl with the actual connection string
    const { default: pgConfig } = await import('./mikro-orm.config.pg.js');
    return pgConfig;
  }

  // SQLite (default for single-node / dev / test)
  const { default: sqliteConfig } = await import('./mikro-orm.config.sqlite.js');
  return sqliteConfig;
}

export default resolveOrmConfig;
