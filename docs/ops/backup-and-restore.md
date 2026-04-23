# Backup & Restore Runbook

Audience: CTRFHub operators. Target posture: self-hosted, Docker Compose deployment.

This runbook is the **how**. The **why** (design decisions, trade-offs, rejected alternatives) lives in `docs/planning/database-design.md` → DD-026. Cross-references to DD-014 (artifact storage), DD-017 (AI pipeline recovery), DD-018 (webhook outbox) explain why many restore scenarios self-heal without operator intervention.

---

## Quick reference

| Scenario | Recipe | Stop service? |
|---|---|---|
| Postgres + local artifacts | **A** | Recommended (cleanest); hot path OK |
| Postgres + S3 artifacts | **B** | Optional |
| SQLite + local artifacts | **C** | **Required** |
| Restore any of the above | See restore runbook | **Required** |
| Downgrade CTRFHub binary | See downgrade procedure | Required between steps |

---

## Assumptions

- CTRFHub is running via `docker compose` (the reference deployment model).
- Backup host has enough disk to hold dumps + tarballs — size roughly `(DB size) + (artifact directory size)`.
- Time is in UTC throughout; backup filenames use `date +%Y%m%d` format for lexical sorting.

Adjust volume names (`ctrfhub_artifacts_data`, `ctrfhub_db_data`) if your `docker-compose.yml` renames them; `docker volume ls` to confirm.

---

## Recipe A — Postgres + local artifacts

The common self-hosted deployment. Both DB and artifacts live in Docker volumes.

### Cold backup (stop-service — cleanest)

```bash
set -euo pipefail
BACKUP_DIR=/path/to/backup
STAMP=$(date +%Y%m%d-%H%M%S)

docker compose stop api worker

docker compose exec -T db pg_dump -U ctrfhub -F c -Z 9 ctrfhub \
  > "$BACKUP_DIR/db-$STAMP.dump"

tar -czf "$BACKUP_DIR/artifacts-$STAMP.tar.gz" \
  -C /var/lib/docker/volumes/ctrfhub_artifacts_data/_data .

docker compose start api worker

# Record binary + schema version so restore can sanity-check
docker compose run --rm api node dist/cli migrate:status --json \
  > "$BACKUP_DIR/version-$STAMP.json"
```

Downtime: roughly the time `pg_dump` + `tar` take. On small instances (< 1 GB DB, < 5 GB artifacts), a minute or two.

### Hot backup (service running)

Acceptable when downtime isn't acceptable. The DB dump is always consistent (pg_dump takes a transaction snapshot); the artifact rsync and the DB dump are not atomic together, so a brief window can produce orphans.

```bash
set -euo pipefail
BACKUP_DIR=/path/to/backup
STAMP=$(date +%Y%m%d-%H%M%S)

docker compose exec -T db pg_dump -U ctrfhub -F c -Z 9 ctrfhub \
  > "$BACKUP_DIR/db-$STAMP.dump"

rsync -a --delete \
  /var/lib/docker/volumes/ctrfhub_artifacts_data/_data/ \
  "$BACKUP_DIR/artifacts-$STAMP/"

docker compose run --rm api node dist/cli migrate:status --json \
  > "$BACKUP_DIR/version-$STAMP.json"
```

CTRFHub handles the orphan-in-either-direction case gracefully (DD-014 placeholder path for DB-row-without-file; retention sweeper cleans files-without-row).

---

## Recipe B — Postgres + S3 artifacts

For production deployments using S3. Artifacts don't need a per-backup copy — rely on S3 durability + bucket versioning.

```bash
set -euo pipefail
BACKUP_DIR=/path/to/backup
STAMP=$(date +%Y%m%d-%H%M%S)

docker compose exec -T db pg_dump -U ctrfhub -F c -Z 9 ctrfhub \
  > "$BACKUP_DIR/db-$STAMP.dump"

docker compose run --rm api node dist/cli migrate:status --json \
  > "$BACKUP_DIR/version-$STAMP.json"
```

**Enable S3 bucket versioning once at setup time** so point-in-time recovery of artifacts is available without per-backup copies:

```bash
aws s3api put-bucket-versioning \
  --bucket $ARTIFACT_BUCKET \
  --versioning-configuration Status=Enabled
```

Optional lifecycle policy: transition non-current versions to Glacier after 30 days, expire after 365 days (adjust to retention policy).

---

## Recipe C — SQLite + local artifacts

Single-node deployments. SQLite requires service stop for a clean backup.

