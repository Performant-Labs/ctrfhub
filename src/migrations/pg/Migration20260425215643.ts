import { Migration } from '@mikro-orm/migrations';

export class Migration20260425215643 extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "ingest_idempotency_keys" ("id" serial primary key, "project_id" int not null, "idempotency_key" varchar(128) not null, "test_run_id" int not null, "created_at" timestamptz not null default CURRENT_TIMESTAMP);`);
    this.addSql(`alter table "ingest_idempotency_keys" add constraint "ingest_idempotency_keys_project_id_foreign" foreign key ("project_id") references "projects" ("id") on update cascade;`);
    this.addSql(`alter table "ingest_idempotency_keys" add constraint "ingest_idempotency_keys_test_run_id_foreign" foreign key ("test_run_id") references "test_runs" ("id") on update cascade;`);
    this.addSql(`create index "ingest_idempotency_keys_project_id_index" on "ingest_idempotency_keys" ("project_id");`);
    this.addSql(`create index "ingest_idempotency_keys_test_run_id_index" on "ingest_idempotency_keys" ("test_run_id");`);
    this.addSql(`create unique index "ingest_idempotency_keys_project_id_idempotency_key_unique" on "ingest_idempotency_keys" ("project_id", "idempotency_key");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "ingest_idempotency_keys";`);
  }

}
