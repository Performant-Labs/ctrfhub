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
| retention_days | INT | NOT NULL, DEFAULT 90 | Nightly cron deletes runs older than this. 0 = keep forever. Org-level default; overridable per project. |
| settings | JSONB | NOT NULL, DEFAULT '{}' | Org-level preferences (timezone, etc.) per DD-009 |
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
| retention_days | INT | | NULL = inherit from org default. Set to override: e.g. 7 for noisy unit test projects, 365 for critical E2E. 0 = keep forever. |
| settings | JSONB | NOT NULL, DEFAULT '{}' | Project-level preferences per DD-009 |
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

Artifacts associated with a test result (screenshots, videos, traces, logs, HTML reports). Replaces the flat `screenshot_url` / `video_url` columns from earlier designs, allowing multiple artifacts of any type per result. Backed by an abstracted `ArtifactStorage` interface — local disk for MVP, S3-compatible for scale-out (see DD-014).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGINT | PK, AUTO_INCREMENT | |
| test_result_id | BIGINT | NOT NULL, FK → test_results.id | Indexed |
| display_name | VARCHAR(255) | NOT NULL | From CTRF `attachment.name` (e.g. "screenshot", "trace") |
| file_name | VARCHAR(500) | | Original filename for uploaded files; NULL for url type |
| content_type | VARCHAR(100) | NOT NULL | MIME type from CTRF (e.g. "image/png", "video/webm") |
| artifact_type | ENUM | NOT NULL | screenshot \| video \| trace \| log \| html_report \| other |
| storage_type | ENUM | NOT NULL | local \| s3 \| url |
| storage_key | VARCHAR(1000) | NOT NULL | For local/s3: relative storage path key. For url: the external URL (Loom, YouTube, etc.) |
| size_bytes | BIGINT | | NULL for url type |
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

### 4.15 custom_field_definitions

Org-level definitions for user-created metadata fields. Can be applied to `test_cases`, `test_results`, or `test_runs`. Definitions are created once at org level and enabled per-project.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGINT | PK, AUTO_INCREMENT | |
| org_id | BIGINT | NOT NULL, FK → organizations.id | Indexed |
| name | VARCHAR(255) | NOT NULL | e.g. "Jira Ticket", "Component", "Estimate" |
| field_type | ENUM | NOT NULL | text \| integer \| decimal \| boolean \| date \| duration \| dropdown \| url |
| entity_type | ENUM | NOT NULL | test_case \| test_result \| test_run |
| dropdown_options | JSON | | Array of option strings; only used when field_type = dropdown |
| required | BOOLEAN | NOT NULL, DEFAULT FALSE | |
| enabled | BOOLEAN | NOT NULL, DEFAULT TRUE | |
| in_new_projects | BOOLEAN | NOT NULL, DEFAULT TRUE | Auto-enable on newly created projects |
| display_order | SMALLINT | NOT NULL, DEFAULT 0 | Drag-to-reorder within entity type |
| created_by | BIGINT | NOT NULL, FK → users.id | |
| created_at | TIMESTAMP | NOT NULL, DEFAULT NOW() | |
| updated_at | TIMESTAMP | NOT NULL | |

---

### 4.16 custom_field_values

Stores the actual values for custom fields on individual entities. Uses typed value columns (not a stringly-typed catch-all) to preserve integrity and allow SQL-level filtering.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGINT | PK, AUTO_INCREMENT | |
| field_id | BIGINT | NOT NULL, FK → custom_field_definitions.id | Indexed |
| entity_id | BIGINT | NOT NULL | ID of the test_case, test_result, or test_run |
| entity_type | ENUM | NOT NULL | test_case \| test_result \| test_run — mirrors field definition |
| value_text | TEXT | | Used for text, dropdown, url field types |
| value_integer | BIGINT | | Used for integer field type |
| value_decimal | DECIMAL(18,4) | | Used for decimal field type |
| value_boolean | BOOLEAN | | Used for boolean field type |
| value_date | DATE | | Used for date field type |
| value_duration_ms | BIGINT | | Used for duration field type; stored in milliseconds |
| created_at | TIMESTAMP | NOT NULL, DEFAULT NOW() | |
| updated_at | TIMESTAMP | NOT NULL | |

> **Uniqueness:** A composite unique index on `(field_id, entity_id, entity_type)` ensures one value row per field per entity.

---

### 4.17 project_custom_field_settings

