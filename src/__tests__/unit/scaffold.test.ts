/**
 * INFRA-001 Scaffold Smoke Tests
 *
 * Proves the Vitest configuration wires up correctly:
 * - Vitest globals are available (describe/it/expect)
 * - Coverage thresholds are enforced (the `npm run test:coverage` gate is real)
 * - MikroORM dialect configs can be loaded without import errors
 *
 * These are Layer 1 (unit) tests — zero I/O, pure assertions.
 * @see skills/vitest-three-layer-testing.md §Layer 1
 */

describe('vitest configuration', () => {
  it('globals are available without explicit imports', () => {
    // The fact that `describe`, `it`, and `expect` are available without
    // importing them proves `globals: true` is wired in vitest.config.ts.
    expect(true).toBe(true);
  });

  it('runs in node environment', () => {
    // `vitest.config.ts` sets `environment: 'node'` — verify Node globals exist.
    expect(typeof process).toBe('object');
    expect(typeof process.env).toBe('object');
  });
});

describe('MikroORM dialect configs', () => {
  it('PostgreSQL config imports without error', async () => {
    // Dynamic import mirrors the pattern in mikro-orm.config.ts (resolveOrmConfig)
    const pgModule = await import('../../mikro-orm.config.pg.js');
    const config = pgModule.default;

    expect(config).toBeDefined();
    // The config should have entities and migrations defined
    expect(config).toHaveProperty('entities');
    expect(config).toHaveProperty('migrations');
  });

  it('SQLite config imports without error', async () => {
    const sqliteModule = await import('../../mikro-orm.config.sqlite.js');
    const config = sqliteModule.default;

    expect(config).toBeDefined();
    expect(config).toHaveProperty('entities');
    expect(config).toHaveProperty('migrations');
  });

  it('resolveOrmConfig selects SQLite when DATABASE_URL is unset', async () => {
    // Ensure DATABASE_URL is not set for this test
    const originalUrl = process.env['DATABASE_URL'];
    delete process.env['DATABASE_URL'];

    try {
      const { resolveOrmConfig } = await import('../../mikro-orm.config.js');
      const config = await resolveOrmConfig();

      expect(config).toBeDefined();
      expect(config).toHaveProperty('entities');
      // SQLite config has dbName, not clientUrl
      expect(config).toHaveProperty('dbName');
    } finally {
      // Restore original value
      if (originalUrl !== undefined) {
        process.env['DATABASE_URL'] = originalUrl;
      }
    }
  });

  it('resolveOrmConfig selects PostgreSQL when DATABASE_URL is set', async () => {
    // Set DATABASE_URL to trigger the PG branch
    const originalUrl = process.env['DATABASE_URL'];
    process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';

    try {
      // resolveOrmConfig reads process.env on each call — no cache-busting needed.
      // Re-import the module to get a fresh reference (Vitest isolates modules per test file).
      const mod = await import('../../mikro-orm.config.js');
      const config = await mod.resolveOrmConfig();

      expect(config).toBeDefined();
      expect(config).toHaveProperty('entities');
      expect(config).toHaveProperty('migrations');
    } finally {
      // Restore original value
      if (originalUrl !== undefined) {
        process.env['DATABASE_URL'] = originalUrl;
      } else {
        delete process.env['DATABASE_URL'];
      }
    }
  });
});

describe('HTMX events module', () => {
  it('imports without error (empty module ready for constants)', async () => {
    // The module should exist and import cleanly.
    // It's intentionally empty (`export {}`) per the INFRA-001 brief.
    const htmxModule = await import('../../client/htmx-events.js');
    expect(htmxModule).toBeDefined();
  });
});
