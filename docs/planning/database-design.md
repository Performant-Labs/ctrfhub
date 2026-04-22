# Multi-Tenant Test Results Database Design

**Community:** Organization → Project → Test Run → Test Result
**Business:** Organization → Project → Milestone → Test Run → Test Result

Performant Labs · v1.0

---

## 1. Overview

Normalized relational schema for a multi-tenant automated testing platform. The Community Edition hierarchy is four levels deep: Organization → Project → Test Run → Test Result. The Business Edition adds an optional **Milestone** level between Project and Test Run, enabling release-scoped grouping of runs. Each table carries only a pointer to its direct parent (no skip-level foreign keys), relying on indexed joins and denormalized aggregate counters on Test Runs for performance.

**Schema deployment policy:** All tables are deployed in every installation, including Community Edition. Business Edition features are gated at the application layer by a license check — not by the presence or absence of tables. This enables zero-migration upgrades (see DD-003).

---

## 2. Design Principles

- **Normalized structure** — each table holds only a FK to its direct parent
- **No skip-level FKs** — two-join queries on indexed columns are fast enough
- **Denormalized aggregates on test_runs** — summary counters (passed/failed/skipped) are cached at the run level to avoid expensive COUNT queries on test_results at dashboard load time
- **Immutability of results** — test_results rows are write-once; no re-parenting occurs, eliminating the main risk of denormalization
- **All foreign keys are indexed** — queries at every level of the hierarchy remain efficient

---

## 3. Entity Relationship Overview

```
Community Edition
─────────────────
organizations
    └── projects              (organization_id → organizations.id)
            └── test_runs         (project_id → projects.id)
                    └── test_results  (test_run_id → test_runs.id)

Business Edition — automated side adds milestones
─────────────────────────────────────────────────
organizations
    └── projects              (organization_id → organizations.id)
            ├── milestones        (project_id → projects.id)            [Business]
            └── test_runs         (project_id → projects.id)
                    ├── milestone_id → milestones.id  (nullable)        [Business]
                    └── test_results  (test_run_id → test_runs.id)

Business Edition — manual testing side
──────────────────────────────────────
organizations
    └── projects
            ├── test_cases           (project_id → projects.id)         [Business]
            │       └── test_case_steps  (test_case_id → test_cases.id)  [Business]
            ├── test_plan_templates  (project_id → projects.id)         [Business]
            │       └── test_plan_template_entries → test_cases          [Business]
            └── test_plans           (project_id → projects.id)         [Business]
                    ├── template_id → test_plan_templates.id (nullable) [Business]
                    ├── milestone_id → milestones.id (nullable)          [Business]
                    └── test_plan_entries → test_cases                   [Business]
                            └── test_plan_entry_steps → test_case_steps  [Business]
```

---

## 4. Table Definitions

### 4.1 organizations

Top-level tenant boundary. All data within the system belongs to an organization.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGINT | PK, AUTO_INCREMENT | Surrogate key |
| name | VARCHAR(255) | NOT NULL | Display name |
| slug | VARCHAR(100) | NOT NULL, UNIQUE | URL-safe identifier |
| created_at | TIMESTAMP | NOT NULL, DEFAULT NOW() | |
| updated_at | TIMESTAMP | NOT NULL | |

### 4.2 projects

A project maps to a single Drupal site or application under test. One organization can own many projects.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGINT | PK, AUTO_INCREMENT | Surrogate key |
| organization_id | BIGINT | NOT NULL, FK → organizations.id | Indexed |
| name | VARCHAR(255) | NOT NULL | |
| slug | VARCHAR(100) | NOT NULL | Unique within org |
| id_prefix | VARCHAR(10) | NOT NULL | Run ID prefix (e.g. "E2E"); defaults to first 4 uppercase chars of slug; displayed as `{prefix}-{run_sequence}` |
| base_url | VARCHAR(500) | | Site under test |
| created_at | TIMESTAMP | NOT NULL, DEFAULT NOW() | |
| updated_at | TIMESTAMP | NOT NULL | |

### 4.3 milestones *(Business Edition only)*