Per-project enable/disable override for each custom field definition. When `in_new_projects` is TRUE on the definition, a row is automatically created here for new projects.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGINT | PK, AUTO_INCREMENT | |
| project_id | BIGINT | NOT NULL, FK → projects.id | Indexed |
| field_id | BIGINT | NOT NULL, FK → custom_field_definitions.id | |
| enabled | BOOLEAN | NOT NULL, DEFAULT TRUE | |

---

### 4.18 project_tokens

Project-scoped ingest tokens used by CI pipelines to authenticate CTRF report submissions. Separate from personal API keys (which authenticate users). One project can have multiple tokens (e.g. one per CI environment).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGINT | PK, AUTO_INCREMENT | |
| project_id | BIGINT | NOT NULL, FK → projects.id | Indexed |
| name | VARCHAR(255) | NOT NULL | e.g. "GitHub Actions", "CI Staging" |
| token_hash | VARCHAR(255) | NOT NULL, UNIQUE | SHA-256 hash of the actual token; plaintext never stored |
| rate_limit_per_hour | INT | NOT NULL, DEFAULT 120 | Max ingest requests per hour for this token. Default 120 (CI use). Raise for high-frequency sources (device testing etc). 0 = unlimited (self-hoster accepts responsibility). |
| last_used_at | TIMESTAMP | | Updated on each successful ingest |
| created_at | TIMESTAMP | NOT NULL, DEFAULT NOW() | |
| revoked_at | TIMESTAMP | | NULL = active; set to revoke without deleting |

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
| custom_field_definitions | org_id | All field definitions for an org |
| custom_field_definitions | org_id, entity_type | All fields for a given entity type |
| custom_field_values | field_id, entity_id, entity_type | Unique value per field per entity (also enforces uniqueness) |
| custom_field_values | entity_id, entity_type | All custom field values for a given entity |
| project_custom_field_settings | project_id | All field settings for a project |
| project_tokens | project_id | All tokens for a project |
| project_tokens | token_hash | Token lookup on ingest authentication (most frequent query) |

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

---

### DD-009 — Settings use a hybrid storage model: typed columns for core fields, JSONB for preferences; auto-saved via per-field PATCH

**Decision:** Settings storage follows a two-tier hybrid model:

1. **Typed columns** — fields that are queried in JOINs, used as foreign keys, need DB-level type enforcement, or drive core system behavior (`slug`, `name`, `id_prefix`, `plan`, etc.) remain as normal typed columns on their entity table.
2. **`settings JSONB` column** — all preferences, toggles, and display options that do not need indexing or cross-table JOINs are stored in a single `settings JSONB` column on the entity row. Each entity that carries preferences (`organizations`, `projects`, `user_profiles`) gets one such column, defaulting to `{}`.
3. **`config JSONB` column** — structured third-party credentials (Slack webhook URL, Jira API token, SMTP config) live in a `config JSONB` column on their integration-specific table (`org_integrations`, `sso_configurations`), not on the org row itself.

**Auto-save pattern:** There is no Save button anywhere in Settings. Every field persists immediately on change. The implementation contract is:

- **Toggles / dropdowns** → `PATCH` fires on the `change` event.
- **Text inputs** → `PATCH` fires on `blur` or after a 600 ms debounce on `keyup` (whichever comes first). This prevents a network call on every keystroke.
- **Inline feedback** → each field shows a per-field "Saving…" spinner → "Saved ✓" confirmation. No toast notifications for settings writes.

**API design:** One narrow `PATCH` endpoint per settings group, not one monolithic endpoint. The body contains only the changed key(s):

```
PATCH /api/v1/settings/org/general          { "name": "Acme Corp" }
PATCH /api/v1/settings/org/general          { "settings": { "default_timezone": "UTC" } }
PATCH /api/v1/settings/projects/:slug       { "id_prefix": "E2E" }
PATCH /api/v1/settings/user/profile         { "settings": { "timezone": "America/Los_Angeles" } }
PATCH /api/v1/settings/user/notifications   { "event": "run_failed", "channel": "email", "enabled": true }
```

**JSONB atomic update:** Updating a single key in a JSONB column uses the PostgreSQL merge operator, which leaves all other keys untouched:

```sql
UPDATE organizations
SET    settings = settings || '{"default_timezone": "America/Los_Angeles"}'::jsonb
WHERE  id = ?;
```