```bash
set -euo pipefail
BACKUP_DIR=/path/to/backup
STAMP=$(date +%Y%m%d-%H%M%S)

docker compose stop api worker

docker compose exec -T api sqlite3 /var/lib/ctrfhub/ctrfhub.db \
  ".backup '/var/lib/ctrfhub/backup/db-$STAMP.db'"

# The sqlite3 .backup above wrote into the container's /var/lib/ctrfhub/backup
# directory — mount or volume-copy to move it to $BACKUP_DIR

tar -czf "$BACKUP_DIR/artifacts-$STAMP.tar.gz" \
  -C /var/lib/docker/volumes/ctrfhub_artifacts_data/_data .

docker compose start api worker

docker compose run --rm api node dist/cli migrate:status --json \
  > "$BACKUP_DIR/version-$STAMP.json"
```

SQLite's `.backup` pragma is safe with the service stopped; it's also safe hot, but graduating to Postgres is a better answer than optimizing SQLite hot backups.

---

## Restore runbook (seven steps)

Order matters. Skipping steps fails loud; doing them out of order corrupts silent.

### 1. Stop the service

```bash
docker compose stop api worker
```

Never restore into a live service.

### 2. Restore the database

**Postgres:**

```bash
docker compose up -d db                    # DB must be running to receive the restore
docker compose exec -T db pg_restore \
  -U ctrfhub -d ctrfhub --clean --if-exists --no-owner \
  < /path/to/backup/db-YYYYMMDD.dump
```

**SQLite:**

```bash
cp /path/to/backup/db-YYYYMMDD.db \
  /var/lib/docker/volumes/ctrfhub_db_data/_data/ctrfhub.db
```

### 3. Restore artifacts

**Local artifacts:**

```bash
tar -xzf /path/to/backup/artifacts-YYYYMMDD.tar.gz \
  -C /var/lib/docker/volumes/ctrfhub_artifacts_data/_data/
```

**S3 artifacts:** skip this step. If you enabled bucket versioning and need to roll back the bucket to match the DB dump time, use `aws s3api list-object-versions` + targeted restore. Usually unnecessary — the DB references object keys that still exist in S3.

### 4. Version-compatibility check

```bash
docker compose run --rm api node dist/cli migrate:status
```

Compare the reported schema version against the recorded version in `version-YYYYMMDD.json` (produced at backup time) and against what the currently-tagged image expects. Three outcomes:

- **Binary version > schema version** — normal upgrade path. Forward migrations run at boot.
- **Binary version = schema version** — no-op boot.
- **Binary version < schema version** — **STOP**. Do not start the service. See the downgrade procedure below; you need a newer binary to roll the schema back first.

### 5. Start the service

```bash
docker compose up -d
```

During any forward migrations, `/health` returns `503` with `bootState=migrating`. Boot completes when `bootState=ready`.

### 6. Verify `/health`

```bash
curl -sf http://localhost/health | jq .
```

Expected: `{"status":"ok","bootState":"ready","db":"ok","version":"…","uptime":…}`. If stuck in `migrating`, tail logs: `docker compose logs -f api`. If `failed`, the migration log output tells you what to fix.

### 7. Smoke test

Upload a trivial CTRF sample and confirm it surfaces:

```bash
curl -X POST \
  -H "Authorization: Bearer $PROJECT_TOKEN" \
  -F "ctrf=@sample-ctrf.json" \
  http://localhost/api/v1/projects/<slug>/runs
```

Then load the run in the UI: artifact links should resolve, AI categorizations (if DD-017 ran previously) should be visible on the restored runs.

---

## Downgrade procedure (newer binary runs the rollback)

Pattern inherited from Mattermost: the binary that knows *how* to undo a migration is the one that wrote it forward. Keep the newer binary around long enough to roll back, then swap.

### When to downgrade

- A new release introduced a regression and you need to go back to the previous stable version.
- A planned test of the rollback path (recommended operator practice).

### Steps

1. **Stop the service on the newer binary.**

   ```bash
   docker compose stop api worker
   ```

2. **Keep the newer binary image on disk.** Don't `docker image prune` it yet — it's the only thing that knows the down migrations.

3. **Generate / inspect the rollback plan.**

   ```bash
   docker compose run --rm api node dist/cli migrate:check --to <target-version>
   ```

   This prints the `DOWN` SQL that will execute. Review for anything destructive (dropping columns, dropping tables). If the review surfaces data loss that you're not willing to accept, restore from backup instead.

4. **Dry-run the down migration** (optional but recommended):

   ```bash
   docker compose run --rm api node dist/cli migrate:down --to <target-version> --dry-run
   ```

5. **Execute the down migration with the newer binary.**

   ```bash
   docker compose run --rm api node dist/cli migrate:down --to <target-version>
   ```

   MikroORM applies each `.down.ts` in reverse order. This is the step that data loss can happen in — the preceding dry-run and backup exist so you never take this step without a rollback-of-the-rollback available.

6. **Swap the image tag.** Update `docker-compose.yml`:

   ```diff
   -    image: ctrfhub/ctrfhub:1.3.0
   +    image: ctrfhub/ctrfhub:1.2.5
   ```