A named release or campaign that groups related test runs within a project. Allows teams to view aggregate pass/fail health across all runs that fed into a specific release (e.g. "v2.1.0", "Sprint 42", "2026-Q1 Regression"). Not available in Community Edition; `milestone_id` on `test_runs` is always NULL in Community.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGINT | PK, AUTO_INCREMENT | |
| project_id | BIGINT | NOT NULL, FK → projects.id | Indexed |
| name | VARCHAR(255) | NOT NULL | e.g. "v2.1.0", "Sprint 42" |
| description | TEXT | | Optional notes or release criteria |
| status | ENUM | NOT NULL | open \| closed \| archived |
| target_date | DATE | | Planned release date |
| released_at | TIMESTAMP | | Actual release date (set when closed) |
| created_by | BIGINT | FK → users.id (Better Auth) | |
| created_at | TIMESTAMP | NOT NULL, DEFAULT NOW() | |
| updated_at | TIMESTAMP | NOT NULL | |

---

### 4.4 test_runs

A single execution of a test suite against a project. Holds cached aggregate counters so dashboard queries are single-row lookups rather than full aggregations over test_results.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGINT | PK, AUTO_INCREMENT | |
| project_id | BIGINT | NOT NULL, FK → projects.id | Indexed |
| milestone_id | BIGINT | FK → milestones.id | Nullable; null in Community Edition; links run to a release |
| name | VARCHAR(255) | | Human-readable title (e.g. "Nightly E2E – main"); auto-generated from branch + timestamp if omitted |
| status | ENUM | NOT NULL | pending \| running \| passed \| failed \| error |
| trigger | VARCHAR(50) | | ci \| manual \| scheduled |
| reporter | VARCHAR(100) | | Source tool (e.g. playwright, cypress, jest, vitest) |
| environment | VARCHAR(100) | | Target environment (e.g. staging, production, local) |
| branch | VARCHAR(255) | | Git branch name |
| commit_sha | VARCHAR(40) | | |
| started_at | TIMESTAMP | | |
| completed_at | TIMESTAMP | | |
| duration_ms | INT | | Wall-clock duration |
| total_tests | INT | NOT NULL, DEFAULT 0 | Cached aggregate |
| passed | INT | NOT NULL, DEFAULT 0 | Cached aggregate |
| failed | INT | NOT NULL, DEFAULT 0 | Cached aggregate |
| skipped | INT | NOT NULL, DEFAULT 0 | Cached aggregate |
| blocked | INT | NOT NULL, DEFAULT 0 | Cached aggregate |
| created_at | TIMESTAMP | NOT NULL, DEFAULT NOW() | |

### 4.5 test_results

One row per individual test case within a run. Write-once; rows are never re-parented. Artifacts are stored in `test_artifacts`; comments in `test_result_comments`.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGINT | PK, AUTO_INCREMENT | |
| test_run_id | BIGINT | NOT NULL, FK → test_runs.id | Indexed |
| test_name | VARCHAR(500) | NOT NULL | Full spec path + test title |
| test_file | VARCHAR(500) | | Relative path to spec file |
| status | ENUM | NOT NULL | passed \| failed \| skipped \| pending \| blocked |
| duration_ms | INT | | Individual test duration |
| error_message | TEXT | | Failure message if applicable |
| stack_trace | TEXT | | |
| retry_count | TINYINT | NOT NULL, DEFAULT 0 | Number of retries |
| assigned_to | BIGINT | FK → users.id (Better Auth) | Nullable; person responsible for fixing |
| ai_category | ENUM | | app_defect \| test_data \| script_error \| environment \| unknown |
| ai_category_overridden | BOOLEAN | NOT NULL, DEFAULT FALSE | True if a user manually changed the AI category |
| created_at | TIMESTAMP | NOT NULL, DEFAULT NOW() | |

---

### 4.6 test_artifacts

Artifacts associated with a test result (screenshots, videos, traces, logs). Replaces the flat `screenshot_url` / `video_url` columns from earlier designs, allowing multiple artifacts of any type per result.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGINT | PK, AUTO_INCREMENT | |
| test_result_id | BIGINT | NOT NULL, FK → test_results.id | Indexed |
| artifact_type | ENUM | NOT NULL | screenshot \| video \| trace \| log \| other |
| file_name | VARCHAR(500) | NOT NULL | Original filename |
| storage_type | ENUM | NOT NULL | local \| s3 |
| url | VARCHAR(1000) | NOT NULL | Serve path (local) or S3/CDN URL |
| size_bytes | INT | | |
| created_at | TIMESTAMP | NOT NULL, DEFAULT NOW() | |

---

### 4.7 test_result_comments