**MikroORM entity convention:** Each entity with a `settings` JSONB column declares it as:

```typescript
@Property({ type: 'json', default: '{}' })
settings: Record<string, unknown> = {};
```

Specific preference keys are validated in the route handler (Zod schema), not at the ORM layer, keeping the column flexible for future additions without requiring a migration.

---

### DD-010 — Concurrent settings edits use optimistic locking + SSE push

**Decision:** Simultaneous settings edits by multiple users are handled by a two-layer strategy:

**Layer 1 — Optimistic locking (safety net, no extra infrastructure)**

Every `PATCH` request includes the `updated_at` timestamp of the value the client last read. The server executes the update conditionally:

```sql
UPDATE organizations
SET    name = ?, updated_at = NOW()
WHERE  id = ? AND updated_at = ?  -- version check
```

If `0` rows are affected, another user saved a conflicting change since the client last loaded the page. The server returns `409 Conflict` with the current value and the name of the user who made the change:

```json
{ "error": "conflict", "message": "Changed by André A. 30s ago", "current": "Acme Corp 3" }
```

The field reverts to the current value inline with a subtle "Updated by [user]" notice. No new columns are required — `updated_at` already exists on every entity table.

**Layer 2 — Server-Sent Events (SSE) for org and project settings**

When any admin saves a setting, Fastify broadcasts a `settings:changed` event to all other SSE-connected clients for that org or project. Clients update only the affected field without a page reload. HTMX's SSE extension handles this natively:

```html
<div hx-ext="sse"
     sse-connect="/api/sse/org/42/settings"
     sse-swap="settings:changed">
  <!-- individual fields re-render on event -->
</div>
```

Fastify streams SSE via `reply.raw` with no extra library. The event payload is a partial HTML fragment containing only the changed field — not the full settings page.

**Scope:** SSE is active only on org-level and project-level settings pages. Personal settings (Profile, Security, Notifications, API Keys) carry no SSE connection — only one user can edit their own personal settings.

**Failure mode:** If the SSE connection drops, the client shows stale data until reconnect. The optimistic locking layer ensures any subsequent PATCH from a stale client is rejected safely rather than silently overwriting a newer value.

---

### DD-011 — Real-time screen updates on run ingest use SSE + an EventBus abstraction

**Decision:** When a CTRF test run is ingested, all browser sessions currently viewing an affected screen are notified via the same SSE infrastructure established in DD-010. The ingest handler communicates through an `EventBus` abstraction rather than writing directly to SSE connections, enabling transparent substitution of a Redis Pub/Sub backend for horizontal scaling without changing ingest logic.

**Affected screens and update behaviour:**

| Screen | Event | Behaviour |
|---|---|---|
| Test Runs list | `run.created` | Shows a sticky "↑ N new run(s) — click to load" banner; does not auto-insert (avoids disrupting users reading the list) |
| Dashboard | `run.created` | Silent auto-update of KPI cards and trend chart via HTMX partial re-render |
| Project list | `run.created` | Silent update of the affected project row (last run timestamp + status badge) |
| Milestones *(Business)* | `run.created` | Silent update of the milestone progress bar if `run.milestone_id` is set |
| Test Run Detail | — | Not applicable; runs are complete batches on ingest; no in-flight streaming in MVP |

**SSE channel:** One persistent stream per authenticated user per org — `GET /api/sse/orgs/:orgId`. All event types (settings changes from DD-010 AND data events) flow through this single stream. The client filters by `event:` type.

**Event format:**

```
event: run.created
data: {"projectId":42,"projectSlug":"frontend-e2e","runId":891,"status":"failed","passRate":0.94}
```

**HTMX wiring examples:**

```html
<!-- Dashboard KPI cards — silent auto-update -->
<div id="kpi-cards"
     hx-get="/projects/frontend-e2e/dashboard/kpis"
     hx-trigger="sse:run.created"
     hx-swap="outerHTML">

<!-- Project list row — targeted row update -->
<tr id="project-row-42"
    hx-get="/projects/frontend-e2e/row"
    hx-trigger="sse:run.created[detail.projectId==42]"
    hx-swap="outerHTML">

<!-- Test Runs list — deferred banner (not silent) -->
<div id="new-run-banner" class="hidden">
  ↑ 1 new run — click to load
</div>
```

**EventBus abstraction:**

