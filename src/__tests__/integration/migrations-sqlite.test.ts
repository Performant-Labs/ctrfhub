/**
 * SQLite migration integration test — INFRA-004
 *
 * Initialises MikroORM with an in-memory SQLite database, runs all migrations,
 * and verifies the resulting schema matches entity expectations.
 *
 * Layer 2 (integration) — real ORM init, real migrations, real SQLite (in-memory).
 *
 * @see skills/vitest-three-layer-testing.md §Layer 2
 * @see skills/mikroorm-dual-dialect.md
 */

import { defineConfig, MikroORM } from '@mikro-orm/sqlite';
import { Migrator } from '@mikro-orm/migrations';
import { Organization } from '../../entities/Organization.js';
import { User } from '../../entities/User.js';
import { Project } from '../../entities/Project.js';
import { TestRun } from '../../entities/TestRun.js';
import { TestResult } from '../../entities/TestResult.js';
import { TestArtifact } from '../../entities/TestArtifact.js';

describe('SQLite migrations', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    // Build a self-contained config instead of importing the app config
    // to avoid issues with defineConfig return value spreading.
    orm = await MikroORM.init(defineConfig({
      entities: [Organization, User, Project, TestRun, TestResult, TestArtifact],
      dbName: ':memory:',
      debug: false,
      extensions: [Migrator],
      migrations: {
        path: './src/migrations/sqlite',
        pathTs: './src/migrations/sqlite',
        glob: '!(*.d).{js,ts}',
      },
      schemaGenerator: {
        skipTables: ['organization', 'user', 'session', 'account', 'verification'],
      },
    }));

    await orm.migrator.up();
  });

  afterAll(async () => {
    if (orm) await orm.close(true);
  });

  it('migrations apply cleanly without errors', async () => {
    expect(orm).toBeDefined();
    expect(await orm.isConnected()).toBe(true);
  });

  it('creates the projects table with expected columns', async () => {
    const connection = orm.em.getConnection();
    const result = await connection.execute("PRAGMA table_info('projects')");
    const columns = (result as Array<{ name: string }>).map((r) => r.name);

    expect(columns).toContain('id');
    expect(columns).toContain('organization_id');
    expect(columns).toContain('name');
    expect(columns).toContain('slug');
    expect(columns).toContain('id_prefix');
    expect(columns).toContain('base_url');
    expect(columns).toContain('retention_days');
    expect(columns).toContain('settings');
    expect(columns).toContain('created_at');
    expect(columns).toContain('updated_at');
  });

  it('creates the test_runs table with expected columns', async () => {
    const connection = orm.em.getConnection();
    const result = await connection.execute("PRAGMA table_info('test_runs')");
    const columns = (result as Array<{ name: string }>).map((r) => r.name);

    expect(columns).toContain('id');
    expect(columns).toContain('project_id');
    expect(columns).toContain('name');
    expect(columns).toContain('status');
    expect(columns).toContain('total_tests');
    expect(columns).toContain('passed');
    expect(columns).toContain('failed');
    expect(columns).toContain('skipped');
    expect(columns).toContain('blocked');
    expect(columns).toContain('ai_summary');
    expect(columns).toContain('ai_root_causes');
    expect(columns).toContain('created_at');
  });

  it('creates the test_results table with expected columns', async () => {
    const connection = orm.em.getConnection();
    const result = await connection.execute("PRAGMA table_info('test_results')");
    const columns = (result as Array<{ name: string }>).map((r) => r.name);

    expect(columns).toContain('id');
    expect(columns).toContain('test_run_id');
    expect(columns).toContain('test_name');
    expect(columns).toContain('status');
    expect(columns).toContain('duration_ms');
    expect(columns).toContain('error_message');
    expect(columns).toContain('stack_trace');
    expect(columns).toContain('ai_category');
    expect(columns).toContain('ai_category_override');
    expect(columns).toContain('flaky_score');
    expect(columns).toContain('error_hash');
    expect(columns).toContain('created_at');
  });

  it('creates the test_artifacts table with expected columns', async () => {
    const connection = orm.em.getConnection();
    const result = await connection.execute("PRAGMA table_info('test_artifacts')");
    const columns = (result as Array<{ name: string }>).map((r) => r.name);

    expect(columns).toContain('id');
    expect(columns).toContain('test_result_id');
    expect(columns).toContain('display_name');
    expect(columns).toContain('file_name');
    expect(columns).toContain('content_type');
    expect(columns).toContain('artifact_type');
    expect(columns).toContain('storage_type');
    expect(columns).toContain('storage_key');
    expect(columns).toContain('size_bytes');
    expect(columns).toContain('content_type_verified');
    expect(columns).toContain('created_at');
  });

  it('does NOT create Better Auth managed tables', async () => {
    const connection = orm.em.getConnection();
    const tables = await connection.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'mikro_orm_%' AND name NOT LIKE 'sqlite_%'"
    );
    const tableNames = (tables as Array<{ name: string }>).map((t) => t.name);

    expect(tableNames).not.toContain('organization');
    expect(tableNames).not.toContain('user');
    expect(tableNames).not.toContain('session');
    expect(tableNames).not.toContain('account');
    expect(tableNames).not.toContain('verification');
  });

  it('creates exactly 4 CTRFHub-owned tables', async () => {
    const connection = orm.em.getConnection();
    // Exclude internal SQLite tables (sqlite_sequence is created by autoincrement)
    // and MikroORM's own tracking tables.
    const tables = await connection.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'mikro_orm_%' AND name NOT LIKE 'sqlite_%'"
    );
    const tableNames = (tables as Array<{ name: string }>).map((t) => t.name);

    expect(tableNames).toContain('projects');
    expect(tableNames).toContain('test_runs');
    expect(tableNames).toContain('test_results');
    expect(tableNames).toContain('test_artifacts');
    expect(tableNames).toHaveLength(4);
  });

  it('projects.organization_id has a FK to organization', async () => {
    const connection = orm.em.getConnection();
    const fks = await connection.execute("PRAGMA foreign_key_list('projects')");
    const orgFk = (fks as Array<{ table: string; from: string }>).find(
      (fk) => fk.from === 'organization_id'
    );
    expect(orgFk).toBeDefined();
    expect(orgFk!.table).toBe('organization');
  });

  it('test_runs.project_id has a FK to projects', async () => {
    const connection = orm.em.getConnection();
    const fks = await connection.execute("PRAGMA foreign_key_list('test_runs')");
    const fk = (fks as Array<{ table: string; from: string }>).find(
      (fk) => fk.from === 'project_id'
    );
    expect(fk).toBeDefined();
    expect(fk!.table).toBe('projects');
  });

  it('test_results.test_run_id has a FK to test_runs', async () => {
    const connection = orm.em.getConnection();
    const fks = await connection.execute("PRAGMA foreign_key_list('test_results')");
    const fk = (fks as Array<{ table: string; from: string }>).find(
      (fk) => fk.from === 'test_run_id'
    );
    expect(fk).toBeDefined();
    expect(fk!.table).toBe('test_runs');
  });

  it('test_artifacts.test_result_id has a FK to test_results', async () => {
    const connection = orm.em.getConnection();
    const fks = await connection.execute("PRAGMA foreign_key_list('test_artifacts')");
    const fk = (fks as Array<{ table: string; from: string }>).find(
      (fk) => fk.from === 'test_result_id'
    );
    expect(fk).toBeDefined();
    expect(fk!.table).toBe('test_results');
  });
});
