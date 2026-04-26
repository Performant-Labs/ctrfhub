/**
 * SQLite schema-generator integration test — INFRA-005
 *
 * Initialises MikroORM with an in-memory SQLite database, runs
 * `orm.schema.update()`, and verifies the resulting schema matches
 * entity expectations. Replaces the migration-based test from INFRA-004.
 *
 * Layer 2 (integration) — real ORM init, real schema-generator, real SQLite (in-memory).
 *
 * @see skills/vitest-three-layer-testing.md §Layer 2
 * @see skills/mikroorm-dual-dialect.md
 */

import { defineConfig, MikroORM } from '@mikro-orm/sqlite';
import { Organization } from '../../entities/Organization.js';
import { User } from '../../entities/User.js';
import { Project } from '../../entities/Project.js';
import { TestRun } from '../../entities/TestRun.js';
import { TestResult } from '../../entities/TestResult.js';
import { TestArtifact } from '../../entities/TestArtifact.js';
import { IngestIdempotencyKey } from '../../entities/IngestIdempotencyKey.js';

describe('SQLite schema-generator', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    // Build a self-contained config instead of importing the app config
    // to avoid issues with defineConfig return value spreading.
    // No migrations config — schema-generator creates tables from entities.
    orm = await MikroORM.init(defineConfig({
      entities: [Organization, User, Project, TestRun, TestResult, TestArtifact, IngestIdempotencyKey],
      dbName: ':memory:',
      debug: false,
      schemaGenerator: {
        // Better Auth manages these tables — exclude from schema generation.
        // Organization is NOT excluded — it is CTRFHub-owned (INFRA-005 pivot).
        skipTables: ['user', 'session', 'account', 'verification', 'apikey'],
      },
    }));

    // Use schema-generator instead of migrator (INFRA-005 pivot).
    // update() is idempotent — safe on fresh and existing DBs.
    await orm.schema.update();
  });

  afterAll(async () => {
    if (orm) await orm.close(true);
  });

  it('schema-generator applies cleanly without errors', async () => {
    expect(orm).toBeDefined();
    expect(await orm.isConnected()).toBe(true);
  });

  it('creates the organization table with expected columns', async () => {
    const connection = orm.em.getConnection();
    const result = await connection.execute("PRAGMA table_info('organization')");
    const columns = (result as Array<{ name: string }>).map((r) => r.name);

    expect(columns).toContain('id');
    expect(columns).toContain('name');
    expect(columns).toContain('slug');
    expect(columns).toContain('logo');
    expect(columns).toContain('metadata');
    expect(columns).toContain('created_at');
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

  it('creates the ingest_idempotency_keys table with expected columns', async () => {
    const connection = orm.em.getConnection();
    const result = await connection.execute("PRAGMA table_info('ingest_idempotency_keys')");
    const columns = (result as Array<{ name: string }>).map((r) => r.name);

    expect(columns).toContain('id');
    expect(columns).toContain('project_id');
    expect(columns).toContain('idempotency_key');
    expect(columns).toContain('test_run_id');
    expect(columns).toContain('created_at');
  });

  it('does NOT create Better Auth managed tables', async () => {
    const connection = orm.em.getConnection();
    const tables = await connection.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    );
    const tableNames = (tables as Array<{ name: string }>).map((t) => t.name);

    // Better Auth-managed tables should NOT exist (schema-generator skips them)
    expect(tableNames).not.toContain('user');
    expect(tableNames).not.toContain('session');
    expect(tableNames).not.toContain('account');
    expect(tableNames).not.toContain('verification');
    expect(tableNames).not.toContain('apikey');
  });

  it('creates exactly 6 CTRFHub-owned tables', async () => {
    const connection = orm.em.getConnection();
    // Exclude internal SQLite tables (sqlite_sequence is created by autoincrement).
    // No mikro_orm_migrations table exists — schema-generator doesn't create one.
    const tables = await connection.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    );
    const tableNames = (tables as Array<{ name: string }>).map((t) => t.name);

    // 6 CTRFHub-owned tables (Organization is now included — INFRA-005 pivot).
    // The 7th entity (User) is Better Auth-managed and in skipTables.
    expect(tableNames).toContain('organization');
    expect(tableNames).toContain('projects');
    expect(tableNames).toContain('test_runs');
    expect(tableNames).toContain('test_results');
    expect(tableNames).toContain('test_artifacts');
    expect(tableNames).toContain('ingest_idempotency_keys');
    expect(tableNames).toHaveLength(6);
  });

  it('update() is idempotent — running twice causes no errors', async () => {
    // Verify idempotent re-run: no DROP TABLE or destructive changes
    await expect(orm.schema.update()).resolves.not.toThrow();
  });

  it('ingest_idempotency_keys.project_id has a FK to projects', async () => {
    const connection = orm.em.getConnection();
    const fks = await connection.execute("PRAGMA foreign_key_list('ingest_idempotency_keys')");
    const fk = (fks as Array<{ table: string; from: string }>).find(
      (fk) => fk.from === 'project_id'
    );
    expect(fk).toBeDefined();
    expect(fk!.table).toBe('projects');
  });

  it('ingest_idempotency_keys.test_run_id has a FK to test_runs', async () => {
    const connection = orm.em.getConnection();
    const fks = await connection.execute("PRAGMA foreign_key_list('ingest_idempotency_keys')");
    const fk = (fks as Array<{ table: string; from: string }>).find(
      (fk) => fk.from === 'test_run_id'
    );
    expect(fk).toBeDefined();
    expect(fk!.table).toBe('test_runs');
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