The ingest handler calls `eventBus.publish()` — never the SSE registry directly. For MVP (single node) the bus is an in-memory emitter. For multi-node deployments, the bus implementation is swapped to Redis Pub/Sub with no changes to the ingest handler.

```typescript
interface EventBus {
  publish(channel: string, event: string, data: object): Promise<void>;
  subscribe(channel: string, handler: (event: string, data: object) => void): void;
}

// MVP: in-memory
// Production scale-out: Redis Pub/Sub
```

---

### DD-012 — SSE connections and API endpoints are rate-limited and capacity-bounded; self-hosted deployments require a reverse proxy

**Decision:** CTRFHub enforces resource limits at three layers: the reverse proxy, the Fastify application layer, and per-SSE-connection accounting. "Allow until it falls over" is explicitly rejected — unbounded connections make the server trivially resource-exhaustible and a DDoS target.

**Layer 1 — Reverse proxy (Nginx / Caddy)**

Required for all production deployments. CTRFHub ships a reference Nginx/Caddy config in its Docker Compose bundle. Requests violating these limits never reach Node.js:

- `limit_conn`: max 20 concurrent connections per IP
- `limit_req`: max 50 requests/sec per IP (burst: 20)
- SSE routes: `proxy_read_timeout 3600s` (long-lived) but still count against `limit_conn`

**Layer 2 — Fastify application rate limits (`@fastify/rate-limit`)**

| Endpoint class | Limit | Rationale |
|---|---|---|
| Login / forgot-password | 10 req/min per IP | Brute force / credential stuffing protection |
| CTRF ingest (`POST /runs`) | Default 120 req/hour per project token; configurable per token via `project_tokens.rate_limit_per_hour` (0 = unlimited) | CI misconfiguration guard; high-frequency sources (device testing, etc.) can raise the limit per token in CI Integration settings |
| Settings `PATCH` | 60 req/min per authenticated user | Auto-save debounce already reduces volume |
| SSE `GET /api/sse/*` | 1 new connection per user per 2s | Prevents rapid reconnect amplification |
| General authenticated API | 600 req/min per user | Generous for normal interactive use |

**Layer 3 — SSE connection accounting**

Each open SSE connection holds a file descriptor and ~50–100 KB of Node.js memory. Limits are enforced in the SSE route handler before the stream is opened:

| Limit | Value | Enforcement |
|---|---|---|
| Per user (tabs / devices) | 10 concurrent connections | In-memory counter: `userId → count` |
| Per org (Community Edition) | 50 concurrent connections | Hard cap; not license-derived |
| Per org (Business Edition) | `license.seats × 5` | Uses existing `licenses.seats` column |
| Server-wide hard cap | 5,000 connections | Returns `503 Service Unavailable` above this |
| Max connection age | 1 hour | Server closes cleanly; client reconnects silently |
| Keepalive ping interval | 30 seconds | Detects dead connections and triggers cleanup |

When a user opens an 11th tab, the oldest SSE connection for that user is closed gracefully. When an org reaches its limit, new SSE connect requests return `429 Too Many Requests` — the page still loads and functions normally, it simply does not receive live push updates until a slot frees.

**Connection lifecycle (Fastify):**

```typescript
fastify.get('/api/sse/orgs/:orgId', async (request, reply) => {
  // 1. Authenticate session
  // 2. Verify org membership
  // 3. Enforce per-user limit
  const userConnections = sseUserCounts.get(userId) ?? 0;
  if (userConnections >= 10)
    return reply.status(429).send({ error: 'too_many_tabs' });

  // 4. Enforce per-org limit
  const orgLimit = license.plan === 'business' ? license.seats * 5 : 50;
  const orgConnections = sseOrgCounts.get(orgId) ?? 0;
  if (orgConnections >= orgLimit)
    return reply.status(429).send({ error: 'org_connection_limit' });

  // 5. Register and stream
  sseUserCounts.set(userId, userConnections + 1);
  sseOrgCounts.set(orgId, orgConnections + 1);
  reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream',
                              'Cache-Control': 'no-cache',
                              'X-Accel-Buffering': 'no' });

  // 6. Max age — force reconnect after 1 hour
  const maxAge = setTimeout(() => reply.raw.end(), 3_600_000);

  // 7. Keepalive ping every 30s
  const ping = setInterval(() => reply.raw.write(': keepalive\n\n'), 30_000);

  // 8. Cleanup on disconnect
  request.raw.on('close', () => {
    sseUserCounts.set(userId, Math.max(0, (sseUserCounts.get(userId) ?? 1) - 1));
    sseOrgCounts.set(orgId, Math.max(0, (sseOrgCounts.get(orgId) ?? 1) - 1));
    clearTimeout(maxAge);
    clearInterval(ping);
  });
});
```