Free-text comments on individual test results. Supports the post-run triage workflow (explaining a failure, noting a known issue, @-mentioning a teammate).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGINT | PK, AUTO_INCREMENT | |
| test_result_id | BIGINT | NOT NULL, FK → test_results.id | Indexed |
| user_id | BIGINT | NOT NULL, FK → users.id (Better Auth) | Author |
| body | TEXT | NOT NULL | Comment content (plain text or Markdown) |
| created_at | TIMESTAMP | NOT NULL, DEFAULT NOW() | |
| updated_at | TIMESTAMP | NOT NULL | |

---

### Manual Testing Tables *(Business Edition feature — schema always deployed)*

> These tables are not part of the MVP but are part of the baseline schema deployed in every installation. Access is gated at the application layer by license check (see DD-003). No automated-side tables are modified; the two hierarchies are deliberately separate (see DD-004).

---

### 4.8 test_cases *(Business Edition)*

The canonical, reusable definition of a manual test case. Decoupled from any specific plan or execution — it is the "spec", not the result.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGINT | PK, AUTO_INCREMENT | |
| project_id | BIGINT | NOT NULL, FK → projects.id | Indexed |
| title | VARCHAR(500) | NOT NULL | |
| description | TEXT | | Full test case description |
| precondition | TEXT | | State required before execution |
| priority | ENUM | | low \| medium \| high \| critical |
| test_type | ENUM | | functional \| regression \| smoke \| exploratory \| other |
| folder_path | VARCHAR(1000) | | Slash-delimited hierarchy (e.g. /Login/OAuth) |
| owner_id | BIGINT | FK → users.id (Better Auth) | Responsible author |
| created_by | BIGINT | NOT NULL, FK → users.id | |
| created_at | TIMESTAMP | NOT NULL, DEFAULT NOW() | |
| updated_at | TIMESTAMP | NOT NULL | |

---

### 4.9 test_case_steps *(Business Edition)*

Ordered steps within a test case definition. Steps belong to the spec, not to any execution.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGINT | PK, AUTO_INCREMENT | |
| test_case_id | BIGINT | NOT NULL, FK → test_cases.id | Indexed |
| step_order | SMALLINT | NOT NULL | 1-indexed display order |
| action | TEXT | NOT NULL | What the tester should do |
| expected | TEXT | | Expected outcome |
| created_at | TIMESTAMP | NOT NULL, DEFAULT NOW() | |

---

### 4.10 test_plan_templates *(Business Edition)*

A reusable collection of test cases that can be instantiated into multiple test plans. Acts as a blueprint; does not hold execution results.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGINT | PK, AUTO_INCREMENT | |
| project_id | BIGINT | NOT NULL, FK → projects.id | Indexed |
| name | VARCHAR(255) | NOT NULL | e.g. "Full Regression Checklist" |
| description | TEXT | | |
| created_by | BIGINT | NOT NULL, FK → users.id | |
| created_at | TIMESTAMP | NOT NULL, DEFAULT NOW() | |
| updated_at | TIMESTAMP | NOT NULL | |

---

### 4.11 test_plan_template_entries *(Business Edition)*

The ordered set of test cases that belong to a template.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGINT | PK, AUTO_INCREMENT | |
| template_id | BIGINT | NOT NULL, FK → test_plan_templates.id | Indexed |
| test_case_id | BIGINT | NOT NULL, FK → test_cases.id | |
| entry_order | SMALLINT | NOT NULL | Display order within template |

---

### 4.12 test_plans *(Business Edition)*

A time-bound execution instance of a template (or an ad-hoc plan without a template). Represents a specific testing campaign — e.g. "Sprint 42 acceptance" or "v2.1 RC1 regression".

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGINT | PK, AUTO_INCREMENT | |
| project_id | BIGINT | NOT NULL, FK → projects.id | Indexed |
| template_id | BIGINT | FK → test_plan_templates.id | Nullable; null for ad-hoc plans |
| milestone_id | BIGINT | FK → milestones.id | Nullable; links plan to a release |
| name | VARCHAR(255) | NOT NULL | |
| description | TEXT | | |
| status | ENUM | NOT NULL | open \| in_progress \| closed \| archived |
| planned_start | DATE | | |
| planned_end | DATE | | |
| closed_at | TIMESTAMP | | |
| created_by | BIGINT | NOT NULL, FK → users.id | |
| created_at | TIMESTAMP | NOT NULL, DEFAULT NOW() | |
| updated_at | TIMESTAMP | NOT NULL | |

---

### 4.13 test_plan_entries *(Business Edition)*

