import { Migration } from '@mikro-orm/migrations';

export class Migration20260425041216 extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table \`projects\` (\`id\` integer not null primary key autoincrement, \`organization_id\` text not null, \`name\` text not null, \`slug\` text not null, \`id_prefix\` text not null default '', \`base_url\` text null, \`retention_days\` integer null, \`settings\` json not null default '{}', \`created_at\` datetime not null default CURRENT_TIMESTAMP, \`updated_at\` datetime not null default CURRENT_TIMESTAMP, constraint \`projects_organization_id_foreign\` foreign key (\`organization_id\`) references \`organization\` (\`id\`));`);
    this.addSql(`create index \`projects_organization_id_index\` on \`projects\` (\`organization_id\`);`);

    this.addSql(`create table \`test_runs\` (\`id\` integer not null primary key autoincrement, \`project_id\` integer not null, \`name\` text null, \`status\` text not null default 'pending', \`trigger\` text null, \`reporter\` text null, \`environment\` text null, \`branch\` text null, \`commit_sha\` text null, \`started_at\` datetime null, \`completed_at\` datetime null, \`duration_ms\` integer null, \`total_tests\` integer not null default 0, \`passed\` integer not null default 0, \`failed\` integer not null default 0, \`skipped\` integer not null default 0, \`blocked\` integer not null default 0, \`ai_root_causes\` json null, \`ai_root_causes_at\` datetime null, \`ai_summary\` text null, \`ai_summary_at\` datetime null, \`created_at\` datetime not null default CURRENT_TIMESTAMP, constraint \`test_runs_project_id_foreign\` foreign key (\`project_id\`) references \`projects\` (\`id\`));`);
    this.addSql(`create index \`test_runs_project_id_index\` on \`test_runs\` (\`project_id\`);`);

    this.addSql(`create table \`test_results\` (\`id\` integer not null primary key autoincrement, \`test_run_id\` integer not null, \`test_name\` text not null, \`test_file\` text null, \`status\` text not null, \`duration_ms\` integer null, \`error_message\` text null, \`stack_trace\` text null, \`retry_count\` integer not null default 0, \`ai_category\` text null, \`ai_category_override\` text null, \`ai_category_model\` text null, \`ai_category_at\` datetime null, \`flaky_score\` real null, \`error_hash\` text null, \`created_at\` datetime not null default CURRENT_TIMESTAMP, constraint \`test_results_test_run_id_foreign\` foreign key (\`test_run_id\`) references \`test_runs\` (\`id\`));`);
    this.addSql(`create index \`test_results_test_run_id_index\` on \`test_results\` (\`test_run_id\`);`);

    this.addSql(`create table \`test_artifacts\` (\`id\` integer not null primary key autoincrement, \`test_result_id\` integer not null, \`display_name\` text not null, \`file_name\` text null, \`content_type\` text not null, \`artifact_type\` text not null, \`storage_type\` text not null, \`storage_key\` text not null, \`size_bytes\` integer null, \`content_type_verified\` integer not null default true, \`created_at\` datetime not null default CURRENT_TIMESTAMP, constraint \`test_artifacts_test_result_id_foreign\` foreign key (\`test_result_id\`) references \`test_results\` (\`id\`));`);
    this.addSql(`create index \`test_artifacts_test_result_id_index\` on \`test_artifacts\` (\`test_result_id\`);`);
  }

  override down(): void | Promise<void> {

    this.addSql(`drop table if exists \`projects\`;`);
    this.addSql(`drop table if exists \`test_runs\`;`);
    this.addSql(`drop table if exists \`test_results\`;`);
    this.addSql(`drop table if exists \`test_artifacts\`;`);
  }

}