**DDoS surface summary:** All SSE endpoints require a valid authenticated session — unauthenticated SSE connections are rejected at step 1 before any stream is opened. The ingest endpoint requires a valid project token. The only unauthenticated attack surface is the login page and the health check endpoint, both of which are covered by the reverse proxy `limit_req` rule.

---

### DD-013 — Loading states are contextual, delayed, and scoped to the updating element; global top-bar progress indicators are not used

**Decision:** CTRFHub does not use a global top-of-page progress bar (NProgress style) for loading feedback. All loading indicators are:

1. **Contextual** — scoped to the specific element being updated, not the full page. A table refresh shows nothing on the header; a button action shows nothing on the sidebar.
2. **Delayed** — only appear if the response takes longer than 150 ms. Fast responses feel instant with no indicator flash.
3. **Tiered** — the indicator type matches the nature of the interaction.

**Tier table:**

| Scenario | Loading indicator |
|---|---|
| Settings auto-save (toggle, text blur) | Nothing → per-field "Saving… → ✓" (DD-009) |
| Table / list HTMX refresh | Opacity fade to 60% on the container (CSS only) |
| Button action (Delete, Create) | Inline dot spinner inside button + `disabled` attribute |
| File upload / CTRF ingest | Determinate progress bar *inside the upload widget only* — the one case where a bar is semantically correct (actual % progress) |
| Dashboard KPI card refresh | Skeleton shimmer on card outlines (deferred — see below) |
| Page-level navigation | Nothing for <150 ms; opacity fade on `<main>` for slower responses |

**HTMX implementation contract:**

Every HTMX element must be written with the indicator hook in place from the start, even if the visual polish is deferred. This ensures no HTMX markup needs to be retroactively updated when loading states are implemented.

```html
<!-- Every hx-* element that updates content includes hx-indicator -->
<div id="runs-table"
     hx-get="/projects/frontend-e2e/runs"
     hx-trigger="sse:run.created"
     hx-swap="outerHTML"
     hx-indicator="#runs-table">  <!-- self-indicating -->
</div>

<!-- Buttons include an explicit indicator target -->
<button id="delete-run-btn"
        hx-delete="/runs/891"
        hx-confirm="..."
        hx-indicator="#delete-run-btn">
  Delete run
  <span class="htmx-indicator btn-spinner" aria-hidden="true"></span>
</button>
```

**Global CSS convention** (write once in `index.css`; refine visuals later without touching markup):

```css
/* Delayed reveal — no flash for fast (<150ms) responses */
.htmx-indicator {
  opacity: 0;
  transition: opacity 0s 150ms;
}
.htmx-request .htmx-indicator,
.htmx-request.htmx-indicator {
  opacity: 1;
  transition: opacity 200ms ease 150ms;
}

/* Fade the element being replaced — zero extra HTML needed */
.htmx-request {
  opacity: 0.6;
  transition: opacity 200ms ease 150ms;
}

/* Buttons get their own treatment — no fade, just disable */
button.htmx-request {
  opacity: 1;        /* override the fade */
  pointer-events: none;
  cursor: not-allowed;
}
```

**What is deferred:** The skeleton shimmer component (for Dashboard KPI cards and large content areas) requires CSS animation work and is explicitly not part of the initial implementation. The `hx-indicator` hooks will be in place; only the visual style of `.htmx-indicator` inside those elements is left as a TODO.

**What is not permitted:** A full-page NProgress-style bar, spinner overlays that cover interactive content, or any loading state that blocks user interaction with unrelated parts of the page.

---

### DD-014 — Test artifact storage uses an abstracted ArtifactStorage interface; local disk for MVP, S3-compatible for scale-out; external URLs are stored by reference only

**Decision:** Test artifacts (screenshots, videos, traces, HTML reports) are stored via an `ArtifactStorage` interface that has two concrete implementations selected by the `ARTIFACT_STORAGE` env var. External URLs (Loom, YouTube, CI artifact links) are never downloaded — they are stored as `storage_type: 'url'` references and rendered client-side.

**ArtifactStorage interface:**