One row per test case per test plan. This is the execution slot: assignment, status, and tester notes live here. Corresponds to a single row in the Testiny "Assigned To / Result" table view.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGINT | PK, AUTO_INCREMENT | |
| test_plan_id | BIGINT | NOT NULL, FK → test_plans.id | Indexed |
| test_case_id | BIGINT | NOT NULL, FK → test_cases.id | Indexed |
| assigned_to | BIGINT | FK → users.id | Nullable; tester responsible for this entry |
| status | ENUM | NOT NULL, DEFAULT 'not_run' | not_run \| passed \| failed \| blocked \| skipped |
| notes | TEXT | | Tester observations |
| executed_by | BIGINT | FK → users.id | Who actually ran it (may differ from assignee) |
| executed_at | TIMESTAMP | | When the result was recorded |
| created_at | TIMESTAMP | NOT NULL, DEFAULT NOW() | |
| updated_at | TIMESTAMP | NOT NULL | |

---

### 4.14 test_plan_entry_steps *(Business Edition)*

Step-level execution results for a single test plan entry. Records actual vs expected outcome per step. Definition (expected) lives in `test_case_steps`; execution result (actual) lives here.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGINT | PK, AUTO_INCREMENT | |
| test_plan_entry_id | BIGINT | NOT NULL, FK → test_plan_entries.id | Indexed |
| test_case_step_id | BIGINT | NOT NULL, FK → test_case_steps.id | Links to the step definition |
| status | ENUM | NOT NULL, DEFAULT 'not_run' | not_run \| passed \| failed \| blocked |
| actual | TEXT | | Observed outcome (free text) |
| created_at | TIMESTAMP | NOT NULL, DEFAULT NOW() | |
| updated_at | TIMESTAMP | NOT NULL | |

---

## 5. Indexes

| Table | Index Columns | Purpose |
|---|---|---|
| projects | organization_id | All projects for an org |
| milestones | project_id | All milestones for a project *(Business)* |
| milestones | project_id, status | Filter open/closed milestones *(Business)* |
| test_runs | project_id | All runs for a project |
| test_runs | milestone_id | All runs in a milestone *(Business)* |
| test_runs | project_id, status | Filter runs by status per project |
| test_runs | project_id, started_at DESC | Recent runs dashboard |
| test_runs | project_id, reporter | Filter/group by reporter tool |
| test_runs | project_id, environment | Filter by environment |
| test_results | test_run_id | All results for a run (most frequent) |
| test_results | test_run_id, status | Failed/blocked results for a run |
| test_results | test_name, test_run_id | Test history across runs |
| test_results | assigned_to | All results assigned to a user |
| test_artifacts | test_result_id | All artifacts for a result |
| test_result_comments | test_result_id | All comments for a result |
| test_cases | project_id | All test cases for a project *(Business)* |
| test_case_steps | test_case_id | All steps for a test case *(Business)* |
| test_plan_templates | project_id | All templates for a project *(Business)* |
| test_plan_template_entries | template_id | All entries in a template *(Business)* |
| test_plans | project_id | All plans for a project *(Business)* |
| test_plans | milestone_id | All plans in a milestone *(Business)* |
| test_plan_entries | test_plan_id | All entries in a plan *(Business)* |
| test_plan_entries | test_case_id | All executions of a test case across plans *(Business)* |
| test_plan_entries | assigned_to | All entries assigned to a user *(Business)* |
| test_plan_entry_steps | test_plan_entry_id | All step results for an entry *(Business)* |

---

## 6. Common Queries

### 6.1 All results for a run (single lookup)

```sql
SELECT *
FROM   test_results
WHERE  test_run_id = :run_id;
```

### 6.2 Run summary (single row — no aggregation needed)

```sql
SELECT total_tests, passed, failed, skipped, duration_ms
FROM   test_runs
WHERE  id = :run_id;
```

### 6.3 All results for a project (one join)

```sql
SELECT tr.*
FROM   test_runs r
JOIN   test_results tr ON tr.test_run_id = r.id
WHERE  r.project_id = :project_id
ORDER  BY r.started_at DESC;
```

### 6.4 All results for an org (two joins)

```sql
SELECT tr.*
FROM   projects p
JOIN   test_runs r     ON r.project_id    = p.id
JOIN   test_results tr ON tr.test_run_id  = r.id
WHERE  p.organization_id = :org_id;
```

### 6.5 Recent runs dashboard for a project

```sql
SELECT id, status, branch, started_at, completed_at,
       total_tests, passed, failed, skipped
FROM   test_runs
WHERE  project_id = :project_id
ORDER  BY started_at DESC
LIMIT  20;
```

---

## 7. Aggregate Counter Maintenance

