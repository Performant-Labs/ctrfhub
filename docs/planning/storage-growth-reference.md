# CTRFHub — Storage Growth Reference

Estimates for `test_results` table growth under different deployment profiles.
Use this to size the database server and configure `retention_days` appropriately.

---

## Row size assumptions

| Result type | Estimated size | Notes |
|---|---|---|
| Passing test | ~200 bytes | name, status, duration; message/trace are NULL |
| Failing test | ~2 KB | name + error message + stack trace |
| **Weighted average** (80% pass rate) | **~560 bytes raw** | |
| **With PostgreSQL overhead** | **~1 KB/row** | Includes indexes, MVCC, page alignment (~1.5–2× raw) |

`test_runs` rows (~500 bytes each) are negligible compared to `test_results`.
`test_artifacts` are stored externally (object storage); only metadata rows are counted here.

---

## Storage by deployment scenario

| Scenario | Runs/day | Tests/run | Results/day | Storage/day | Storage/month | Storage/year |
|---|---|---|---|---|---|---|
| **Small team** (10 devs, standard CI) | 20 | 5K | 100K | ~100 MB | ~3 GB | ~36 GB |
| **Active team** (50 devs, fast CI) | 100 | 20K | 2M | ~2 GB | ~60 GB | ~720 GB |
| **Large monorepo** (100K test suite) | 50 | 100K | 5M | ~5 GB | ~150 GB | ~1.8 TB |
| **Device testing** (1K runs/hr, `rate_limit_per_hour=0`) | 24K | 100 | 2.4M | ~2.4 GB | ~72 GB | ~876 GB |
| **Runaway token** (10K runs/hr, misconfigured) | 240K | 100 | 24M | ~24 GB | ~720 GB | fills 500 GB in **3 weeks** |

---

## Effect of retention policy on steady-state storage

With a `retention_days` policy active, storage stops growing unboundedly and stabilises at:

```
steady-state storage ≈ storage_per_day × retention_days
```

| Scenario | Retention | Steady-state DB size |
|---|---|---|
| Small team | 90 days (default) | ~9 GB |
| Small team | 365 days | ~36 GB |
| Active team | 90 days (default) | ~180 GB |
| Active team | 30 days | ~60 GB |
| Large monorepo | 30 days | ~150 GB |
| Large monorepo | 7 days | ~35 GB |
| Device testing | 7 days | ~17 GB |
| Device testing | 1 day | ~2.4 GB |
| Runaway token | 90 days | **fills server** — rate limit must be corrected first |

---

## Recommended server sizing

| Team size | Retention | Recommended DB disk |
|---|---|---|
| 1–10 devs | 90 days | 20 GB (comfortable for years) |
| 10–50 devs | 90 days | 200–500 GB |
| 50–200 devs | 90 days | 500 GB – 2 TB |
| Large monorepo / device testing | 7–30 days | 50–500 GB (depends heavily on test count) |

---

## Milestone-protected runs

Runs associated with a **closed milestone** are never auto-deleted, regardless of `retention_days`. This preserves permanent historical records for release validation and audit purposes. Milestone-protected runs should be a small fraction of total storage in practice — they represent deliberate release points, not daily CI noise.

Milestone protection is a **Business Edition** feature (milestones are Business Edition per DD-003/DD-004).

---

## Notes for self-hosters

- The nightly retention cron uses `DELETE FROM test_runs WHERE project_id = ? AND created_at < NOW() - INTERVAL '{N} days'` with cascading deletes to `test_results`, `test_artifacts`, `test_result_comments`, and `custom_field_values`.
- Deletion is chunked (1,000 runs at a time with a short sleep between) to avoid locking the table for long periods.
- A `rate_limit_per_hour = 0` (unlimited) project token combined with no retention policy is the fastest path to filling the disk. The UI should warn when both conditions are true simultaneously.
- PostgreSQL `autovacuum` reclaims space after large deletes; plan for a few hours of lag before disk space is visibly recovered after the first retention run.

---

*Last updated: 2026-04-22*
