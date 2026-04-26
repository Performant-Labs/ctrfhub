/**
 * INFRA-005 schema-generator regression guards.
 *
 * Layer 1 (unit) tests — pure assertions, zero I/O.
 * Verifies that the migration-runner to schema-generator pivot didn't
 * leave stale code paths or config.
 *
 * @see skills/vitest-three-layer-testing.md §Layer 1
 * @see skills/mikroorm-dual-dialect.md
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('INFRA-005 schema-generator regression guards', () => {
  // ── Config guards ────────────────────────────────────────────────────

  it('PG config exports schemaGenerator (not migrations)', async () => {
    const pgModule = await import('../../mikro-orm.config.pg.js');
    const config = pgModule.default;
    expect(config).toHaveProperty('schemaGenerator');
    // The migrations key should not be present — schema-generator is the boot path
    expect(config).not.toHaveProperty('migrations');
  });

  it('SQLite config exports schemaGenerator (not migrations)', async () => {
    const sqliteModule = await import('../../mikro-orm.config.sqlite.js');
    const config = sqliteModule.default;
    expect(config).toHaveProperty('schemaGenerator');
    expect(config).not.toHaveProperty('migrations');
  });

  it('PG config does NOT skip organization table', async () => {
    const pgModule = await import('../../mikro-orm.config.pg.js');
    const config = pgModule.default as { schemaGenerator?: { skipTables?: string[] } };
    const skipTables = config.schemaGenerator?.skipTables ?? [];
    expect(skipTables).not.toContain('organization');
  });

  it('SQLite config does NOT skip organization table', async () => {
    const sqliteModule = await import('../../mikro-orm.config.sqlite.js');
    const config = sqliteModule.default as { schemaGenerator?: { skipTables?: string[] } };
    const skipTables = config.schemaGenerator?.skipTables ?? [];
    expect(skipTables).not.toContain('organization');
  });

  // ── Boot path guard ──────────────────────────────────────────────────

  it('app.ts does NOT import @mikro-orm/migrations', () => {
    // Read the source file and verify no migration imports exist.
    // This is a static analysis guard — prevents re-introducing the migrator.
    const appSource = readFileSync(
      resolve(import.meta.dirname!, '../../app.ts'),
      'utf-8',
    );
    expect(appSource).not.toMatch(/from\s+['"]@mikro-orm\/migrations/);
    expect(appSource).not.toMatch(/require\(['"]@mikro-orm\/migrations/);
  });

  it('app.ts calls orm.schema.update() (not migrator.up)', () => {
    const appSource = readFileSync(
      resolve(import.meta.dirname!, '../../app.ts'),
      'utf-8',
    );
    // Positive: schema.update() is in the source
    expect(appSource).toContain('orm.schema.update()');
    // Negative: migrator.up() must NOT appear as executable code.
    // Allow it in comments (the INFRA-005 comment says "replaces migrator.up()").
    // Split by lines — any non-comment line containing migrator.up() is a violation.
    const nonCommentLines = appSource
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*'));
    const hasMigratorCall = nonCommentLines.some((line) => line.includes('migrator.up()'));
    expect(hasMigratorCall).toBe(false);
  });

  // ── Package.json script guards ───────────────────────────────────────

  it('package.json has schema:emit:pg and schema:emit:sqlite scripts', () => {
    const pkg = JSON.parse(
      readFileSync(resolve(import.meta.dirname!, '../../../package.json'), 'utf-8'),
    ) as { scripts: Record<string, string> };

    expect(pkg.scripts).toHaveProperty('schema:emit:pg');
    expect(pkg.scripts).toHaveProperty('schema:emit:sqlite');
    expect(pkg.scripts['schema:emit:pg']).toContain('--dump');
    expect(pkg.scripts['schema:emit:sqlite']).toContain('--dump');
  });

  it('package.json has schema:update:pg and schema:update:sqlite scripts', () => {
    const pkg = JSON.parse(
      readFileSync(resolve(import.meta.dirname!, '../../../package.json'), 'utf-8'),
    ) as { scripts: Record<string, string> };

    expect(pkg.scripts).toHaveProperty('schema:update:pg');
    expect(pkg.scripts).toHaveProperty('schema:update:sqlite');
    expect(pkg.scripts['schema:update:pg']).toContain('--run');
    expect(pkg.scripts['schema:update:sqlite']).toContain('--run');
  });

  it('package.json does NOT have migrate:create scripts (deleted in INFRA-005)', () => {
    const pkg = JSON.parse(
      readFileSync(resolve(import.meta.dirname!, '../../../package.json'), 'utf-8'),
    ) as { scripts: Record<string, string> };

    expect(pkg.scripts).not.toHaveProperty('migrate:create:pg');
    expect(pkg.scripts).not.toHaveProperty('migrate:create:sqlite');
  });

  // ── Migrations directory guard ───────────────────────────────────────

  it('src/migrations/ directory does NOT exist', () => {
    let exists = true;
    try {
      readFileSync(resolve(import.meta.dirname!, '../../migrations/.gitkeep'));
    } catch {
      exists = false;
    }
    expect(exists).toBe(false);
  });
});
