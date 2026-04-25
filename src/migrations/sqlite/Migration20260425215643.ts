import { Migration } from '@mikro-orm/migrations';

export class Migration20260425215643 extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table \`ingest_idempotency_keys\` (\`id\` integer not null primary key autoincrement, \`project_id\` integer not null, \`idempotency_key\` text not null, \`test_run_id\` integer not null, \`created_at\` datetime not null default CURRENT_TIMESTAMP, constraint \`ingest_idempotency_keys_project_id_foreign\` foreign key (\`project_id\`) references \`projects\` (\`id\`), constraint \`ingest_idempotency_keys_test_run_id_foreign\` foreign key (\`test_run_id\`) references \`test_runs\` (\`id\`));`);
    this.addSql(`create index \`ingest_idempotency_keys_project_id_index\` on \`ingest_idempotency_keys\` (\`project_id\`);`);
    this.addSql(`create index \`ingest_idempotency_keys_test_run_id_index\` on \`ingest_idempotency_keys\` (\`test_run_id\`);`);
    this.addSql(`create unique index \`ingest_idempotency_keys_project_id_idempotency_key_unique\` on \`ingest_idempotency_keys\` (\`project_id\`, \`idempotency_key\`);`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists \`ingest_idempotency_keys\`;`);
  }

}