7. **Start the older binary.**

   ```bash
   docker compose up -d
   ```

   `/health` should reach `ready`. If the older binary crashes at startup with the "FATAL: schema version ahead of binary version" message, step 5 didn't fully complete — re-check schema version with the newer binary.

### Post-v1: one ESR step at a time

Once CTRFHub establishes an Extended Support Release cadence, downgrades must step through ESRs (you cannot downgrade ESR-3 → ESR-1 directly). The `migrate:check` CLI refuses multi-ESR jumps. Pre-v1 MVP: any-to-any is allowed because the version-skipping policy isn't formalized yet.

---

## Encryption

CTRFHub backups are **plaintext**. Encrypt them before off-box storage.

### What's in a dump

| Field | Sensitivity | Notes |
|---|---|---|
| User emails + display names | PII | Better Auth `users` |
| Org / project names | Usually benign | Check your naming conventions |
| Test error messages + stack traces | **HIGH** — stack traces commonly leak env vars, file paths, hostnames | `test_results.error_message`, `test_results.stack_trace` |
| Webhook URLs | **HIGH** — often embed auth tokens | `project_webhooks.url` |
| Hashed passwords | Medium — bcrypt offline-crackable | Better Auth `accounts` |
| Hashed API tokens | Medium — same posture | `project_tokens.hash` |
| TOTP secrets (if 2FA/PL-010 promotes) | **HIGH** if `.env` (with AES key) is in same archive | Better Auth |
| AI API keys | **HIGH** if `AI_ENCRYPTION_KEY` not set | `ai_provider_credentials` (DD-016) |
| Raw CTRF JSON | Variable | `test_runs.raw_ctrf`, `test_results.raw_extra` |

### Recommended posture

```bash
# Encrypt with GPG (recipient key pre-imported)
gpg --encrypt --recipient backup@example.com \
  --output "db-$STAMP.dump.gpg" "db-$STAMP.dump"

# Or age
age -r "age1..." -o "db-$STAMP.dump.age" "db-$STAMP.dump"

# Then off-box (encrypted bucket)
aws s3 cp "db-$STAMP.dump.gpg" "s3://backups-bucket/db/"
```

Do **not** archive `.env` alongside the DB dump — keep data and secrets on separate trust paths.

---

## What doesn't restore cleanly

Accepted losses / self-healing state. None of these require operator intervention.

| State | On restore | Action |
|---|---|---|
| Better Auth sessions | Users re-login | No action |
| In-flight AI pipeline runs | DD-017 sweeper + idempotency guard reclaim | No action |
| Webhook outbox past 6h TTL | Sweeper marks failed | Receiver-side idempotency handles any replays |
| Rate-limit counters | Rebuild on first hit | No action |
| SSE subscriber state | Clients auto-reconnect | No action |
| Ephemeral Pino metric counters | In-memory reset; log-stream history intact | No action |
| `ingest_idempotency_keys` past 24h TTL | Nightly sweep clears | No action |

---

## Troubleshooting

**`pg_restore: error: could not execute query: ERROR: relation "..." already exists`.** The `--clean --if-exists` flags on restore should prevent this; if seeing it anyway, the `--clean` flag didn't apply (check that your backup was made with `-F c` custom format). Workaround: `docker compose exec db psql -U ctrfhub -c "DROP DATABASE ctrfhub; CREATE DATABASE ctrfhub;"` then re-run `pg_restore` without `--clean`.

**`FATAL: schema version N is ahead of binary version M` at startup.** The startup guardrail is doing its job. Either:

- You're restoring a backup taken from a newer CTRFHub version. Upgrade the image tag.
- You're trying to downgrade. Follow the downgrade procedure above.

**Artifacts missing after restore — UI shows placeholder icons.** Expected if the artifact tarball wasn't restored (Recipe A cold/hot variants require the tarball; Recipe B relies on S3). Placeholder is graceful; upload new artifacts on re-runs.

**Webhook deliveries retrying from hours ago.** DD-018's sweeper re-reserves stuck deliveries on boot. If any were already successfully delivered before backup, the receiver sees them twice — the `X-CTRFHub-Delivery-Id` header lets receivers dedupe.

**SQLite backup corrupted after restore.** Likely caused by copying the DB file hot without `.backup` pragma. Always use `sqlite3 .backup` (Recipe C) — never `cp` the `.db` file of a running service.

---

## Restore drills

Recommended operator practice, not a product feature. Once a quarter:

1. Spin up a staging environment with the production backup.
2. Run the seven-step restore runbook.
3. Verify a known run surfaces correctly + AI categorizations present.
4. Compare row counts: `SELECT count(*) FROM test_runs;` between prod and staging should match (modulo the time between backup capture and restore).
5. Destroy the staging environment.

A backup you haven't restored is a backup you can't trust.

---

*Last updated: 2026-04-22. Design rationale: DD-026.*
