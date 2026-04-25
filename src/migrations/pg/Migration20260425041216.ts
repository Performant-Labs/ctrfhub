import { Migration } from '@mikro-orm/migrations';

export class Migration20260425041216 extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "projects" ("id" serial primary key, "organization_id" varchar(255) not null, "name" varchar(255) not null, "slug" varchar(100) not null, "id_prefix" varchar(10) not null default '', "base_url" varchar(500) null, "retention_days" int null, "settings" jsonb not null default '{}', "created_at" timestamptz not null default CURRENT_TIMESTAMP, "updated_at" timestamptz not null default CURRENT_TIMESTAMP);`);
    this.addSql(`create index "projects_organization_id_index" on "projects" ("organization_id");`);

    this.addSql(`create table "test_runs" ("id" serial primary key, "project_id" int not null, "name" varchar(255) null, "status" varchar(20) not null default 'pending', "trigger" varchar(50) null, "reporter" varchar(100) null, "environment" varchar(100) null, "branch" varchar(255) null, "commit_sha" varchar(40) null, "started_at" timestamptz null, "completed_at" timestamptz null, "duration_ms" int null, "total_tests" int not null default 0, "passed" int not null default 0, "failed" int not null default 0, "skipped" int not null default 0, "blocked" int not null default 0, "ai_root_causes" jsonb null, "ai_root_causes_at" timestamptz null, "ai_summary" text null, "ai_summary_at" timestamptz null, "created_at" timestamptz not null default CURRENT_TIMESTAMP);`);
    this.addSql(`create index "test_runs_project_id_index" on "test_runs" ("project_id");`);

    this.addSql(`create table "test_results" ("id" serial primary key, "test_run_id" int not null, "test_name" varchar(500) not null, "test_file" varchar(500) null, "status" varchar(20) not null, "duration_ms" int null, "error_message" text null, "stack_trace" text null, "retry_count" int not null default 0, "ai_category" varchar(50) null, "ai_category_override" varchar(50) null, "ai_category_model" varchar(100) null, "ai_category_at" timestamptz null, "flaky_score" real null, "error_hash" varchar(64) null, "created_at" timestamptz not null default CURRENT_TIMESTAMP);`);
    this.addSql(`create index "test_results_test_run_id_index" on "test_results" ("test_run_id");`);

    this.addSql(`create table "test_artifacts" ("id" serial primary key, "test_result_id" int not null, "display_name" varchar(255) not null, "file_name" varchar(500) null, "content_type" varchar(100) not null, "artifact_type" varchar(20) not null, "storage_type" varchar(10) not null, "storage_key" varchar(1000) not null, "size_bytes" int null, "content_type_verified" boolean not null default true, "created_at" timestamptz not null default CURRENT_TIMESTAMP);`);
    this.addSql(`create index "test_artifacts_test_result_id_index" on "test_artifacts" ("test_result_id");`);

    this.addSql(`alter table "projects" add constraint "projects_organization_id_foreign" foreign key ("organization_id") references "organization" ("id");`);
    this.addSql(`alter table "test_runs" add constraint "test_runs_project_id_foreign" foreign key ("project_id") references "projects" ("id");`);
    this.addSql(`alter table "test_results" add constraint "test_results_test_run_id_foreign" foreign key ("test_run_id") references "test_runs" ("id");`);
    this.addSql(`alter table "test_artifacts" add constraint "test_artifacts_test_result_id_foreign" foreign key ("test_result_id") references "test_results" ("id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "test_artifacts" drop constraint "test_artifacts_test_result_id_foreign";`);
    this.addSql(`alter table "test_results" drop constraint "test_results_test_run_id_foreign";`);
    this.addSql(`alter table "test_runs" drop constraint "test_runs_project_id_foreign";`);
    this.addSql(`alter table "projects" drop constraint "projects_organization_id_foreign";`);

    this.addSql(`drop table if exists "test_artifacts";`);
    this.addSql(`drop table if exists "test_results";`);
    this.addSql(`drop table if exists "test_runs";`);
    this.addSql(`drop table if exists "projects";`);
  }

}