```typescript
interface ArtifactStorage {
  // Store a file buffer, return the storage key
  store(key: string, buffer: Buffer, contentType: string): Promise<void>;
  // Return a URL the browser can fetch (signed URL for S3, direct route for local)
  getUrl(key: string, expiresInSeconds?: number): Promise<string>;
  // Delete a file (called by retention sweep)
  delete(key: string): Promise<void>;
  // Delete all files under a prefix (e.g. all artifacts for a run)
  deletePrefix(prefix: string): Promise<void>;
}

// Storage key convention: orgs/{orgId}/runs/{runId}/results/{resultId}/{filename}
// This prefix structure enables deletePrefix() to clean up an entire run in one call
```

**Implementations:**

| `ARTIFACT_STORAGE` | Class | Notes |
|---|---|---|
| `local` (default) | `LocalArtifactStorage` | Files at `ARTIFACT_LOCAL_PATH` (default `/data/artifacts`); served via `GET /api/files/*` Fastify route; no CDN |
| `s3` | `S3ArtifactStorage` | Any S3-compatible endpoint (`S3_ENDPOINT`, `S3_BUCKET`, `S3_KEY`, `S3_SECRET`); works with AWS S3, Cloudflare R2, MinIO |

**Playwright artifact handling:**

Playwright is the most common CTRF source. It emits the following attachment types which must all be handled:

| Playwright artifact | CTRF `contentType` | `artifact_type` | Rendering |
|---|---|---|---|
| Screenshot | `image/png` | `screenshot` | Inline `<img>` thumbnail; lightbox on click |
| Video recording | `video/webm` | `video` | `<video controls>` in failure detail row |
| Trace file | `application/zip` | `trace` | Download link + "Open in Trace Viewer" button |
| HTML report bundle | `application/zip` or `text/html` | `html_report` | Opens in new tab at `/runs/:id/report/` |

**Playwright Trace Viewer deep link:**

Playwright's trace viewer (`trace.playwright.dev`) accepts a `?trace=` URL parameter pointing to the trace zip file. CTRFHub generates this link dynamically:

```
https://trace.playwright.dev/?trace={storageUrl}
```