The test_runs aggregate columns (total_tests, passed, failed, skipped, duration_ms) must be kept in sync as test_results rows are written.

### Option A — Incremental update on result insert (preferred)

```sql
UPDATE test_runs
SET    total_tests = total_tests + 1,
       passed      = passed  + IF(:status = 'passed',  1, 0),
       failed      = failed  + IF(:status = 'failed',  1, 0),
       skipped     = skipped + IF(:status = 'skipped', 1, 0)
WHERE  id = :run_id;
```

### Option B — Rollup at run completion

```sql
UPDATE test_runs r
JOIN (
    SELECT test_run_id,
           COUNT(*)                 AS total_tests,
           SUM(status = 'passed')   AS passed,
           SUM(status = 'failed')   AS failed,
           SUM(status = 'skipped')  AS skipped,
           SUM(duration_ms)         AS duration_ms
    FROM   test_results
    WHERE  test_run_id = :run_id
    GROUP  BY test_run_id
) agg ON agg.test_run_id = r.id
SET r.total_tests  = agg.total_tests,
    r.passed       = agg.passed,
    r.failed       = agg.failed,
    r.skipped      = agg.skipped,
    r.duration_ms  = agg.duration_ms,
    r.status       = IF(agg.failed > 0, 'failed', 'passed'),
    r.completed_at = NOW()
WHERE r.id = :run_id;
```

---

## 8. Why No Skip-Level Foreign Keys

Adding organization_id or project_id directly to test_results was considered and rejected:

| Concern | Details |
|---|---|
| Write complexity | Any insert or update touching a result would need to keep 2–3 FKs synchronized. |
| Data integrity risk | Denormalized FKs can become inconsistent (result points to org A but its run belongs to a project under org B). |
| Marginal read gain | The two-join query across test_runs and test_results is fast when both FKs are indexed. Profiling should precede any denormalization. |
| Better alternatives | If deep-hierarchy queries become a bottleneck at scale, a closure table or materialized path is preferable to ad-hoc skip-level FKs. |

---

## 9. Future Considerations

- Partitioning test_results by created_at or test_run_id once row counts exceed ~100M
- Archival strategy — move completed runs older than N days to cold storage
- `test_run_tags` junction table for freeform CI metadata tags (browser, Node version, etc.)
- Flaky test tracking — aggregate pass/fail ratio per test_name across runs (materialized or scheduled rollup)
- Coverage data — separate test_coverage table linked to test_runs
- `test_result_steps` table — structured CTRF steps (action, expected, actual, status) linked to test_results
- `parent_run_id` on test_runs — link a re-run back to the originating run
- `audit_logs` table — Business Edition: timestamp, area, user_id, operation, details (JSON)

---

## 10. Design Decisions

Recorded rationale for non-obvious choices. Append new entries as decisions are made.

---

### DD-001 — No cached aggregate counters on milestones

**Decision:** `milestones` does not carry cached `passed / failed / skipped / blocked` counters.

**Rationale:** `test_runs` already holds precomputed counters. A milestone dashboard query is a single-table SUM of those integers:

```sql
SELECT COUNT(*) AS run_count,
       SUM(passed), SUM(failed), SUM(skipped), SUM(blocked), SUM(total_tests)
FROM   test_runs
WHERE  milestone_id = ?
```

A milestone will typically contain 10–50 runs. This query is fast without caching. Adding a second cache layer would create a two-level maintenance chain (test_result insert → test_run counters → milestone counters), doubling write surface and fragility. If a milestone ever spans thousands of runs, a materialized view or scheduled rollup is the correct answer at that point.

---

### DD-002 — Milestone assignment is dual-path: API payload first, UI retroactive second

**Decision:** `test_runs.milestone_id` can be set via the CTRF ingest API payload **or** manually in the UI after the fact.

**Rationale:**

- **Primary path (API):** CI knows the release version at pipeline time. The ingest endpoint accepts an optional `milestone` field (matched by name/slug; auto-created if not found). This is the zero-friction happy path for automated pipelines.
- **Secondary path (UI):** Milestone names are sometimes decided after a sprint begins, or teams forget to configure CI. The milestone detail view allows retroactive multi-select assignment of existing runs.

The nullable `milestone_id` FK supports both paths without any schema difference. This mirrors GitHub's milestone pattern — set at creation or add it later.

---

### DD-003 — One schema, two feature tiers: gating is at the application layer

**Decision:** All tables — including those marked as Business Edition features — are deployed in every installation of CTRFHub, including Community Edition. Feature access is controlled by a license check in the application layer, not by the presence or absence of tables.

**Rationale:**

This is the standard pattern for open-core SaaS products (GitLab CE/EE, Metabase, etc.) and has three concrete advantages:

1. **Zero-migration upgrades.** A Community user who purchases a Business license gets instant access. There is no schema migration to run, no downtime, no risk of a failed ALTER TABLE at activation time.
2. **Simpler deployment.** One Docker image, one migration path, one schema version to reason about. There is no "Community schema" vs "Business schema" to maintain in parallel.
3. **Consistent data integrity.** Foreign keys and indexes that span both feature tiers are always enforced, so data written by a Business feature is never in an inconsistent state if a license lapses.

**Implementation:** A `license` table (or environment variable for self-hosted simplicity) holds the edition flag. Every Business Edition route handler and service method checks the flag at the start and returns `403 Forbidden` with a clear upgrade prompt if the check fails. The database layer has no knowledge of editions.

---

### DD-004 — Manual and automated testing hierarchies are deliberately separate

**Decision:** The manual testing tables (`test_cases`, `test_plans`, `test_plan_entries`, etc.) form their own hierarchy rooted at `projects`. They do not extend or modify the automated testing tables (`test_runs`, `test_results`).

**Rationale:**

The two execution models are fundamentally different:

| Dimension | Automated | Manual |
|---|---|---|
| Ingestion | Bulk CTRF payload from CI | One result at a time by a human |
| Lifecycle | Immutable after ingest | Mutable (status updated step by step) |
| Timing | Seconds (CI job) | Hours or days |
| Identity | `test_name` string from framework | `test_case_id` FK to a reusable spec |

Merging them into a single table would require nullable columns for each model's fields, ENUMs that conflate two different lifecycles, and conditional logic throughout the application layer.

**Cross-reference bridge (reserved for future):** `test_results` has a reserved slot for an optional `test_case_id` FK. When implemented, it will allow automated runs to be linked to their manual test_case counterpart, enabling a unified coverage view (e.g. "TC-42 passes in automation — show me the last manual execution of the same case"). This FK is intentionally not added to the schema today to avoid premature coupling.

---

### DD-005 — "Test Results" sidebar item is a project-scoped cross-run shortcut

**Decision:** The "Test Results" nav item in the sidebar is a shortcut to a flat, cross-run result view for the currently selected project, pre-filtered to the last 7 days. It is not a duplicate of the drill-in view inside a specific run.

**Rationale:** Two distinct user needs exist: (1) "What happened in run ATR-128?" — served by drilling into a run. (2) "Show me all failures across all recent runs for this project" — served by the cross-run shortcut. The shortcut enables the second workflow without forcing the user to open each run individually.

---

### DD-006 — Run ID prefix is user-settable per project; default is auto-derived from slug

**Decision:** `projects.id_prefix` (VARCHAR 10) stores a short uppercase prefix, e.g. `E2E`, `API`, `MOB`. Run display IDs are formatted as `{prefix}-{run_sequence}`. The prefix defaults to the first 4 uppercase non-separator characters of the project slug at creation time and can be changed in project settings.

**Rationale:** Testiny uses a fixed system-wide `ATR-` prefix. Making it per-project (Jira/Linear pattern) makes IDs immediately recognizable in Slack, email, and bug trackers without needing extra context. `run_sequence` is a per-project monotonic counter (INT on `test_runs`), not the global surrogate key, so IDs stay short and human-readable even at scale.

**Note:** `run_sequence` column must be added to `test_runs` and generated atomically (SELECT MAX + 1 within a transaction, or a per-project DB sequence). Reserved for implementation at the ingest service layer.

---

### DD-007 — "Upload CTRF Report" action lives on the Test Runs screen

**Decision:** The manual CTRF report upload button is placed on the Test Runs list page (top-right), not in project settings or a dedicated import screen.

**Rationale:** The Test Runs screen is where users expect to see and add runs. Placing upload there gives the action immediate context and collocates it with the results it produces.

---

### DD-008 — Dashboard is project-scoped only (no org-level dashboard in MVP)

**Decision:** The Dashboard screen shows metrics for the currently selected project only. There is no cross-project org-level dashboard in the MVP.

**Rationale:** An org-level dashboard requires aggregating across projects with potentially different reporting cadences, environments, and team contexts. The complexity is not justified for MVP. A project-level dashboard covers the primary persona's (QA lead / developer) core workflow. Org-level analytics can be added as a future Business Edition feature.