Where `{storageUrl}` is either:
- A pre-signed S3 URL (when `ARTIFACT_STORAGE=s3`)
- The direct Fastify file serve URL (when `ARTIFACT_STORAGE=local` — requires CTRFHub to be publicly accessible from the user's browser, which it must be to use the UI at all)

The "Open in Trace Viewer" button is shown on any artifact where `artifact_type = 'trace'` and `content_type = 'application/zip'`.

**HTML report bundle handling:**

Playwright HTML reports are multi-file zips (`index.html` + data JSON + assets). When uploaded:
1. Server detects `artifact_type = html_report` + `content_type = application/zip`
2. Unzips to `{ARTIFACT_LOCAL_PATH}/orgs/{orgId}/runs/{runId}/html-report/` (or S3 prefix)
3. `index.html` and assets served at `/runs/:runId/report/` via static file route
4. Opened in a new browser tab (not an iframe — Playwright HTML reports have their own navigation)

Single-file `text/html` attachments are served in a sandboxed `<iframe>`.

**Ingest flow — multipart upload:**

```
POST /api/v1/projects/:slug/runs
Content-Type: multipart/form-data

[field] ctrf            ← CTRF JSON (required)
[file]  screenshot.png  ← matches attachment.path in CTRF (optional)
[file]  video.webm      ← matches attachment.path in CTRF (optional)
[file]  trace.zip       ← matches attachment.path in CTRF (optional)
```

Processing order:
1. Parse and validate CTRF JSON
2. Create `test_runs` + `test_results` rows
3. For each `attachment` in each test result:
   - If `path` starts with `http://` or `https://` → store as `storage_type: 'url'`, `storage_key: path`
   - Otherwise → match `path` to an uploaded file part, store via `ArtifactStorage`, create `test_artifacts` row
4. Broadcast `run.created` SSE event

**File size limits:**

| Content type | Per-file limit | Rationale |
|---|---|---|
| `image/*` | 10 MB | Screenshots are never this large in practice |
| `video/webm`, `video/mp4` | 100 MB | Short Playwright recordings |
| `application/zip` (trace, HTML report) | 200 MB | Large Playwright traces with network data |
| `text/*` (logs) | 5 MB | Log files rarely exceed this |
| Per-run total | 1 GB | Configurable via `MAX_ARTIFACT_SIZE_PER_RUN` env var |

Files exceeding the per-file limit return `413 Payload Too Large` with a message. Files exceeding the per-run total are rejected after the run row is created — the run still appears but the oversized attachment is omitted with a warning flag on the `test_artifacts` row.

**External video links (Loom, YouTube, Sentry replays):**

When `storage_type = 'url'`, CTRFHub detects the domain and renders appropriately:

| Domain pattern | Rendering |
|---|---|
| `loom.com` | Loom embed (`<iframe src="https://www.loom.com/embed/{id}">`) |
| `youtube.com`, `youtu.be` | YouTube embed |
| `vimeo.com` | Vimeo embed |
| Everything else | Plain `<a>` link with external link icon |

**Retention integration:**

The nightly retention sweep (PL-006) deletes artifact files alongside their parent runs:
1. Identify `test_runs` rows to delete (age > retention_days, not milestone-protected)
2. For each run, call `artifactStorage.deletePrefix('orgs/{orgId}/runs/{runId}/')` before deleting DB rows
3. Then delete DB rows (cascades to `test_artifacts`)

This ensures orphaned files never accumulate on disk or in S3.

---

### DD-015 — A System status page under Org Settings gives administrators operational visibility; all sensitive credentials are excluded

**Decision:** CTRFHub ships a System status page at `GET /org/settings/system`, accessible to org owners and admins only. The page provides live operational data gathered on each request. No credentials, connection strings, or secret env vars are ever included in the response.

**What the page shows:**

| Section | Data | Source |
|---|---|---|
| System Info | CTRFHub version, Node.js version, PostgreSQL version, uptime, edition, active SSE connections, storage backend | `process.*`, `SELECT version()`, in-memory registry |
| Database | Row count + table/index/total size for 8 key tables; total DB size | `pg_statio_user_tables` + `pg_class` + `pg_database_size()` |
| Artifact Storage | File count + total size grouped by `artifact_type`; external URL count | `SELECT ... FROM test_artifacts GROUP BY artifact_type` |
| Disk Space | Volume path, total, used, free, % used with colour-coded progress bar | `check-disk-space` npm package — shown only when `ARTIFACT_STORAGE=local` |
| Retention Policy | Org default `retention_days`, next scheduled sweep time | `organizations.retention_days`, `RETENTION_CRON_SCHEDULE` env var |

**DB query for table sizes:**

```sql
SELECT
  t.tablename,
  c.reltuples::bigint                                                             AS estimated_rows,
  pg_size_pretty(pg_relation_size(t.schemaname||'.'||t.tablename))               AS table_size,
  pg_size_pretty(
    pg_total_relation_size(t.schemaname||'.'||t.tablename) -
    pg_relation_size(t.schemaname||'.'||t.tablename))                            AS index_size,
  pg_size_pretty(pg_total_relation_size(t.schemaname||'.'||t.tablename))         AS total_size,
  pg_total_relation_size(t.schemaname||'.'||t.tablename)                         AS total_bytes
FROM pg_statio_user_tables t
JOIN pg_class c ON c.relname = t.tablename
WHERE t.tablename IN (
  'test_results', 'test_runs', 'test_artifacts',
  'audit_logs', 'custom_field_values', 'test_result_comments',
  'organizations', 'projects'
)
ORDER BY total_bytes DESC;
```

**Disk space progress bar — CSS-only colour coding:**

```css
.disk-bar { background: var(--color-surface-2); border-radius: 4px; height: 8px; }
.disk-bar__fill { height: 100%; border-radius: 4px; background: var(--color-pass); }
.disk-bar__fill[data-pct="amber"] { background: var(--color-warn); }  /* > 70% used */
.disk-bar__fill[data-pct="red"]   { background: var(--color-fail); }  /* > 90% used */
```

The `data-pct` attribute is set server-side in the Eta template — no JavaScript needed.

**Excluded from the page:**
- `DATABASE_URL` (contains password)
- `S3_KEY` and `S3_SECRET`
- `SESSION_SECRET`
- Any env var containing `SECRET`, `PASSWORD`, `KEY`, or `TOKEN`

**Deferred:** Growth trend ("disk will fill in X months") requires daily `system_snapshots` rows written by the nightly worker. This is tracked as PL-008. The System page renders without it — that section is simply omitted from the MVP.