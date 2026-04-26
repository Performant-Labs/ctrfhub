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
- **Denormalized aggregates on test_runs** — summary counters (passed/failed/skipped/blocked) are cached at the run level to avoid expensive COUNT queries on test_results at dashboard load time
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

> **Tables owned by Better Auth (not defined here).** Better Auth manages its own schema for authentication primitives — `users`, `sessions`, `accounts`, `apiKey` (= personal_api_tokens in this spec), `organization` (= organizations), `member` (= organization_members), and `verification`. Where those tables appear in ERD relationships or FK references below, the column names and constraints follow the Better Auth schema, not this spec. CTRFHub migrations do not create or alter these tables; schema changes come in through the Better Auth version bump. See DD-001 for the authentication stack decision.
>
> All other tables in §4 are CTRFHub-owned and created by CTRFHub migrations.

### 4.1 organizations

Top-level tenant boundary. All data within the system belongs to an organization.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGINT | PK, AUTO_INCREMENT | Surrogate key |
| name | VARCHAR(255) | NOT NULL | Display name |
| slug | VARCHAR(100) | NOT NULL, UNIQUE | URL-safe identifier |
| retention_days | INT | NOT NULL, DEFAULT 90 | Nightly cron deletes runs older than this. 0 = keep forever. Org-level default; overridable per project. |
| settings | JSONB | NOT NULL, DEFAULT '{}' | Org-level preferences (timezone, etc.) per DD-009 |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | NOT NULL | |

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
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | NOT NULL | |

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
| released_at | TIMESTAMPTZ | | Actual release date (set when closed) |
| created_by | BIGINT | FK → users.id (Better Auth) | |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | NOT NULL | |

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
| started_at | TIMESTAMPTZ | | |
| completed_at | TIMESTAMPTZ | | |
| duration_ms | INT | | Wall-clock duration |
| total_tests | INT | NOT NULL, DEFAULT 0 | Cached aggregate |
| passed | INT | NOT NULL, DEFAULT 0 | Cached aggregate |
| failed | INT | NOT NULL, DEFAULT 0 | Cached aggregate |
| skipped | INT | NOT NULL, DEFAULT 0 | Cached aggregate |
| blocked | INT | NOT NULL, DEFAULT 0 | Cached aggregate |
| ai_root_causes | JSONB | | Root cause clusters from A2 (see `ai-features.md`); NULL until A2 runs or if run has no failures |
| ai_root_causes_at | TIMESTAMPTZ | | When A2 completed; NULL = not yet run |
| ai_summary | TEXT | | Plain English run narrative from A3 (see `ai-features.md`); NULL until A3 completes |
| ai_summary_at | TIMESTAMPTZ | | When A3 completed; NULL = not yet run |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |

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
| ai_category | ENUM | | `app_defect \| test_data \| script_error \| environment \| unknown`; NULL = not yet categorized or test is not `failed`; see DD-016 |
| ai_category_override | ENUM | | User's manual choice; same enum values as `ai_category`; NULL = no override. **Takes precedence over `ai_category` for display.** Preserves original AI prediction alongside user correction. |
| ai_category_model | VARCHAR(100) | | Model that produced the categorization, e.g. `gpt-4o-mini`; NULL until run |
| ai_category_at | TIMESTAMPTZ | | When AI categorization completed; NULL = not yet run |
| flaky_score | FLOAT | | 0.0–1.0 flakiness score (A8, Phase 2); computed by nightly worker; NULL until first calculation. > 0.7 = likely flaky |
| error_hash | VARCHAR(64) | | SHA-256 of normalized `error_message`; used for cross-run failure matching (A6). NULL if `error_message` is empty |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |

**On the `blocked` status value.** `blocked` is reserved for tester-judgment scenarios — a test that could not be run because of an environment issue, an upstream dependency failure, or a pre-requisite block. It is not produced by CTRF ingest (the CTRF spec has no `blocked` status) and it is not produced by standard automated test frameworks (JUnit, pytest, Mocha, Playwright, Cypress, etc. have no equivalent). Writers in CTRFHub are:

- **Business Edition manual test execution** — `test_plan_entries.status = 'blocked'` mirrors into a corresponding `test_results` row when a run is produced from a manual test plan. This is the primary writer.
- **Custom reporters** — teams whose pipelines carry blocked semantics (e.g. an upstream fixture failed) can emit CTRF `extra` fields that a custom ingest adapter maps to `blocked`. Not part of the stock ingest path.
- **CTRF `other` mapping (future)** — see the handling of CTRF `other` status. A configurable ingest rule could route `other` to `blocked` for teams that use them interchangeably.

In pure Community Edition deployments with stock CTRF ingest and no custom adapter, `blocked` will be permanently zero. The counter column, ENUM value, and UI surface are still wired through so enabling Business Edition or a custom writer is a no-code change.

**On the `assigned_to` lifecycle.** `assigned_to` stores the single user ID responsible for investigating or fixing a failed test result. Single-assignee by design (multi-assignee adds UI complexity and was explicitly out of scope for MVP — multiple people can still collaborate via comments). The full state machine:

| Event | Effect on `assigned_to` |
|---|---|
| New `test_results` row ingested | `NULL` (never auto-assigned — no signal in CTRF to assign from) |
| User clicks "Assign to me" | Set to the acting user's ID |
| User clicks "Assign to…" dropdown | Set to selected user's ID (org members only; scoped at the API layer) |
| User clicks "Unassign" | Cleared to `NULL` |
| Run with the result is deleted | Row is deleted via `ON DELETE CASCADE` — assignment deleted with it |
| Assigned user is removed from the org | **On next write to `assigned_to` for that row**, the FK would fail. To prevent orphan FKs, the `users` → org removal flow runs a pre-deletion query: `UPDATE test_results SET assigned_to = NULL WHERE assigned_to = :userId AND project_id IN (SELECT id FROM projects WHERE organization_id = :orgId)`. Applied in the same transaction as `organization_members` row deletion. |
| Assigned user is re-invited to the org later | No auto-reassignment — historical rows stay `NULL`. |
| Test passes in a subsequent run | **Does not auto-unassign.** `assigned_to` lives on the specific `test_results` row, not on the logical test. The next run creates new `test_results` rows with `assigned_to = NULL`. A user who wants "assignment follows the test across runs" should use comments or a milestone instead — this is a deliberate design choice to keep per-result semantics narrow. |
| Result is re-categorized (`ai_category_override`) | No effect on `assigned_to`. |
| Retention sweep deletes the run | `assigned_to` deleted with the row (cascade). |

**Why cleared to NULL instead of reassigned-to-admin on user removal:** reassigning to a surviving admin creates a task they didn't accept and never saw. NULL is the honest state ("this assignment is gone") and the dashboard's "Unassigned failures" filter surfaces it naturally.

**Who can set `assigned_to`:** any org member with write access to the project. Viewers cannot assign. Users cannot assign tests to users outside their org. Enforced at the API layer by `PATCH /api/v1/runs/:runId/results/:resultId/assignment`.

The same state machine applies to `test_plan_entries.assigned_to` (Business Edition) — see §4.16.

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
| content_type_verified | BOOLEAN | NOT NULL, DEFAULT TRUE | Set TRUE when the magic-bytes check (DD-028 I4) confirmed the file signature matches the stored `content_type` at upload time. Set FALSE by back-fill if a row predates the check. Forensic signal only — `content_type` is still the authoritative on-wire value. |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |

---

### 4.7 test_result_comments

Free-text comments on individual test results. Supports the post-run triage workflow (explaining a failure, noting a known issue, @-mentioning a teammate).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGINT | PK, AUTO_INCREMENT | |
| test_result_id | BIGINT | NOT NULL, FK → test_results.id | Indexed |
| user_id | BIGINT | NOT NULL, FK → users.id (Better Auth) | Author |
| body | TEXT | NOT NULL | Comment content (plain text or Markdown) |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | NOT NULL | |

---

### 4.8 ai_pipeline_log

One row per AI pipeline stage per run. Records timing, status, and token usage for observability (System Status page) and startup recovery (see DD-016 for A1, DD-017 for A2–A4). This table is also the **source of truth for pipeline scheduling** — the EventBus signals "consider scheduling", but workers reserve and commit work against rows in this table so a crash never loses a job.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGINT | PK, AUTO_INCREMENT | |
| test_run_id | BIGINT | NOT NULL, FK → test_runs.id ON DELETE CASCADE | Indexed |
| stage | VARCHAR(20) | NOT NULL | `categorize` \| `correlate` \| `summarize` \| `anomaly` |
| status | ENUM | NOT NULL | `pending` \| `running` \| `done` \| `failed` |
| worker_id | VARCHAR(64) | | Identifier of the worker holding the row while `status='running'`. NULL otherwise. Format: `{hostname}:{pid}:{bootId}`. |
| heartbeat_at | TIMESTAMPTZ | | Last heartbeat from the owning worker (updated every ~15s while `status='running'`). Used by the sweeper to detect crashed workers. NULL when not running. |
| attempt | TINYINT | NOT NULL, DEFAULT 0 | Incremented on each `pending → running` transition. Capped at 3 (after which the row is marked `failed`). |
| error | TEXT | | Error message if status = `failed` |
| tokens_used | INT | | Prompt + completion tokens; used for AI cost tracking |
| started_at | TIMESTAMPTZ | | First time the row transitioned to `running` (for cost/latency dashboards; not reset on restart). |
| completed_at | TIMESTAMPTZ | | |

**Constraints:**
- `UNIQUE (test_run_id, stage)` — enables idempotent upserts and guarantees at most one row per (run, stage). The categorizer, correlator, summarizer, and anomaly detector all use `INSERT … ON CONFLICT DO NOTHING` to claim their stage row.
- `ON DELETE CASCADE` to `test_runs` — retention cleanup is transitive; deleting an old run removes its pipeline rows in the same statement.

Retained for 90 days (aligned with default run retention). Up to 4 rows per run when all pipeline stages complete.

---

### 4.9 ai_anomalies *(Phase 2 — A4)*

Anomalies detected by Feature A4 (Trend Anomaly Detection). Schema deployed in all installations; rows written only when anomaly detection activates (requires 7+ prior runs per project for a baseline).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGINT | PK, AUTO_INCREMENT | |
| test_run_id | BIGINT | NOT NULL, FK → test_runs.id | Indexed |
| anomaly_type | VARCHAR(50) | NOT NULL | `pass_rate_drop` \| `duration_spike` \| `new_failure` \| `flaky_increase` \| `category_shift` |
| severity | ENUM | NOT NULL | `info` \| `warning` \| `critical` |
| description | TEXT | NOT NULL | Plain English explanation surfaced in the UI |
| data | JSONB | | Supporting data: delta values, affected test IDs, baseline comparison |
| acknowledged | BOOLEAN | NOT NULL, DEFAULT FALSE | Set when a user dismisses the anomaly |
| acknowledged_by | BIGINT | FK → users.id | NULL until acknowledged |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |

---

### Manual Testing Tables *(Business Edition feature — schema always deployed)*

> These tables are not part of the MVP but are part of the baseline schema deployed in every installation. Access is gated at the application layer by license check (see DD-003). No automated-side tables are modified; the two hierarchies are deliberately separate (see DD-004).

---

### 4.10 test_cases *(Business Edition)*

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
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | NOT NULL | |

---

### 4.11 test_case_steps *(Business Edition)*

Ordered steps within a test case definition. Steps belong to the spec, not to any execution.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGINT | PK, AUTO_INCREMENT | |
| test_case_id | BIGINT | NOT NULL, FK → test_cases.id | Indexed |
| step_order | SMALLINT | NOT NULL | 1-indexed display order |
| action | TEXT | NOT NULL | What the tester should do |
| expected | TEXT | | Expected outcome |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |

---

### 4.12 test_plan_templates *(Business Edition)*

A reusable collection of test cases that can be instantiated into multiple test plans. Acts as a blueprint; does not hold execution results.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGINT | PK, AUTO_INCREMENT | |
| project_id | BIGINT | NOT NULL, FK → projects.id | Indexed |
| name | VARCHAR(255) | NOT NULL | e.g. "Full Regression Checklist" |
| description | TEXT | | |
| created_by | BIGINT | NOT NULL, FK → users.id | |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | NOT NULL | |

---

### 4.13 test_plan_template_entries *(Business Edition)*

The ordered set of test cases that belong to a template.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGINT | PK, AUTO_INCREMENT | |
| template_id | BIGINT | NOT NULL, FK → test_plan_templates.id | Indexed |
| test_case_id | BIGINT | NOT NULL, FK → test_cases.id | |
| entry_order | SMALLINT | NOT NULL | Display order within template |

---

### 4.14 test_plans *(Business Edition)*

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
| closed_at | TIMESTAMPTZ | | |
| created_by | BIGINT | NOT NULL, FK → users.id | |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | NOT NULL | |

---

### 4.15 test_plan_entries *(Business Edition)*

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
| executed_at | TIMESTAMPTZ | | When the result was recorded |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | NOT NULL | |

---

### 4.16 test_plan_entry_steps *(Business Edition)*

Step-level execution results for a single test plan entry. Records actual vs expected outcome per step. Definition (expected) lives in `test_case_steps`; execution result (actual) lives here.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGINT | PK, AUTO_INCREMENT | |
| test_plan_entry_id | BIGINT | NOT NULL, FK → test_plan_entries.id | Indexed |
| test_case_step_id | BIGINT | NOT NULL, FK → test_case_steps.id | Links to the step definition |
| status | ENUM | NOT NULL, DEFAULT 'not_run' | not_run \| passed \| failed \| blocked |
| actual | TEXT | | Observed outcome (free text) |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | NOT NULL | |

---

### 4.17 custom_field_definitions

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
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | NOT NULL | |

---

### 4.18 custom_field_values

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
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | NOT NULL | |

> **Uniqueness:** A composite unique index on `(field_id, entity_id, entity_type)` ensures one value row per field per entity.

---

### 4.19 project_custom_field_settings

Per-project enable/disable override for each custom field definition. When `in_new_projects` is TRUE on the definition, a row is automatically created here for new projects.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGINT | PK, AUTO_INCREMENT | |
| project_id | BIGINT | NOT NULL, FK → projects.id | Indexed |
| field_id | BIGINT | NOT NULL, FK → custom_field_definitions.id | |
| enabled | BOOLEAN | NOT NULL, DEFAULT TRUE | |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | NOT NULL | |

> **Uniqueness:** `UNIQUE (project_id, field_id)` — one override row per field per project. Prevents accidental duplicate toggles if the settings UI double-submits or the `in_new_projects` seeding runs twice for the same project.

---

### 4.20 project_tokens

> **DEPRECATED (2026-04-25, post-AUTH-001).** Better Auth's `apikey` table is the canonical token store; per-token policy (rate limits, permissions) lives in `apikey.metadata` (JSON). The schema below is preserved for historical context. New code MUST NOT migrate or read from `project_tokens` — see DD-012 (rate-limit `keyGenerator` reads `apikey.metadata.rateLimit?.perHour`) and DD-019 (`?on_duplicate=replace` checks `apikey.metadata.permissions?` for `'ingest:replace'`). SET-001 (project-settings token tab) reads/writes via Better Auth's API, not this table. The `project_slug_aliases` sub-table below remains canonical and unaffected.

**Per-token policy schema (`apikey.metadata` JSON, MVP shape):**

```typescript
type ApiKeyMetadata = {
  projectId: number;                  // required — scope check (set by setup wizard / token-create UI)
  rateLimit?: { perHour: number };    // absent → default 120; perHour: 0 → unlimited
  permissions?: string[];             // absent → empty; e.g. ['ingest:replace'] for DD-019 replace mode
};
```

Defaults are applied in code, not in the DB. Better Auth's metadata column is JSON in SQLite and JSONB in Postgres.

---

Project-scoped ingest tokens used by CI pipelines to authenticate CTRF report submissions. Separate from personal API keys (which authenticate users). One project can have multiple tokens (e.g. one per CI environment).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGINT | PK, AUTO_INCREMENT | |
| project_id | BIGINT | NOT NULL, FK → projects.id | Indexed |
| name | VARCHAR(255) | NOT NULL | e.g. "GitHub Actions", "CI Staging" |
| token_hash | VARCHAR(255) | NOT NULL, UNIQUE | SHA-256 hash of the actual token; plaintext never stored |
| rate_limit_per_hour | INT | NOT NULL, DEFAULT 120 | Max ingest requests per hour for this token. Default 120 (CI use). Raise for high-frequency sources (device testing etc). 0 = unlimited (self-hoster accepts responsibility). |
| last_used_at | TIMESTAMPTZ | | Updated on each successful ingest |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |
| revoked_at | TIMESTAMPTZ | | NULL = active; set to revoke without deleting |

**Ingest URL and slug renames.** The canonical ingest URL uses the project **slug**, not `project_id`:

```
POST /api/v1/projects/:slug/runs
Headers: x-api-token: <token>
```

A user renaming a project slug in project settings would otherwise silently break every CI pipeline pointing at the old URL — the server would return `404 project not found` and the CI author has no way to distinguish that from a typo.

**Mitigation (MVP — shipped alongside the token model, not deferred):**

1. **`project_slug_aliases` table** records every historical slug for a project. Created automatically on every slug change.

   | Column | Type | Constraints | Notes |
   |---|---|---|---|
   | id | BIGINT | PK, AUTO_INCREMENT | |
   | project_id | BIGINT | NOT NULL, FK → projects.id ON DELETE CASCADE | |
   | slug | VARCHAR(100) | NOT NULL, UNIQUE | The old slug |
   | created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | When this slug was retired |

2. **Ingest lookup order:** `projects.slug` first, then `project_slug_aliases.slug`. A hit on `project_slug_aliases` returns the current `project_id` and ingest proceeds normally. The response includes `X-CTRFHub-Slug-Deprecated: <new-slug>` so CI can log it.

3. **Slug rename UI warning:** when an admin changes a slug, the confirmation dialog shows the count of tokens for the project and a one-line copy-paste replacement for any documented reporter URL ("Your old ingest URL remains valid indefinitely via redirect, but prefer updating CI configs to the new slug.").

4. **404 response for an unknown slug:** the error body explicitly lists the project's current slug if the token matches a project with a different slug than the URL used. This turns the single most common "my CI broke after a rename" case into a self-diagnosing error.

Tokens themselves are never re-generated on slug change — `project_tokens.token_hash` stays stable. Only the URL path changes. Revoking a token is the right action for a security event; a slug change is not one.

---

### 4.21 project_webhooks *(outbound notifications — MVP)*

Per-project outbound webhook configurations. One row per destination URL. See DD-018.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGINT | PK, AUTO_INCREMENT | |
| project_id | BIGINT | NOT NULL, FK → projects.id ON DELETE CASCADE | Indexed |
| name | VARCHAR(255) | NOT NULL | e.g. "Slack #incidents", "Zapier bridge" |
| url | VARCHAR(2048) | NOT NULL | Destination URL. Not a secret — Slack incoming-webhook URLs are stable identifiers for specific channels. |
| secret | VARCHAR(64) | NOT NULL | HMAC-SHA256 signing secret; generated on creation; shown once in UI. Never logged. |
| event_types | JSONB | NOT NULL, DEFAULT `["run.failed"]` | Array of subscribed event types. MVP ships `run.failed` only; additive — new event types can be added without migration. |
| payload_version | VARCHAR(16) | NOT NULL, DEFAULT `'1'` | Webhook payload envelope version (see DD-024). Pinned at webhook creation; stays stable even when CTRFHub ships a `payload_version='2'`. Admin can change it explicitly to opt into a newer shape. Decoupled from the `/api/v1/` URL version — webhook receivers and CI pipelines have different change-tolerance profiles. |
| enabled | BOOLEAN | NOT NULL, DEFAULT TRUE | Admin can pause without deleting. Auto-flipped to FALSE after 10 consecutive delivery failures. |
| last_delivery_at | TIMESTAMPTZ | | Last attempt (success or failure) |
| last_success_at | TIMESTAMPTZ | | Last 2xx response |
| consecutive_failures | SMALLINT | NOT NULL, DEFAULT 0 | Reset to 0 on any 2xx; used for auto-disable |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |

---

### 4.22 webhook_deliveries *(outbound queue — MVP)*

Durable outbox for webhook deliveries. Uses the same reserve-execute-commit pattern as `ai_pipeline_log` (see DD-017) so a worker crash mid-delivery doesn't silently drop a notification.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGINT | PK, AUTO_INCREMENT | |
| webhook_id | BIGINT | NOT NULL, FK → project_webhooks.id ON DELETE CASCADE | Indexed |
| delivery_uuid | UUID | NOT NULL, UNIQUE | Emitted in `X-CTRFHub-Delivery-Id` header so the receiver can dedupe |
| event_type | VARCHAR(50) | NOT NULL | e.g. `run.failed`, `webhook.test` |
| payload | JSONB | NOT NULL | Exact bytes sent (before HMAC signing). Stored so a failed delivery can be retried against a different URL, and for admin debugging. |
| status | ENUM | NOT NULL | `pending` \| `running` \| `delivered` \| `failed` |
| worker_id | VARCHAR(64) | | Reservation owner while `status='running'`; NULL otherwise |
| heartbeat_at | TIMESTAMPTZ | | Heartbeat while in-flight; stale > 2 min ⇒ sweeper reclaims |
| attempt | TINYINT | NOT NULL, DEFAULT 0 | Max 5 (see backoff schedule in DD-018) |
| next_attempt_at | TIMESTAMPTZ | NOT NULL | Scheduler only picks up rows where `next_attempt_at <= NOW()` |
| http_status | SMALLINT | | Last response code (e.g. 200, 500, 429) |
| response_body_sample | VARCHAR(500) | | First 500 chars of the response body on non-2xx; for admin debugging; truncated to prevent log bloat |
| error | TEXT | | Transport-level error (DNS, TLS, timeout) when there was no HTTP response at all |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |
| delivered_at | TIMESTAMPTZ | | Set when `status` transitions to `delivered` |

Retained for 30 days, then purged by the nightly worker. The `payload` column dominates storage cost — 30 days is enough for debugging "why didn't my notification fire" without turning the table into long-term log storage.

---

### 4.23 ingest_idempotency_keys *(ingest dedup — MVP)*

Short-lived lookup table that maps a client-supplied `Idempotency-Key` header to the `test_runs` row it produced. Exists solely to handle the "CI retried the HTTP POST on a network blip" case — see DD-019 for the full policy.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGINT | PK, AUTO_INCREMENT | |
| project_id | BIGINT | NOT NULL, FK → projects.id ON DELETE CASCADE | Scope for uniqueness — two different projects with the same key never collide |
| idempotency_key | VARCHAR(128) | NOT NULL | Opaque client-supplied string. Printable ASCII only; validated at the Fastify layer |
| run_id | BIGINT | NOT NULL, FK → test_runs.id ON DELETE CASCADE | The run that won the race for this key |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Used by the nightly sweep |

**Constraints:**
- `UNIQUE (project_id, idempotency_key)` — the backbone of dedup. A concurrent POST with the same (project, key) loses the unique-violation race and reads the winner's `run_id`.
- `ON DELETE CASCADE` to `test_runs` and `projects` — if the winner run is deleted (manually or by retention), the idempotency mapping goes with it; a later retry is treated as fresh.

Retained for 24 hours (nightly worker deletes rows older than this). 24h is a deliberate ceiling: long enough to cover every realistic CI retry pattern, short enough that a pipeline *re-run* days later creates a new row regardless of whether the reporter's key-generation happens to produce the same value.

---

### 4.24 user_notification_preferences *(Community — MVP)*

Per-user, per-event-type, per-channel subscription toggle. Drives the "am I allowed to send this to this person" check in the notification dispatcher (DD-018 for webhooks; future work for email/in-app).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGINT | PK, AUTO_INCREMENT | |
| user_id | BIGINT | NOT NULL, FK → users.id ON DELETE CASCADE | Indexed |
| event_type | ENUM | NOT NULL | `run.failed` \| `run.completed` \| `assignment.created` \| `comment.mentioned` \| `milestone.closed`. Additive — new event types added without migration by extending the enum. |
| channel | ENUM | NOT NULL | `in_app` \| `email`. Slack DM deferred to PL-009 (see `user_slack_identities` sketch there). |
| enabled | BOOLEAN | NOT NULL, DEFAULT TRUE | |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | NOT NULL | |

**Constraints:**
- `UNIQUE (user_id, event_type, channel)` — one preference row per (user, event, channel) tuple.

**Seeding.** On user creation, the app seeds one row per (event_type × channel) combination with `enabled=TRUE` as the default. Users opt out; they don't opt in. The settings page reads from this table and writes back; absence of a row is treated as "enabled" (defensive default so a half-migrated install doesn't silently drop notifications).

**Why a table and not a JSONB column on `users`.** Three reasons: (1) per-event analytics ("what % of users opt out of `run.failed`?") become a single GROUP BY instead of JSONB introspection; (2) adding a channel (Slack, SMS) is an additive enum change, not a schema-shape change on every user row; (3) the settings UI edits one row at a time, which maps naturally to an UPSERT rather than a JSONB patch.

---

### 4.25 sso_configurations *(Business Edition)*

Per-organization SSO provider configuration. One active config per org (SSO is org-wide; mixing providers within one org is out of scope). See settings-architecture.md §2.4 for the admin UI flow.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGINT | PK, AUTO_INCREMENT | |
| org_id | BIGINT | NOT NULL, FK → organizations.id ON DELETE CASCADE | |
| provider | ENUM | NOT NULL | `saml` \| `oidc` \| `google_workspace` \| `microsoft_entra`. Extended additively. |
| config | JSONB | NOT NULL | Provider-specific: IdP metadata URL, entity ID, ACS URL, certificate fingerprint, attribute mapping, etc. Client secrets encrypted via the AI_ENCRYPTION_KEY pattern (DD-016) before being written into this JSONB. |
| enforced | BOOLEAN | NOT NULL, DEFAULT FALSE | When TRUE, password login is disabled for this org — all members must authenticate via SSO. Admins with the `sso.bypass` grant retain password access as an emergency escape hatch (documented in settings-architecture.md §2.4). |
| created_by | BIGINT | NOT NULL, FK → users.id | The admin who configured it; kept for audit even if the user is later removed |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | NOT NULL | |

**Constraints:**
- `UNIQUE (org_id)` — one SSO config per org. Changing provider means updating `provider` + `config` in place (or deleting and recreating).

**Business Edition only.** Community Edition uses Better Auth's password + GitHub/Google OAuth only; `sso_configurations` is not populated and the migration creates the empty table anyway so a later edition upgrade doesn't require a schema change.

---

### 4.26 org_integrations *(Community — MVP)*

Per-organization third-party integration configuration (outbound-only for MVP — Slack incoming webhook URL under an org-wide scope, Mattermost webhook URL, future GitHub/GitLab issue-create integrations). Separate from `project_webhooks` (§4.21): project_webhooks are URL-per-webhook rows; org_integrations hold the shared configuration a workspace-level integration needs (OAuth tokens, default channel, etc.) that multiple project_webhooks reference.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGINT | PK, AUTO_INCREMENT | |
| org_id | BIGINT | NOT NULL, FK → organizations.id ON DELETE CASCADE | |
| integration_type | ENUM | NOT NULL | `slack_workspace` \| `mattermost_workspace` \| `github_issues` \| `jira_cloud`. Additive. |
| config | JSONB | NOT NULL | Integration-specific: OAuth tokens, workspace ID, default channel, repo/project scope. Any credential fields are encrypted via the AI_ENCRYPTION_KEY pattern (DD-016) before write. |
| enabled | BOOLEAN | NOT NULL, DEFAULT TRUE | Admin can pause without deleting. |
| created_by | BIGINT | NOT NULL, FK → users.id | |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | NOT NULL | |

**Constraints:**
- `UNIQUE (org_id, integration_type)` — one instance per (org, integration). An org can have one Slack workspace, one Jira Cloud, etc. Multi-workspace Slack is out of scope for MVP; when that ships, the constraint relaxes to `(org_id, integration_type, workspace_id)`.

---

### 4.27 audit_logs *(Business Edition)*

Append-only record of admin-sensitive actions — role grants, SSO config changes, data exports, license uploads, retention changes, member removals. Community Edition does not create rows here; the migration ships the table so an edition upgrade doesn't require a schema change.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGINT | PK, AUTO_INCREMENT | |
| org_id | BIGINT | NOT NULL, FK → organizations.id ON DELETE CASCADE | Indexed |
| actor_user_id | BIGINT | FK → users.id ON DELETE SET NULL | Nullable because a deleted user's past audit entries must survive. The actor is also denormalized into `actor_email_snapshot` for exactly this case. |
| actor_email_snapshot | VARCHAR(255) | NOT NULL | Captured at write-time so a later user deletion doesn't blank out the audit trail. |
| action | VARCHAR(100) | NOT NULL | e.g. `member.role_changed`, `sso.config_updated`, `license.uploaded`, `export.requested`, `retention.changed`. Additive namespace. |
| target_type | VARCHAR(50) | | e.g. `user`, `project`, `organization`, `sso_configuration`. NULL for org-wide actions. |
| target_id | BIGINT | | FK-by-convention to the `target_type` table; not a hard FK because the target may be deleted later. |
| metadata | JSONB | NOT NULL, DEFAULT '{}' | Action-specific details: old/new values for changes, IP address, user-agent. Never contains secrets — the writer scrubs known secret-shaped fields before persisting. |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Indexed DESC for "recent audit events" queries |

**Append-only.** No UPDATE or DELETE in application code. The nightly retention cron deletes rows older than the org's `audit_retention_days` setting (default 365, configurable to 2555 = 7 years for regulated industries).

---

### 4.28 licenses *(Business Edition)*

Current Business Edition license for the installation. Exactly one row per org when Business is active; zero rows on Community. Loaded at startup and cached in-process; reloaded when an admin uploads a new key.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGINT | PK, AUTO_INCREMENT | |
| org_id | BIGINT | NOT NULL, FK → organizations.id ON DELETE CASCADE | |
| license_key | TEXT | NOT NULL | Opaque signed blob issued by Anthropic — er, the license-issuing service. Ed25519-signed payload containing: `org_id`, `tier`, `seat_cap`, `issued_at`, `expires_at`, `features[]`. Verified on upload and on every startup. |
| tier | ENUM | NOT NULL | `business` \| `enterprise`. Derived from the verified payload, denormalized for index-friendly queries. |
| seat_cap | INT | NOT NULL | Max active `organization_members` rows. Enforced at member-add time. |
| issued_at | TIMESTAMPTZ | NOT NULL | From the signed payload |
| expires_at | TIMESTAMPTZ | NOT NULL | From the signed payload; 14-day grace period in app logic |
| uploaded_by | BIGINT | NOT NULL, FK → users.id | |
| uploaded_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |

**Constraints:**
- `UNIQUE (org_id)` — one active license per org. Replacing a license means UPSERT; the old row is overwritten. History is carried by `audit_logs` (`license.uploaded` action with the prior `license_key` hash in metadata), not by an archive table.

**Community Edition.** The migration creates the table empty. License-gated features check for a valid row; absence ⇒ Community mode. An operator can flip to Business by uploading a key without running a new migration.

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
| project_webhooks | project_id | All webhooks for a project |
| webhook_deliveries | webhook_id | All deliveries for a webhook (audit / debug view) |
| webhook_deliveries | status, next_attempt_at | Dispatcher picks up pending rows ready to attempt |
| webhook_deliveries | delivery_uuid | Unique; receiver-side dedupe support |
| ingest_idempotency_keys | project_id, idempotency_key | Unique; primary ingest-dedup lookup |
| ingest_idempotency_keys | created_at | Nightly TTL sweep |
| user_notification_preferences | user_id | Load all prefs for a user (settings page) |
| user_notification_preferences | user_id, event_type, channel | Unique; dispatcher lookup — "is this user opted in for (event, channel)?" |
| sso_configurations | org_id | Unique; single config lookup at login *(Business)* |
| org_integrations | org_id | All integrations for an org (admin UI) |
| org_integrations | org_id, integration_type | Unique; dispatcher lookup by type |
| audit_logs | org_id, created_at DESC | Recent audit events for an org *(Business)* |
| audit_logs | actor_user_id | All actions by an actor *(Business)* |
| audit_logs | target_type, target_id | All events about a given target *(Business)* |
| licenses | org_id | Unique; startup and mid-session license lookup *(Business)* |

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
SELECT total_tests, passed, failed, skipped, blocked, duration_ms
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
       total_tests, passed, failed, skipped, blocked
FROM   test_runs
WHERE  project_id = :project_id
ORDER  BY started_at DESC
LIMIT  20;
```

---

## 7. Aggregate Counter Maintenance

The test_runs aggregate columns (total_tests, passed, failed, skipped, blocked, duration_ms) must be kept in sync as test_results rows are written.

### Option A — Incremental update on result insert (preferred)

```sql
UPDATE test_runs
SET    total_tests = total_tests + 1,
       passed      = passed  + IF(:status = 'passed',  1, 0),
       failed      = failed  + IF(:status = 'failed',  1, 0),
       skipped     = skipped + IF(:status = 'skipped', 1, 0),
       blocked     = blocked + IF(:status = 'blocked', 1, 0)
WHERE  id = :run_id;
```

Note: `pending` results (tests that never reported a terminal status) are counted in `total_tests` but not in any of the four status counters, so `passed + failed + skipped + blocked ≤ total_tests`. Dashboards that show a stacked bar of outcomes should compute `pending = total_tests - (passed + failed + skipped + blocked)`.

### Option B — Rollup at run completion

```sql
UPDATE test_runs r
JOIN (
    SELECT test_run_id,
           COUNT(*)                 AS total_tests,
           SUM(status = 'passed')   AS passed,
           SUM(status = 'failed')   AS failed,
           SUM(status = 'skipped')  AS skipped,
           SUM(status = 'blocked')  AS blocked,
           SUM(duration_ms)         AS duration_ms
    FROM   test_results
    WHERE  test_run_id = :run_id
    GROUP  BY test_run_id
) agg ON agg.test_run_id = r.id
SET r.total_tests  = agg.total_tests,
    r.passed       = agg.passed,
    r.failed       = agg.failed,
    r.skipped      = agg.skipped,
    r.blocked      = agg.blocked,
    r.duration_ms  = agg.duration_ms,
    r.status       = IF(agg.failed > 0, 'failed', 'passed'),
    r.completed_at = NOW()
WHERE r.id = :run_id;
```

**On run-level `status` derivation:** a run with `blocked > 0` but `failed = 0` is still rolled up as `passed` at the run lifecycle level. `test_runs.status` is a lifecycle ENUM (`pending | running | passed | failed | error`) with no `blocked` value — it answers "did the run complete successfully?", not "did every test reach a terminal result?". Dashboards that want to highlight runs with blocked tests should check the `blocked` counter directly rather than the `status` field.

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
     sse-connect="/api/sse/orgs/42"
     sse-swap="settings:changed">
  <!-- individual fields re-render on event -->
</div>
```

> **Note:** DD-010 and DD-011 share the same SSE stream. `GET /api/sse/orgs/:orgId` is the single canonical endpoint — see DD-011 below. Clients filter by `event:` type (`settings:changed` for DD-010, `run:created` / `run:updated` for DD-011).

Fastify streams SSE via `reply.raw` with no extra library. The event payload is a partial HTML fragment containing only the changed field — not the full settings page.

**Scope:** SSE is active only on org-level and project-level settings pages. Personal settings (Profile, Security, Notifications, API Keys) carry no SSE connection — only one user can edit their own personal settings.

**Failure mode:** If the SSE connection drops, the client shows stale data until reconnect. The optimistic locking layer ensures any subsequent PATCH from a stale client is rejected safely rather than silently overwriting a newer value.

---

### DD-011 — Real-time screen updates on run ingest use SSE + an EventBus abstraction

**Decision:** When a CTRF test run is ingested, all browser sessions currently viewing an affected screen are notified via the same SSE infrastructure established in DD-010. The ingest handler communicates through an `EventBus` abstraction rather than writing directly to SSE connections, enabling transparent substitution of a Redis Pub/Sub backend for horizontal scaling without changing ingest logic.

**Affected screens and update behaviour:**

| Screen | Event | Behaviour |
|---|---|---|
| Test Runs list | `run.ingested` | Shows a sticky "↑ N new run(s) — click to load" banner; does not auto-insert (avoids disrupting users reading the list) |
| Dashboard | `run.ingested` | Silent auto-update of KPI cards and trend chart via HTMX partial re-render |
| Project list | `run.ingested` | Silent update of the affected project row (last run timestamp + status badge) |
| Milestones *(Business)* | `run.ingested` | Silent update of the milestone progress bar if `run.milestone_id` is set |
| Test Run Detail | — | Not applicable; runs are complete batches on ingest; no in-flight streaming in MVP |

**SSE channel:** One persistent stream per authenticated user per org — `GET /api/sse/orgs/:orgId`. All event types (settings changes from DD-010 AND data events) flow through this single stream. The client filters by `event:` type.

**Event format:**

```
event: run.ingested
data: {"projectId":42,"projectSlug":"frontend-e2e","runId":891,"status":"failed","passRate":0.94}
```

**HTMX wiring examples:**

```html
<!-- Dashboard KPI cards — silent auto-update -->
<div id="kpi-cards"
     hx-get="/projects/frontend-e2e/dashboard/kpis"
     hx-trigger="sse:run.ingested"
     hx-swap="outerHTML">

<!-- Project list row — targeted row update -->
<tr id="project-row-42"
    hx-get="/projects/frontend-e2e/row"
    hx-trigger="sse:run.ingested[detail.projectId==42]"
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

This table is the **single canonical source** for every application-layer rate limit. Any DD that introduces a new route with a non-default limit adds a row here; downstream DDs reference this table rather than restating numbers. See DD-029 for the consolidation decision.

| Endpoint class | Limit | Key | Backend | Rationale |
|---|---|---|---|---|
| Login / forgot-password | 10 req/min | IP | in-proc LRU | Brute force / credential stuffing protection |
| Password reset — per email | 3 req/hour | email (lowercased) | in-proc LRU | Prevents one user being flooded with reset emails (see DD-021). Enumeration-safe — see "Enumeration-safety rule" below |
| Email verification — send | 3 req/hour + 10 req/min | user-id + IP | in-proc LRU | Same envelope as password reset (see DD-022) |
| Project delete (`DELETE /projects/:slug`) | 5 req/hour | admin-user-id | in-proc LRU | Prevents a compromised credential or runaway admin-owned automation from scripting project deletion (see DD-023) |
| CTRF ingest (`POST /api/v1/projects/:slug/runs`) | Default 120 req/hour; per-token override | apikey-id (Better Auth) | `@fastify/rate-limit` default store | CI misconfiguration guard; configurable per token via `apikey.metadata.rateLimit.perHour` (Better Auth metadata; absent → default 120; 0 → unlimited). Idempotent replays (DD-019) count against this limit before the dedup lookup. See "keyGenerator for per-token limits" below |
| Settings `PATCH` | 60 req/min | session-user-id | `@fastify/rate-limit` default store | Auto-save debounce already reduces volume |
| SSE `GET /api/sse/*` | 1 new connection per 2s | session-user-id | in-proc counter (DD-012 Layer 3) | Prevents rapid reconnect amplification — Layer 3 then enforces concurrent-connection caps |
| Artifact serving `GET /api/files/*` | 300 req/min | session-user-id | `@fastify/rate-limit` default store | Local-disk storage only; S3 pre-signed URLs are single-use with 1h expiry and need no app-layer limit. See DD-014, DD-028 |
| Webhook dispatcher outbound | 1 delivery/sec | destination URL (string, lowercased host + path) | in-proc LRU in dispatcher | Prevents a multi-webhook fan-out (same URL registered to several projects) from hammering a Slack channel during a bad incident. See DD-018 |
| General authenticated API | 600 req/min | session-user-id | `@fastify/rate-limit` default store | Generous for normal interactive use; covers `/api/v1/*` and `/hx/*` jointly |
| **Deferred:** TOTP verify attempts | 5 req/15min | user-id | `@fastify/rate-limit` default store | Reserved for PL-010 (MFA); slot kept visible here to prevent scattering |
| **Deferred:** Admin invites | 20 req/hour + 3 req/hour per invite email | admin-user-id + invite-email | in-proc LRU | Reserved for PL-011 (multi-admin); slot kept visible here |

**Key-and-backend invariants.** Attacker-controllable keys (IP, email, invite-email) always appear alongside a non-attacker-controllable key on the same route — a pure per-IP limit on a login endpoint would let a botnet with many IPs bypass it, which is why login also benefits from the Layer 1 reverse-proxy `limit_req` and the account-lockout logic. Backends: `@fastify/rate-limit`'s default in-process store is used for high-volume bulk routes (general API, settings, artifacts, ingest) where the library's sliding-window cost model is the right fit. In-process LRU is used for low-volume, cryptographic-counter-like routes (password reset, email verification, webhook dispatcher) where a hand-rolled counter with explicit enumeration-safety handling is clearer than wrapping the library. All backends are per-process in MVP; when `EVENT_BUS=redis` is set for multi-node scale-out (DD-011), the `@fastify/rate-limit` rows swap to the library's Redis store with no semantic change — the in-proc LRU rows remain per-process (their volume is too low for cross-node coordination to matter). A future multi-node deployment that needs shared counters on the LRU rows is the forward-compat trigger; no schema change.

**429 response contract.**

Every rate-limit rejection emits the same response shape regardless of which row above tripped, except for SSE (covered in Layer 3) and enumeration-sensitive routes (see next subsection).

Response headers (all 429 responses):
```
HTTP/1.1 429 Too Many Requests
RateLimit-Limit:     <window>/<period>       # RFC 9728 draft: e.g. "120/1h"
RateLimit-Remaining: 0
RateLimit-Reset:     <seconds-until-reset>   # integer seconds, not a timestamp
Retry-After:         <seconds-until-reset>   # RFC 7231 compatibility for older clients
Content-Type:        application/json
```

Body for `/api/v1/*`:
```json
{
  "error": "rate_limited",
  "code": "too_many_requests",
  "retry_after_s": 42
}
```

Body for `/hx/*`: empty. Response sets `HX-Trigger: rate-limited` so Alpine renders a toast; HTMX's default swap behaviour on 4xx (no swap) leaves the current DOM intact.

Only RFC 9728 `RateLimit-*` header names are emitted — the non-standard `X-RateLimit-*` variant used by some older APIs is deliberately omitted. CTRFHub's clients (the UI, CI reporters, Slack receiver) are all under our control; there's no legacy-consumer obligation.

**Enumeration-safety rule.**

When a limit is keyed on attacker-controlled input (email, invite-email, username), the route **must not** return `429` to the client. It returns the same successful-looking response as the happy path and silently drops the server-side work. The counter still increments. Exceeded → happy-path HTTP status with no mail sent, no DB write, no signal the attacker can use to distinguish "account exists" from "account exists and is being rate-limited" from "account does not exist". DD-021's password reset flow is the reference implementation; DD-022 inherits the same behaviour; any future account-recovery or invite-redemption route falls under this rule by default.

**`keyGenerator` pattern for per-token ingest.**

The per-token ingest limit reads `apikey.metadata.rateLimit?.perHour` (Better Auth's apikey row, attached to the request by the auth middleware). The library needs a custom `keyGenerator` plus a custom `max`:

```typescript
fastify.register(rateLimit, {
  keyGenerator: async (req) => {
    const apiKey = req.apiKey;                                     // Better Auth apikey row, set by auth middleware
    const limit = apiKey.metadata?.rateLimit?.perHour ?? 120;      // metadata is JSON; default 120/hr
    req.rateContext = { limit, key: `apikey:${apiKey.id}` };
    return req.rateContext.key;
  },
  max: (req) => req.rateContext?.limit ?? 120,                     // falls back to default if unset
  timeWindow: '1 hour',
  // 0 = unlimited: short-circuit with a sentinel max
  skip: (req) => req.rateContext?.limit === 0,
});
```

Apikey row lookup happens during Better Auth's apikey-plugin verification at route entry; the row is attached to the request, and the cached limit is read from `metadata.rateLimit?.perHour` (no extra DB query). The `skip` hook handles the `0 = unlimited` branch without emitting `RateLimit-*` headers that would imply a cap. Invalid tokens fail auth before this middleware runs; no rate-limit counter increments for them.

CTRF-002 ships with a simplified per-token bucket keyed on the `x-api-token` header value with a hardcoded 120/hr (no metadata lookup yet). Wiring `metadata.rateLimit?.perHour` is a small follow-up — see G-P1-008 in `gaps.md` and SET-001's eventual brief.

**Observability.**

Every 429 emits one Pino structured-log line:

```
{ "level": 40, "event": "ratelimit.exceeded",
  "endpoint": "POST /api/v1/runs",
  "key_hash": "3f2b7c9a",           // SHA-256(key)[0..8] — no raw emails or IPs
  "limit": "120/1h",
  "backend": "fastify-rate-limit" }
```

Key is hashed (first 8 hex chars of SHA-256) so a repeat-offender pattern is visible in the log stream without writing emails, IPs, or token IDs verbatim. A parallel counter `ctrfhub_ratelimit_exceeded_total{endpoint,backend}` is incremented for Prometheus-style scraping. The System Status page (DD-015) does not surface rate-limit counters — they're operational telemetry, not a dashboard concern; operators tail logs or attach Prom scraping if they want visibility. This closes the SOC 2 alignment line in `product.md` that previously handled rate-limit violations implicitly.

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
     hx-trigger="sse:run.ingested"
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

// Storage key convention:
// orgs/{orgId}/projects/{projectId}/runs/{runId}/results/{resultId}/{filename}
//
// Including projectId in the path enables a single deletePrefix() call at every level:
//   Delete org     → deletePrefix('orgs/{orgId}/')
//   Delete project → deletePrefix('orgs/{orgId}/projects/{projectId}/')
//   Delete run     → deletePrefix('orgs/{orgId}/projects/{projectId}/runs/{runId}/')
//
// For storage_type = 'url' rows: no file exists; deletePrefix is not called.
// Only the test_artifacts DB row needs to be removed.
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

**CORS requirements (applies to trace viewer and any future cross-origin artifact consumers):**

`trace.playwright.dev` is hosted on an origin CTRFHub doesn't control. When a user clicks "Open in Trace Viewer", the viewer fetches the zip from the artifact URL cross-origin. Without correct CORS headers on the artifact origin, the browser blocks the request and the viewer shows an empty trace. Pre-signed S3 URLs do not bypass this — the browser still enforces CORS.

Required response headers on artifact GET (and preflight `OPTIONS`) responses:

```
Access-Control-Allow-Origin: https://trace.playwright.dev
Access-Control-Allow-Methods: GET, HEAD, OPTIONS
Access-Control-Allow-Headers: Range, If-None-Match, If-Modified-Since
Access-Control-Expose-Headers: Content-Length, Content-Range, Accept-Ranges, ETag
Access-Control-Max-Age: 86400
```

No credentials — the trace viewer doesn't send cookies, and CTRFHub must not return `Access-Control-Allow-Credentials: true` alongside a wildcard origin. `Range` support matters because Playwright's viewer streams large traces via range requests.

**Configurable origin list:** the allowed origin is controlled by the `ARTIFACT_CORS_ORIGINS` env var (comma-separated, default `https://trace.playwright.dev`). Self-hosters running their own trace viewer (`docker run mcr.microsoft.com/playwright-trace-viewer`) can add their origin without a code change.

**Implementation per storage backend:**

| `ARTIFACT_STORAGE` | Where CORS is applied | Notes |
|---|---|---|
| `local` | Fastify `GET /api/files/*` handler via `@fastify/cors` registered on the files route only | Set `origin: ARTIFACT_CORS_ORIGINS.split(',')`, `methods: ['GET', 'HEAD', 'OPTIONS']`, `exposedHeaders: ['Content-Length', 'Content-Range', 'Accept-Ranges', 'ETag']`. Preflight `OPTIONS` is handled automatically by the plugin. |
| `s3` | S3 bucket CORS configuration (not CTRFHub code) | Bucket CORS rule: `AllowedOrigins = ARTIFACT_CORS_ORIGINS list`, `AllowedMethods = [GET, HEAD]`, `AllowedHeaders = [Range, If-None-Match, If-Modified-Since]`, `ExposeHeaders = [Content-Length, Content-Range, Accept-Ranges, ETag]`, `MaxAgeSeconds = 86400`. Document a `scripts/apply-s3-cors.sh` that applies this via `aws s3api put-bucket-cors` so operators don't have to compose the JSON by hand. |

**Testing:** the load-testing strategy must include a CORS preflight check against a running instance (both `local` and `s3` backends). Listed as a follow-up against gap-review item #17 (AI-pipeline load-test scenario) since that item already scopes load-testing additions.

**HTML report bundle handling:**

Playwright HTML reports are multi-file zips (`index.html` + data JSON + assets). When uploaded:
1. Server detects `artifact_type = html_report` + `content_type = application/zip`
2. Unzips to `{ARTIFACT_LOCAL_PATH}/orgs/{orgId}/projects/{projectId}/runs/{runId}/html-report/` (or S3 prefix)
3. `index.html` and assets served at `/runs/:runId/report/` via static file route, rendered inside an iframe with `sandbox="allow-scripts allow-forms allow-popups"` — **the `allow-same-origin` token is deliberately absent** per DD-028 so report scripts run in an opaque origin and cannot read CTRFHub cookies, `localStorage`, or make authenticated API calls back to the app
4. The iframe's container link uses `rel="noopener noreferrer"` when the report is also offered as an "Open in new tab" option

Single-file `text/html` attachments are served inline into a similarly-sandboxed `<iframe sandbox="allow-scripts allow-forms allow-popups">` (no `allow-same-origin`). The `/runs/:id/report/` route and `/api/files/*` route both emit the origin-isolation headers spelled out in DD-028 I6 (`X-Content-Type-Options: nosniff`, `Cross-Origin-Resource-Policy`, `Referrer-Policy: no-referrer`, plus `Content-Security-Policy: sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:` on HTML responses as belt-and-braces to the iframe sandbox).

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
4. Broadcast `run.ingested` SSE event

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

**Cascade deletion strategy:**

Storage files must always be deleted **before** DB rows. If DB rows are removed first, the `storage_key` data is gone and any files become permanently orphaned.

```
Correct order for all delete operations:
  1. deletePrefix() on storage  ← files gone
  2. Delete DB rows             ← cascade handles test_results → test_artifacts
```

This applies at every entity level:

| Delete target | Storage operation | Notes |
|---|---|---|
| Organisation | `deletePrefix('orgs/{orgId}/')` | Removes all files for all projects and runs |
| Project | `deletePrefix('orgs/{orgId}/projects/{projectId}/')` | Removes all files for all runs in the project |
| Test run | `deletePrefix('orgs/{orgId}/projects/{projectId}/runs/{runId}/')` | Removes all files for this run only |
| Single result | Query `storage_key` per artifact row, call `delete(key)` for each | Used when a single result is deleted (rare) |

**`storage_type = 'url'` rows require no storage deletion** — they have no file we own. Only the DB row is removed. Callers must filter these out before calling deletePrefix/delete:

```typescript
// Correct pattern before any DB delete
const ownedArtifacts = run.artifacts.filter(a => a.storageType !== 'url');
if (ownedArtifacts.length > 0) {
  await artifactStorage.deletePrefix(`orgs/${orgId}/projects/${projectId}/runs/${runId}/`);
}
// Now safe to delete DB rows
```

**Nightly retention sweep** (PL-006):
1. Identify `test_runs` rows to delete (age > retention_days, not milestone-protected)
2. For each run: `artifactStorage.deletePrefix('orgs/{orgId}/projects/{projectId}/runs/{runId}/')`
3. Delete DB rows in chunks (cascades to `test_results` → `test_artifacts`)

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

---

### DD-016 — AI failure categorization: schema, async trigger, rate limiting, and manual override

**Decision:** AI categorization is an MVP feature for failed tests. It runs asynchronously after ingest via the EventBus so the `201` response is never delayed. The schema stores both the original AI prediction and any manual override as separate columns so neither is lost.

---

#### Schema (on `test_results`)

| Column | Type | Notes |
|---|---|---|
| `ai_category` | ENUM\|NULL | AI's prediction. Values: `app_defect \| test_data \| script_error \| environment \| unknown`. NULL = not yet run, or test is not `failed`. Never overwritten by user action. |
| `ai_category_override` | ENUM\|NULL | User's manual choice. Same enum values. NULL = no override. **Takes precedence over `ai_category` for all display purposes.** Preserved across re-ingest. |
| `ai_category_model` | VARCHAR(100)\|NULL | Model identifier, e.g. `gpt-4o-mini`, `llama-3.3-70b`. Stored for auditability and A/B analysis. NULL until categorized. |
| `ai_category_at` | TIMESTAMPTZ\|NULL | When categorization completed. NULL = not yet run. |

**Why two columns instead of one?** A single `ai_category` column overwritten by the user permanently destroys the original AI prediction. Separate columns enable: (a) showing a "Manually set" indicator in the UI, (b) analytics on override rate (proxy for AI accuracy), (c) re-running AI on a result without losing the user's correction.

**Display logic:**
```
effectiveCategory = ai_category_override ?? ai_category

if effectiveCategory is not null:
  show category chip
  if ai_category_override is not null: show "Manual" badge
  else: show "AI" badge
else if test.status === 'failed' and AI_PROVIDER is configured:
  show "Pending" chip (grey)
else if test.status === 'failed' and AI_PROVIDER is not configured:
  show nothing (column hidden entirely if no AI key)
else:
  show nothing (passed/skipped tests are not categorized)
```

---

#### Which tests get categorized

- Only tests with `status = 'failed'`
- Passing and skipped tests are never sent to the AI provider
- Cap: **500 failed tests per run**. If a run has more than 500 failures, the first 500 (by `id` asc) are categorized; the rest are left NULL. This prevents runaway API spend on pathological runs.
- If `AI_PROVIDER` env var is not set: all categorization columns remain NULL; no API calls are made; the UI omits the category column entirely.

---

#### Async trigger — EventBus `run.ingested`

The `201` response is sent immediately after the run and results are persisted to the database. AI categorization runs asynchronously:

```
POST /api/v1/projects/:slug/runs
  │
  ├── Validate CTRF JSON (Zod)
  ├── Persist test_runs row
  ├── Bulk insert test_results rows (chunked, setImmediate yields)
  ├── reply.code(201).send({ runId })          ← client unblocked here
  └── eventBus.publish('ai', 'run.ingested', {
          runId,
          orgId,
          failedResultIds: [...]
      })                                       ← non-blocking

AiCategorizerService (subscriber on 'ai' channel):
  ├── Receives run.ingested event
  ├── Fetches up to 500 failed results
  ├── Batches results into AI provider requests (10-20 per call)
  ├── Updates ai_category, ai_category_model, ai_category_at per result
  └── eventBus.publish('sse', 'run.updated', { orgId, runId })
          └── SSE registry pushes { event: 'run:updated', runId } to browser
                  └── HTMX refreshes category chips without full page reload
```

**Why EventBus (not BullMQ, not polling)?**
- Uses the existing `EventBus` interface already designed in DD-011
- For MVP (single-node, `EVENT_BUS=memory`): categorizer runs in the `api` process — no extra infrastructure
- For scale-out (`EVENT_BUS=redis`): the `run.ingested` event routes to the `worker` container via Redis Pub/Sub — **zero code change in the categorizer**
- SQLite deployments (in-process `node-cron`): same EventBus path; categorizer is just another subscriber
- If the process restarts mid-categorization: a startup sweep queries `test_results WHERE status = 'failed' AND ai_category IS NULL AND ai_category_override IS NULL AND created_at > NOW() - 24h` and re-queues those results

---

#### Batching AI requests

Sending one API call per failed test is expensive and slow. Tests are batched:

```typescript
// Prompt structure (simplified)
const prompt = `
Categorize each test failure as one of:
  app_defect, test_data, script_error, environment, unknown

Return a JSON array in the same order as the inputs.

Tests:
${results.map((r, i) => `[${i}] ${r.testName}\n${r.errorMessage}\n${r.stackTrace?.slice(0, 500)}`).join('\n---\n')}
`;
// Parse response: [{index, category}, ...]
```

Batch size: **20 results per API call** (balances context window usage vs. round trips).
For 500 failures: ~25 API calls per run.

---

#### Manual override route

```
PATCH /api/v1/runs/:runId/results/:resultId/category
Body: { category: 'app_defect' }  // or null to clear the override
Auth: session cookie (viewer cannot override; org member can)

Response: 200 { effectiveCategory, source: 'manual' | 'ai' | null }
```

HTMX: the Run Detail page uses `hx-patch` on the category dropdown. The response is an HTML partial replacing just the category chip — no page reload.

**Survives re-ingest:** `ai_category_override` is keyed to the `test_results.id`. A re-ingested run creates a new `test_runs` row with new `test_results` rows — overrides do not transfer. "Survives re-ingest" in `product.md` means the override persists for the lifetime of the result row, not across different ingest calls.

---

#### Startup recovery query (avoids lost work on process restart)

```sql
SELECT id, test_name, error_message, stack_trace
FROM test_results
WHERE status = 'failed'
  AND ai_category IS NULL
  AND ai_category_override IS NULL
  AND created_at > NOW() - INTERVAL '24 hours'
ORDER BY id ASC
LIMIT 500;
```

Run once at startup (after migrations). Re-queues any results that were mid-flight when the process last stopped.

---

### DD-017 — AI pipeline stages A2–A4 are table-driven with reserve-execute-commit semantics so crashes never lose a job

**Decision:** The AI pipeline (A1 Categorization → A2 Root Cause Correlation → A3 Run Narrative → A4 Anomaly Detection) is scheduled via durable rows in `ai_pipeline_log`, not ephemeral EventBus messages. EventBus events (`run.ingested`, `run.ai_categorized`, `run.ai_correlated`, `run.ai_summarized`) are treated as **hints to consider scheduling**; the database row is the source of truth. A worker that crashes mid-stage releases its row automatically (via heartbeat timeout) and another worker — or the same worker after restart — picks up where it left off.

#### Why this is needed

The original design (see `ai-features.md` → Implementation Architecture) fires each stage's next event on completion. DD-016 gave A1 a startup recovery query based on NULL `ai_category` columns, but A2–A4 had no equivalent path:

- A2 writes `ai_root_causes` JSONB on `test_runs` — one row per run, so a NULL column cannot be distinguished from "not yet ingested" vs "A1 failed and A2 was skipped" vs "worker crashed mid-A2".
- A3 writes `ai_summary` — same ambiguity.
- A4 writes `ai_anomalies` rows — no rows at all is a valid steady state for runs with < 7 prior runs.

Without durable scheduling, a worker crash mid-A2 leaves the run in an indefinite "analyzing" state with no path to recovery. `ai_pipeline_log` already existed as an observability table; DD-017 promotes it to the scheduling table.

#### Row lifecycle

```
 (no row)                    ← initial state
    │
    │  eventBus publishes run.ingested (A1) / run.ai_categorized (A2) / etc.
    │  stage handler calls: INSERT … ON CONFLICT(test_run_id, stage) DO NOTHING
    ▼
 pending                     ← row exists, no worker holds it, attempt = 0
    │
    │  worker reserves:
    │    UPDATE ai_pipeline_log
    │    SET    status       = 'running',
    │           worker_id    = :workerId,
    │           heartbeat_at = NOW(),
    │           attempt      = attempt + 1,
    │           started_at   = COALESCE(started_at, NOW())
    │    WHERE  id = :id
    │      AND  status = 'pending'
    │      AND  attempt < 3;
    │  (0 rows affected → another worker got it, skip)
    ▼
 running                     ← worker heartbeats every 15s
    │
    ├───► success:   status='done', completed_at=NOW(), tokens_used=:n, worker_id=NULL
    │        then publishes the next event (run.ai_correlated / run.ai_summarized / …)
    │
    ├───► transient fail + attempt < 3:  status='pending', worker_id=NULL, heartbeat_at=NULL
    │        (exponential backoff handled by the sweeper; see below)
    │
    └───► terminal fail (attempt = 3 or non-retryable error):
             status='failed', error=:message, worker_id=NULL
             publishes the next event anyway with `partial: true`
             (a failed A2 still gets a best-effort A3 from A1 data only)
```

#### Recovery paths

**(1) On-boot scan** — after migrations succeed, before the worker subscribes to EventBus:

```sql
-- Release rows whose owning worker crashed.
UPDATE ai_pipeline_log
SET    status       = 'pending',
       worker_id    = NULL,
       heartbeat_at = NULL
WHERE  status       = 'running'
  AND  (heartbeat_at IS NULL OR heartbeat_at < NOW() - INTERVAL '2 minutes');

-- Re-enqueue everything still pending for recent runs.
SELECT l.id, l.test_run_id, l.stage, l.attempt
FROM   ai_pipeline_log l
JOIN   test_runs r ON r.id = l.test_run_id
WHERE  l.status = 'pending'
  AND  l.attempt < 3
  AND  r.created_at > NOW() - INTERVAL '24 hours'
ORDER  BY l.id ASC;
```

For each returned row, publish the event that triggers that stage (`run.ingested` for `categorize`, `run.ai_categorized` for `correlate`, etc.) so the normal stage handler picks it up.

**(2) Stuck-stage sweeper** — runs every 60 seconds in each worker:

```sql
-- Reclaim rows from workers that died without heartbeating for 2 minutes.
UPDATE ai_pipeline_log
SET    status       = 'pending',
       worker_id    = NULL,
       heartbeat_at = NULL
WHERE  status       = 'running'
  AND  heartbeat_at < NOW() - INTERVAL '2 minutes';

-- Terminal-fail any row that has exhausted retries so the run can unstick.
UPDATE ai_pipeline_log
SET    status       = 'failed',
       error        = 'attempt limit exceeded (sweeper)',
       worker_id    = NULL,
       completed_at = NOW()
WHERE  status       = 'pending'
  AND  attempt      >= 3;
```

The sweeper is idempotent under multi-worker deployments; if two workers run the query simultaneously, both `UPDATE`s are race-free because `status = 'running'` / `status = 'pending'` is checked atomically.

**(3) Idempotency guard inside each stage handler** — before calling the LLM:

```
If the stage's primary output is already present on the run
  (e.g. for `correlate`, check test_runs.ai_root_causes_at IS NOT NULL)
  AND ai_pipeline_log row is not already 'done':
     → this is a repair case (DB write succeeded, next event was lost)
     → mark ai_pipeline_log row status='done' and publish the next event
     → skip the LLM call entirely
```

This covers the gap between "DB row for the stage's output is committed" and "the row in `ai_pipeline_log` is marked `done` and the next event is published". In that narrow window, a crash leaves the primary write committed but the pipeline row still `running`. The idempotency guard turns this into a no-op on recovery instead of a wasted LLM call.

#### Event schedule vs. row schedule

| Concern | EventBus | `ai_pipeline_log` |
|---|---|---|
| Durable? | No (in-memory MVP; Redis Pub/Sub is fire-and-forget) | Yes |
| Source of truth for what to schedule? | No — hint only | Yes |
| Source of truth for progress / status? | No | Yes |
| What powers the System Status page? | — | Yes |
| What powers restart recovery? | — | Yes |

EventBus is not redundant — it remains the low-latency mechanism for chaining stages within a single process lifetime, which is the common case. The table is the fallback that makes uncommon cases (crashes, restarts, split-brain) safe.

#### Graceful shutdown

When a worker receives SIGTERM:

1. Stop accepting new reservations.
2. For each row the worker currently holds as `running`:
   - If the LLM call has already returned and the primary write is committed, finish the `done` update and publish the next event — this is the fast path.
   - Otherwise, release the row: `status='pending', worker_id=NULL, heartbeat_at=NULL`. The next worker (or the same one after restart) reserves it again.
3. Exit.

If SIGTERM is not honoured (SIGKILL, host reboot), the heartbeat timeout in path (2) is the backstop.

#### Compatibility notes

- **SQLite:** the reserve `UPDATE` is serialized by SQLite's single-writer lock; concurrency is capped by that model. The `UNIQUE(test_run_id, stage)` constraint works identically.
- **Postgres:** the reserve `UPDATE` is a conditional update; no explicit locking is required because `WHERE status = 'pending'` filters out already-reserved rows.
- **Multi-worker (Redis scale-out, `EVENT_BUS=redis`):** works without changes — every worker races on the same reserve `UPDATE`; at-most-one wins.
- **A1 keeps its DD-016 recovery query** in addition to participating in DD-017. A1's per-result NULL scan and DD-017's per-row `ai_pipeline_log` scan are redundant on purpose: A1 pre-dates this design and the query is cheap to keep. The two recoveries are idempotent with respect to each other.

---

### DD-018 — Outbound notifications ship as a generic signed HTTP webhook; native adapters (Slack, Teams, PagerDuty, email) are deferred

**Decision:** MVP ships exactly one outbound integration surface — a per-project HTTP webhook that fires on `run.failed`, signs the body with HMAC-SHA256, and retries with exponential backoff from a durable outbox (`webhook_deliveries`). Slack, Microsoft Teams, Discord, PagerDuty, email, ChatOps, @mention routing, digest mode, and per-user DM preferences are all captured in PL-009 and deferred.

**Why this and not a Slack-native adapter:** the generic webhook is the universal adapter. Users who want Slack point the webhook at a Slack incoming-webhook URL or a small transformer (Zapier, a serverless function, a standalone bot). Users who want Teams do the same against a Teams connector URL. Users who want PagerDuty point it at PD's Events API. A single implementation serves every v1 integration need without CTRFHub maintaining adapters for five different vendor APIs. Native adapters are polish; they layer on once demand is real.

#### Event catalogue (MVP)

Exactly one event ships: `run.failed`. Fired on `EventBus` from the ingest handler after a run's rollup completes if `failed > 0`. Exactly-once within a single run ingest (the EventBus publish happens inside the same transaction as the rollup commit). Future events (`run.regressed`, `anomaly.detected`, `test.assigned_to_me`, `comment.mentioned_me`) land in PL-009.

**Why only `run.failed`:** the minimum event needed to make webhooks useful. `run.completed` is too noisy for most CI cadences. `run.regressed` requires a previous-run baseline lookup that's out of scope for MVP. A team that wants "notify me when anything happens" can subscribe to `run.failed` and filter on their end.

#### Payload shape

```json
{
  "version": "1",
  "event": "run.failed",
  "delivery_uuid": "018f2c…",
  "delivered_at": "2026-04-22T14:23:00.481Z",
  "data": {
    "run": {
      "id": 42,
      "display_id": "E2E-1234",
      "project": { "id": 7, "slug": "my-project", "name": "My Project" },
      "environment": "staging",
      "branch": "main",
      "commit_sha": "a3f9b24...",
      "started_at": "2026-04-22T14:20:01Z",
      "completed_at": "2026-04-22T14:22:47Z",
      "total_tests": 200,
      "passed": 180, "failed": 20, "skipped": 0, "pending": 0, "blocked": 0,
      "url": "https://ctrfhub.example.com/projects/my-project/runs/42"
    }
  }
}
```

The `url` field is constructed from `PUBLIC_URL` (env var) + canonical project/run path. If `PUBLIC_URL` isn't set, the field is omitted — don't emit a URL that resolves to `localhost` when received at Slack.

The `version` field is the **webhook payload envelope version** (see DD-024). It is not the same as the `/api/v1/` URL version — webhook payloads and API endpoints evolve independently because their audiences (chat-ops integrations vs. CI pipelines) have different change-tolerance profiles. A single CTRFHub release can ship `payload_version='1'` and `payload_version='2'` concurrently; each webhook row pins the version it was created against in `project_webhooks.payload_version`.

#### Signing

Every delivery carries three headers:

```
X-CTRFHub-Signature:   sha256=<hex>       ← HMAC-SHA256 of the raw body using webhook.secret
X-CTRFHub-Delivery-Id: <uuid>             ← unique per delivery; receivers dedupe on this
X-CTRFHub-Event:       run.failed
User-Agent:            CTRFHub-Webhook/<version>
Content-Type:          application/json
```

Signing follows GitHub's convention deliberately — it's the one most developers have already integrated against. Secret format: 48 random bytes, hex-encoded (96 chars). Generated on webhook creation; returned **once** in the API response and the UI confirmation; never retrievable after. Rotation means creating a new webhook and deleting the old.

#### Delivery pipeline (reuses DD-017's pattern)

1. `run.failed` event is published to the EventBus from the ingest handler.
2. `WebhookDispatcher` service (subscribed to `run.failed`) queries `project_webhooks WHERE project_id = :id AND enabled = TRUE AND 'run.failed' = ANY(event_types)`.
3. For each matching webhook, insert a `webhook_deliveries` row with `status='pending'`, `attempt=0`, `next_attempt_at=NOW()`.
4. A `WebhookWorker` (same physical worker as the AI pipeline in MVP) reserves rows via the same atomic `UPDATE … WHERE status='pending' AND next_attempt_at <= NOW()` pattern from DD-017, heartbeats every 15s while the HTTP request is in-flight, and commits `status='delivered'` on 2xx.
5. On non-2xx or transport failure and `attempt < 5`: release the row back to `pending` with `next_attempt_at = NOW() + backoff[attempt]`.
6. On `attempt = 5`: mark `status='failed'`. Increment `project_webhooks.consecutive_failures`. If it crosses 10, set `enabled=FALSE` and emit a system event (surfaced on the System Status page).

**Backoff schedule:** 30s, 2m, 10m, 1h, 6h. Longer than the AI pipeline's schedule because external receivers have their own outage timescales; retrying every second isn't useful.

**Timeout:** 10s per HTTP request. Slower receivers are treated as failures.

**Rate limit:** 1 delivery per URL per second, in-process LRU keyed on destination URL. Canonical row lives in DD-012's Layer 2 table ("Webhook dispatcher outbound"); the underlying rationale is documented there to keep every numeric limit in one place (see DD-029).

#### Crash recovery

Identical to DD-017 — the `webhook_deliveries` table is a durable outbox, same on-boot scan (`status='running' AND heartbeat_at < NOW() - 2m` → reset to `pending`), same 60-second sweeper. A restarted worker picks up in-flight deliveries without duplicating already-committed ones. The `delivery_uuid` + `UNIQUE` constraint guarantees each delivery is identifiable exactly once, even if a receiver is slow and a sweeper reclaim causes a duplicate HTTP attempt — that's what the `X-CTRFHub-Delivery-Id` header is for on the receiver side.

#### UI (intentionally thin)

Project Settings → **Integrations** tab. Two actions: **Add webhook** and a list of existing webhooks.

**Add webhook** form:
- Name (required)
- URL (required, validated as http/https)
- On save: the secret is generated server-side, shown once in a confirmation modal with a **Copy secret** button and explicit copy indicating it will not be shown again.

**Webhook list row** shows: name, URL (truncated), status pill (`Healthy` if `last_success_at` within 24h; `Failing` if `consecutive_failures > 3`; `Disabled` if `enabled = FALSE`), and the last 5 deliveries inline (timestamp + HTTP status). A **Test delivery** button sends a `webhook.test` event with a synthetic payload so admins can verify connectivity without waiting for a real failure. **Delete** removes the row (cascade deletes delivery history).

A full delivery-log UI (filter by event, by status, by date, with raw-payload inspection) is parking-lot — the inline "last 5" row is the MVP debugging surface.

#### Security considerations

- **SSRF:** outbound HTTP to user-supplied URLs is an SSRF risk. The dispatcher rejects URLs resolving to private IP ranges (RFC 1918, loopback, link-local, IPv6 ULA) unless `ALLOW_PRIVATE_WEBHOOK_DESTINATIONS=true` (off by default; self-hosters with an internal Slack proxy opt in). DNS is re-resolved at request time, not at save time, to prevent DNS rebinding.
- **TLS:** HTTPS-only in production. `http://` URLs are allowed only when `ALLOW_INSECURE_WEBHOOK_DESTINATIONS=true` for local development.
- **Secret exposure:** the secret is written to the DB only. Never returned in any subsequent API response, never logged, redacted from the System Status page's webhook list.
- **Replay:** `X-CTRFHub-Delivery-Id` is the receiver's dedup key. CTRFHub also sets `Date:` and recommends in the receiver's implementation guide (to be written) that receivers reject signed payloads more than 5 minutes old.

---

### DD-019 — Re-ingest and duplicate-run policy: client-supplied `Idempotency-Key` header, 24-hour TTL, opt-in replace via query param

**Decision:** The CTRF ingest endpoint is idempotent with respect to a client-supplied `Idempotency-Key` header. Within a 24-hour window, any POST to `POST /api/v1/projects/:slug/runs` that re-uses a key already seen for the same project returns the original run's response body with `200 OK` and `X-Idempotent-Replay: true` — no new run is created. Without the header, every POST creates a new run. A deliberate replace is available via `?on_duplicate=replace`, which requires a token with delete permission.

**Why this needs to exist:** CI systems retry HTTP requests on transient network failures. A reporter that gets a TCP reset, a `502` from the reverse proxy, or a `504` during a brief DB wait will re-POST the exact same CTRF payload. Without dedup, every blip produces a duplicate run in the UI, skewing pass-rate metrics and polluting dashboards. This is the single most-reported ergonomic issue on test-result aggregation tools that lack it.

**Why not server-side payload hashing:** it conflates "retried HTTP request" with "identical test run happened twice." Two genuine test runs can produce byte-identical CTRF (fixture-driven tests on a deterministic suite); hashing would drop one. It also costs a SHA-256 over multi-megabyte bodies on the hot path. Client-supplied keys keep the control in the reporter's hands — which is where knowledge of "is this a retry" actually lives.

**Why a separate table and not a column on `test_runs`:** a column adds a partial unique index on the highest-write table in the system for a concern that dies after 24h. A 24h-TTL lookup table (`ingest_idempotency_keys`, §4.23) is easier to prune, doesn't bloat the hot path, and can be truncated wholesale in an emergency without touching actual data.

#### Request contract

```
POST /api/v1/projects/:slug/runs
Headers:
  x-api-token:       <project token>
  Idempotency-Key:   <opaque string, ≤ 128 printable-ASCII chars>   ← optional
Query (optional):
  ?on_duplicate=replace       ← see "Deliberate replace" below
```

Key validation at the Fastify layer:
- Length 1–128 chars. Outside the range → `400 Bad Request` with `{"error": "invalid_idempotency_key", "message": "..."}`.
- Charset: printable ASCII (`0x20`–`0x7E`). Non-ASCII → `400`.
- No server-side normalization (no trim, no case-fold). Clients own the key space.

#### Server behaviour

1. **No header:** normal ingest path. New `test_runs` row, new response, no entry in `ingest_idempotency_keys`. Treat the POST as fresh.
2. **Header present, key already seen for this project within 24h:**
   - Look up `ingest_idempotency_keys WHERE project_id = :pid AND idempotency_key = :k`.
   - If the referenced `run_id` still exists: return `200 OK` with the **same response body** the original POST received (`{ runId, ... }`), plus `X-Idempotent-Replay: true`. Do not process the body. Do not touch `last_used_at` on the token (the dedup case is not billable work). The POST body is discarded unread past Zod validation — do not re-persist artifacts, do not re-fire `run.ingested` events.
   - If the referenced `run_id` no longer exists (retention sweep, manual delete): treat as fresh. The `ON DELETE CASCADE` on `ingest_idempotency_keys.run_id` ensures this row was deleted with the run, so this branch is defensive — it handles a race where the row is being deleted concurrently with the lookup.
3. **Header present, key not seen:** normal ingest. After the `test_runs` row is inserted, upsert the idempotency mapping **in the same transaction**:
   ```sql
   INSERT INTO ingest_idempotency_keys (project_id, idempotency_key, run_id)
   VALUES (:pid, :k, :run_id)
   ON CONFLICT (project_id, idempotency_key) DO NOTHING
   RETURNING id;
   ```
   If the insert returns no row (a concurrent writer won the race): roll back the run insert, look up the winner's `run_id`, and return the winner's response per branch 2. Net effect: at most one run is persisted per (project, key, 24h) even under concurrent retries.

#### Reporter guidance — how to generate a stable key

The official CTRFHub reporter SDKs compute:

```
Idempotency-Key = sha256(
  reportFormat + ':' +
  specVersion + ':' +
  (environment.buildUrl ?? environment.buildNumber ?? '') + ':' +
  (environment.commit ?? '') + ':' +
  summary.start                                      // epoch ms — changes on every test-suite execution
).slice(0, 64)                                       // 64 hex chars — fits easily in 128-char limit
```

This gives the property that matters: two HTTP POSTs of the *same* test-suite execution produce the same key; a *re-run* of the pipeline (where the test suite actually runs again, producing a new `summary.start`) produces a different key.

Reporters running on CI systems that expose a retry attempt (`GITHUB_RUN_ATTEMPT`, GitLab `CI_JOB_ATTEMPT`, etc.) should include that in the hash so a manual re-run of the *same* failed job is treated as a separate ingest even if the test framework reproduces identical timing.

Reporters with no reliable source of a stable key should simply omit the header. A duplicate run is strictly better than a silently dropped run.

#### Deliberate replace — `?on_duplicate=replace`

Rare but real: a reporter uploaded a run with bad metadata, or forgot to attach artifacts, and wants to re-post over the same run. Supported via the query param:

- `?on_duplicate=return_existing` (default): behaviour as described above.
- `?on_duplicate=replace`: if the `Idempotency-Key` matches an existing run, delete the winner run (cascade) and persist the new one. Requires the token to have `ingest:replace` permission (`apikey.metadata.permissions` array contains `'ingest:replace'`; absent → forbidden, returns `403`. Admins opt specific tokens in via the SET-001 token-management UI). The deleted run's `id` is *not* reused — the new run gets a fresh autoincrement ID.
- `?on_duplicate=error`: if the key matches an existing run, return `409 Conflict` with `{"error": "duplicate_run", "existing_run_id": ...}`. Useful for strict CI pipelines that want to be told if they retried.

Invalid values for `on_duplicate` → `400`.

#### Response-body stability

The replay response is the exact bytes of the original `201` response, minus any fields that would be misleading at replay time (specifically, no new event IDs or AI-pipeline timing data — the response is captured at the point of the original 201, not reconstructed from current state). In practice MVP's response body is `{ runId }` only, so this is a no-op; the stability requirement is a forward-looking constraint on what can be added to the response without breaking idempotency semantics.

To support this, the first-time ingest path writes the response body into `ingest_idempotency_keys.response_body_sample` as a denormalized cache — **no**, actually: on reflection this is premature optimization. MVP returns `{ runId }` and the replay branch reconstructs that from `run_id`. The stability requirement is captured as a note for future schema additions: any new field in the response must either be derivable from `run_id` alone, or the table gains a `response_body` column.

#### Rate limiting interaction

Idempotent replays count against the per-token ingest limit **before** the dedup lookup runs — the reverse-proxy `limit_req` and the Fastify rate-limit middleware both precede the idempotency check in the request chain. A runaway reporter re-POSTing the same key a thousand times per minute is rejected at the rate-limit layer, never reaching the DB. This is deliberate: dedup is not a substitute for rate limiting. The canonical limit (default 120 req/hour per token, configurable via `apikey.metadata.rateLimit.perHour`) lives in DD-012's Layer 2 table — see DD-029 for the consolidation rationale.

#### Observability

The System Status page (DD-015) gains one line: **Idempotent replays (last 24h)** — count from `ingest_idempotency_keys` where `created_at > NOW() - 24h` minus count of distinct keys… actually, more useful: a counter incremented at runtime (`metric:ingest.idempotent_replay`) exposed via the structured-log stream. No DB column needed. A non-zero value is expected and healthy; a sudden spike indicates a CI retry loop worth investigating.

#### What this intentionally does not do

- **Does not dedup across projects.** Two projects sharing an accidentally-reused key (e.g. both generate the same hash because of a reporter bug) do not collide — the unique index is `(project_id, idempotency_key)`.
- **Does not dedup uploads without the header.** A reporter that simply re-sends the same CTRF JSON without the header produces two runs. This is a design choice, not an oversight: see "Why not server-side payload hashing" above.
- **Does not dedup across a longer window than 24h.** A CI pipeline that re-runs the same job a week later is treated as fresh even if the reporter happens to produce the same key. Operational simplicity over edge-case cleverness.
- **Does not cover the `/upload` UI path.** Manual file uploads through the web UI bypass the idempotency header entirely (there's no realistic "retry" semantic for a human-clicked upload). Users who click Upload twice produce two runs.

---

### DD-020 — First-boot bootstrap: guided wizard at `/setup` as primary; env-seed and CLI as alternatives; no HTTP re-bootstrap after first user exists

**Decision:** A fresh CTRFHub instance (empty `users` table) exposes a 4-step guided wizard at `/setup` that walks the operator through creating an admin account, organization, first project, and CI/CD integration. All other HTTP routes `302` to `/setup` while the table is empty. Once any user exists, `/setup` returns `410 Gone` permanently — no re-bootstrap via HTTP is ever possible. Env-var seed (`CTRFHUB_INITIAL_ADMIN_*`) and a CLI command (`bootstrap-admin`) are supported alternatives for headless deploys and recovery respectively.

**Why a wizard and not first-login-is-admin or env-only:** first-login-is-admin is a race hazard (any opportunistic visitor becomes admin). Env-only works for Kubernetes/Terraform operators but is terrible UX for casual self-hosters who just ran `docker compose up` on a laptop. The wizard is the documented default; env-seed and CLI are the escape hatches. This matches GitLab, Gitea, Wikijs, and Plausible — every tool in the self-hosted category has converged on this pattern.

**Why no dedicated "setup complete" flag:** `SELECT COUNT(*) FROM users > 0` is the gate. No `system_settings` singleton, no `setup_completed_at` column. If the operator somehow deletes every user (via SQL — there's no UI path), `/setup` opens back up, which is the safe behaviour — the instance was reset to a fresh state and re-bootstrap is the only way to recover.

#### Wizard flow (primary path)

Four steps. Each step commits to the DB immediately so mid-flow abandonment doesn't leave partial state — the admin user from step 1 can log in and resume from whichever step didn't complete.

| Step | Route | Writes | Notes |
|---|---|---|---|
| 1. Admin Account | `POST /setup/admin` | `users` (Better Auth) | Email, password (min 12 chars), display name. Session created on success. |
| 2. Organization | `POST /setup/organization` | `organizations`, `organization_members` | Name, slug (URL-safe, auto-generated from name, editable). **Timezone field pre-filled from `Intl.DateTimeFormat().resolvedOptions().timeZone`** (browser detection — admin can change; dropdown + search-by-city per DD-025). Written to `organizations.settings.default_timezone` (IANA ID only). Admin added as `role='Admin'`. |
| 3. First Project | `POST /setup/project` | `projects`, `project_tokens` | Name, description (optional), slug. Auto-generates an ingest token. |
| 4. CI/CD Setup | `POST /setup/complete` | — (no DB write) | Shows the ingest token **once** with copy button + "Save this token now" warning banner; framework dropdown drives the integration-example tabs (GitHub Actions / GitLab CI / CircleCI / Jenkins / curl), each showing a copy-paste snippet pre-filled with the token and the canonical ingest URL (`{PUBLIC_URL}/api/v1/projects/:slug/runs`). "Complete Setup" redirects to `/`. |

**Route gating:** a Fastify hook runs before every request:
```
if (req.path starts with '/setup' or is '/health' or is static asset):
  proceed
else if (SELECT COUNT(*) FROM users > 0):
  proceed (normal auth middleware takes over)
else:
  302 → /setup
```
The user count is cached in-process for 5 seconds to avoid hitting the DB on every request. Cache is invalidated (bumped) after each wizard-step commit.

**Resume semantics.** If the operator completes steps 1–2 then closes the browser, returning to `/setup` detects: user exists (step 1 done), organization exists (step 2 done), no projects yet. The wizard jumps to step 3 with the admin already logged in. If the operator completes 1–3 and quits before step 4, the token was already generated in step 3 and is visible in Project Settings → Tokens (plaintext once, then last-4 only per product.md Feature 5). The dashboard shows a "Finish setup" nudge linking to step 4.

**Post-setup lockout.** Once `SELECT COUNT(*) FROM users > 0`, every `/setup*` route returns `410 Gone` with a short HTML page explaining that the instance is already set up and linking to `/login`. The 410 is stable even if all orgs or projects are later deleted — the gate is the user count, nothing else.

#### Env-seed alternative

For headless deploys (Kubernetes, Terraform, compose files with `env_file`), the migration routine runs before Fastify starts accepting traffic:

```
on boot, if (users table empty AND CTRFHUB_INITIAL_ADMIN_EMAIL set AND CTRFHUB_INITIAL_ADMIN_PASSWORD set):
  in a single transaction:
    1. create user(email, password, display_name = CTRFHUB_INITIAL_ADMIN_DISPLAY_NAME ?? email)
    2. if CTRFHUB_INITIAL_ORG_NAME set: create org, add user as Admin
       else: fail boot — org name required
    3. if CTRFHUB_INITIAL_PROJECT_NAME set: create project, generate token, log the token to stdout with an explicit "store this securely" warning
  log warning: "Bootstrap env vars were honored. Unset CTRFHUB_INITIAL_ADMIN_PASSWORD now."
```

After the users table has rows, all `CTRFHUB_INITIAL_*` vars are ignored — no matter the value, no matter how many times the container restarts. The vars are a bootstrap-only concern.

The token from step 3 is logged **to stdout** (not stored anywhere else retrievable) to give headless operators a path to capture it from their container logs; it's still stored hashed in the DB. The security posture is "your container log stream is as sensitive as the token itself"; operators running with log aggregation need to consider this — the alternative (don't create a project in env-seed mode, make the operator use the UI later) is worse UX.

#### CLI recovery alternative

```
docker compose exec api node dist/cli bootstrap-admin \
  --email alice@example.com \
  --password '<generated>' \
  [--display-name 'Alice'] \
  [--force]
```

Behaviour:
- Without `--force`: refuses if any user exists. Error: "An admin user already exists. Use `--force` to override (creates a second admin)."
- With `--force`: creates the user regardless. Does **not** delete the existing user, does **not** transfer ownership of existing orgs. The operator is expected to log in as the new admin and re-admin themselves via the normal UI.
- Does not create an org or project — those require the wizard or env-seed. The CLI path is specifically for "admin user missing, everything else intact" recovery.

The CLI loads the same Better Auth initialization path as the HTTP server, so it respects password-strength rules and stores the same hash format — a CLI-created user can log in via the HTTP UI with no migration.

#### Race protection — `CTRFHUB_SETUP_TOKEN`

While `users` is empty, `/setup` is reachable unauthenticated. The default posture is "operator brings the instance up on localhost or a private network for the initial session." Operators who must expose the instance publicly before first login can set `CTRFHUB_SETUP_TOKEN=<value>` — `/setup` then requires `?token=<value>`, and the 302 redirects from other routes preserve the token param.

Off by default. Adding a token gate to the default path is friction for the common case of laptop-first bring-up; an opt-in env var is the right balance between the "99%" and the "exposed public bring-up" scenarios.

#### What this intentionally does not cover

- **Multi-tenant platform admin.** There is no global "platform owner" role above organization admin. Org admin is the top role. A self-hosted instance running two orgs on the same container has no single user who can admin both unless they're Admin in both `organization_members` rows. Business Edition revisits this.
- **SSO-at-bootstrap.** MVP is email/password only. SSO is a Business Edition concern; bootstrapping a fresh instance into an SSO-only auth mode is not a v1 flow.
- **"Get started" checklist widget.** The Gaffer reference shows a persistent post-wizard checklist on the dashboard (Upload test run / Connect GitHub / Setup Slack / Invite team members). Deferred to Community Phase 2 — the MVP dashboard shows the "Waiting for your first test report" empty state only.
- **Automated reset.** There is no `DELETE /setup` or "reset instance" API. The only way to re-enter the wizard is to drop the `users` table manually, which also implies dropping everything that cascades from it.

---

### DD-021 — Password reset: Better Auth `verification` table, 1-hour TTL, enumeration-safe, session-invalidating; admin-initiated and CLI paths close the no-SMTP case

**Decision:** Password reset is a standard self-serve flow backed by Better Auth's built-in `verification` table (no new CTRFHub schema). Token TTL is 1 hour. The endpoint is enumeration-safe — it always returns "If an account exists with that email, a reset link has been sent." Successful reset invalidates all of the user's existing sessions and auto-logs-in on the reset device. When SMTP is not configured, the "Forgot password?" link is hidden; two fallback paths handle recovery: an admin-initiated reset in `/admin/users` that produces a copyable link (like the invite flow), and a CLI command `reset-admin-password` for "everyone is locked out" scenarios.

**Why these three paths together:** the self-serve flow is the 95% case. The admin-initiated link is the "I can't get email but my admin can still access the UI" case. The CLI is the "nobody has UI access" escape hatch. Dropping any one of these leaves a real recovery scenario unsupported. Together they guarantee that no forgotten password ever requires dropping the DB.

#### Flow (self-serve)

```
/login
  └── [Forgot password?] ← hidden if SMTP not configured (see below)
      └── /forgot-password
           ├── Email input
           └── POST /forgot-password
                 ├── Rate limit check (10/min/IP + 3/hour/email)
                 ├── Look up user by email
                 │     ├── found: generate 32-byte token, store hash in verification table (Better Auth), send email
                 │     └── not found: no-op (do not write token, do not send mail)
                 └── ALWAYS return 200 with body:
                       "If an account exists with that email, a reset link has been sent."
                       (identical response either way — no enumeration)

Email contains link: {PUBLIC_URL}/reset-password?token=<opaque-32-byte-base64url>

/reset-password?token=<t>
  ├── Server looks up the verification row by token hash
  │     ├── not found / expired / already consumed: render "Link invalid or expired" page with CTA to /forgot-password
  │     └── found: render new-password form (two-field: password + confirm)
  └── POST /reset-password
       ├── Verify token still valid (TTL 1h, not yet consumed)
       ├── Validate new password (min 12 chars, Better Auth rules)
       ├── Update users.password_hash
       ├── Mark verification row consumed (Better Auth handles this)
       ├── Invalidate ALL sessions for this user (DELETE FROM sessions WHERE user_id = :id)
       ├── Create new session for the reset device; set cookie
       ├── Send "Your password was just changed" notification email (if SMTP configured)
       └── 302 → / (dashboard)
```

**Why invalidate all sessions:** assumes the reset was motivated by a compromise scenario (phishing, session hijack, shared-device leak). Industry standard. Dropping the current session is handled atomically by issuing a new session cookie before the redirect so the resetting user isn't kicked out.

**Why Better Auth's `verification` table:** Better Auth already provisions this schema (`(id, identifier, value_hash, expires_at, created_at)` with `identifier` distinguishing `email-verification` / `password-reset` / `magic-link`). Using it means zero new schema, zero custom token logic, and the TTL + consumption semantics are a vendored-in concern we don't maintain. The `identifier` field for password reset is literally the string `"password-reset"` so the reset flow does not conflict with email-verification tokens (separate flow — see B3 when we get to it).

#### Rate limits

| Layer | Limit | Rationale |
|---|---|---|
| Per IP | 10/min (shared with login — see §9) | Brute-force protection at the IP level |
| Per email | 3/hour | Prevents "email bombing" a user with repeated resets |

The per-email limit is enforced inside the route handler using a small in-memory LRU keyed by lowercased email (same pattern as the session-limit-per-user counter from DD-012). Exceeded → still return the enumeration-safe 200 response with no mail sent. An attacker cannot probe the rate-limit counter to confirm account existence. This is the reference implementation of DD-012's enumeration-safety rule — see DD-029; the canonical table row also lives in DD-012 Layer 2.

#### Password policy on reset

Same rules as the bootstrap wizard (DD-020 step 1): minimum 12 characters, Better Auth's built-in common-password denylist, no match against the user's current hash (checked by Better Auth before persisting — prevents "reset to the same password I forgot").

#### SMTP-not-configured behaviour

Better Auth is configured with an email sender. If `SMTP_HOST` is unset at boot, the sender falls back to a no-op adapter that logs outgoing email attempts to stdout but returns success to the caller — this keeps the rest of Better Auth's internals happy. On the UI side:

- `/login` reads a server-rendered `smtpConfigured` flag. If `false`:
  - The "Forgot password?" link is not rendered.
  - A subdued footer note appears: *"Password reset requires SMTP. Contact your admin or use the CLI recovery command (`node dist/cli reset-admin-password --help`)."*
- `POST /forgot-password` returns the same enumeration-safe 200 regardless of SMTP state. An attacker can't probe SMTP status via this endpoint.

The `smtpConfigured` flag is derived server-side from whether the Better Auth email config has a real adapter. Exposing it to `/login` is intentional — an honest signal to authenticated-or-not users that email-based flows won't work on this instance is better than silent failures.

#### Admin-initiated reset

Under `/admin/users`, each user row gets a new row-action menu item: **Reset password**. Clicking it:

1. Requires the acting user to have admin role in at least one org that shares membership with the target user. (A user with admin role in Org A cannot reset the password of a user who is only a member of Org B. Scope guard at the API layer.)
2. Opens a confirmation modal: "Reset password for alice@example.com? They'll be signed out of all sessions and asked to pick a new password."
3. On confirm: server generates the same 32-byte token and stores it in the verification table with a 1-hour TTL. **No email is sent** (regardless of SMTP state — this path is for when the admin is the delivery channel).
4. Modal updates to show the one-time reset link (`{PUBLIC_URL}/reset-password?token=<t>`) with a Copy button and "This link will not be shown again" warning. Admin closes the modal after copying.
5. Admin relays the link out-of-band (Slack DM, SMS, in-person note).

Authorization: available to users whose role in the target's primary org is `Admin`. Logged in the audit log (Business Edition) as `user.password_reset_initiated_by_admin`. Not logged in Community Edition — the audit log table doesn't exist there.

#### CLI recovery — `reset-admin-password`

Extends the CLI surface from DD-020:

```
docker compose exec api node dist/cli reset-admin-password \
  --email alice@example.com \
  --password '<new password ≥ 12 chars>' \
  [--force]
```

Behaviour:
- Looks up the user by email. If not found: exit 1 with message.
- Without `--force`: refuses unless the user has `role='Admin'` in at least one organization. Error: "User is not an admin in any organization. Use `--force` to reset a non-admin user's password." This gate prevents the CLI being used as a general "reset any user" backdoor — the intended scope is recovery, not administration.
- With `--force`: resets regardless of role.
- Sets the new password, invalidates all of the user's sessions (same `DELETE FROM sessions WHERE user_id = :id`).
- Does **not** send a notification email. Operators running this command are expected to tell the user out-of-band.
- Logs the outcome to stdout: `OK: password reset for alice@example.com (sessions invalidated: 3)`.

Shares password-policy enforcement with the HTTP flow (reads the same Better Auth config). A password that would be rejected at the HTTP layer is also rejected at the CLI.

#### Success-notification email

When a password reset succeeds (either self-serve or admin-initiated, once the user completes the reset form), a notification email is sent to the user: *"Your CTRFHub password was just changed. If this wasn't you, contact your admin immediately."* 

- Sent on the final success transition, not on token generation.
- Includes: reset timestamp (UTC), originating IP address, and a short description of what to do if it wasn't them.
- Requires SMTP. If SMTP is not configured, no notification is sent (and the admin-initiated path above was the only way to get here anyway, so the admin already knows).

#### What this intentionally does not cover

- **Passwordless / magic-link login.** Better Auth supports magic links but MVP stays on email/password. Magic links are a follow-on.
- **Security questions as a fallback.** No "mother's maiden name" fallback — those have been repeatedly shown to be weaker than passwords.
- **Hardware-token recovery.** 2FA is deferred entirely (see PL-010 in `parking-lot.md`); this DD covers password reset only. Had 2FA been in MVP, recovery would be a fourth path (backup codes) parallel to the three here.
- **Email change.** Changing the email on an account is a separate flow (out of scope for MVP) and uses a different Better Auth verification identifier. Not covered here. DD-022 covers email *verification* (proving the account's email is reachable), not email *change*.

---

### DD-022 — Email verification: signal-only in MVP, implicit for invited users, banner-nudge for bootstrap admin, no new schema

**Status:** Accepted · **Date:** 2026-04-22

**Context.** DD-020 walks a fresh operator through creating an admin account; DD-021 lets that admin recover a lost password via SMTP. Both assume the admin's email is actually reachable. If the operator typos their email in the `/setup` wizard, nothing in the system catches it — the first sign of trouble is password reset arriving at a mailbox nobody owns. Separately, invited users (B5 territory) need *some* proof they received the invite before they can set their password. Both problems are solved by email verification, but the right shape of "verification" differs sharply between self-hosted and SaaS: in a SaaS product, unverified email often means "don't trust this user"; in a self-hosted product where users are invited by an admin who already vouches for them, verification is about catching typos and making recovery reliable, not about identity proof.

**Decision.** Email verification is **signal-only** in MVP: `users.emailVerified` is tracked and surfaced in the UI, but nothing is gated on it. The bootstrap admin from DD-020 is marked `emailVerified=false` at wizard completion and sees a persistent top-bar banner prompting verification. Invited users (B5) are marked `emailVerified=true` implicitly on invite-link completion — the click itself proves email receipt, and a second verification email would be pedantic. The only explicit verification flow is the "resend verification email" action available from the banner or from `/admin/users`, using a 24-hour opaque token stored in Better Auth's existing `verification` table with `identifier='email-verification'`. When SMTP is not configured, the banner is hidden entirely and no verification UI is surfaced — consistent with DD-021's posture that we refuse to show buttons that cannot work. No new schema: Better Auth already provides `users.emailVerified` (boolean) and the polymorphic `verification` table.

**Rationale.**

- *Signal-only, not gated.* The alternative — blocking writes or logins until verified — is correct for SaaS products with self-signup, where verification is the primary control against spoofed accounts. CTRFHub's Community MVP has no self-signup: admins invite users and the bootstrap flow is operator-on-localhost. Hard-gating on verification turns SMTP misconfiguration into a lockout, which is the failure mode DD-021 went to some length to prevent. Business Edition can tighten this later via an org-level compliance setting; MVP stays permissive.
- *Bootstrap admin marked unverified, not auto-verified.* The argument for auto-verifying ("the operator typed their own email, why prove it?") ignores the actual threat: typos, not spoofing. A silent banner that says *"password reset won't find you if this email is wrong — click to send a verification email"* catches the typo before it becomes a recovery incident, without blocking anything. Zero-friction if SMTP isn't configured (banner hidden); one-click if it is.
- *Invited users: click = verified.* If the invite link works, the email works. A separate second email asking the user to confirm they received the first email is the classic over-engineered-enterprise pattern. Set `emailVerified=true` at the same transaction that consumes the invite and sets the password. **Note:** invite flows are deferred to PL-011 (Phase 2 / Business Edition); this branch of the decision is retained here as forward-compatible design so the eventual invite implementation lands cleanly.
- *Reuse Better Auth's `verification` table.* Same pattern as DD-021 — a new `verification` row with `identifier='email-verification'`, 24h TTL. No new table, no new columns. The `users.emailVerified` boolean already exists in Better Auth's user schema.
- *24-hour TTL.* Verification isn't time-sensitive the way password reset is — there's no window-of-interception concern because the worst outcome of stealing a verification token is flipping a flag to true. 24h matches industry convention (GitHub, Gmail) and survives a long weekend.

**User states and transitions.**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  State                              │ emailVerified │ Banner shown?         │
├─────────────────────────────────────┼───────────────┼───────────────────────┤
│  Bootstrap admin, post-setup        │ false         │ Yes (if SMTP config'd)│
│  CLI-created admin (bootstrap-admin)│ false         │ Yes (if SMTP config'd)│
│  Invited user, post-invite (PL-011) │ true          │ No                    │
│  After clicking verify link         │ true          │ No                    │
│  SSO JIT-provisioned (B1)           │ true          │ No (Business Edition) │
│  SMTP not configured                │ unchanged     │ Never                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

In MVP, only the first two states (Bootstrap admin and CLI-created admin) are reachable — both use the banner-nudge path. The Invited-user row is retained as forward-compatible design for when PL-011 promotes.

**Flow (self-serve verification from the banner).**

1. User sees the top-bar banner: *"We haven't verified your email — if it's wrong, password reset won't find you. [Send verification email]"*
2. User clicks the button. Server: `POST /api/v1/account/verify-email/send` with no body (identifies user from session). Handler looks up the user, checks rate limits (3/hour/user, 10/min/IP), creates a `verification` row with `identifier='email-verification'`, `value=<user_id>`, `expiresAt=now+24h`, sends email containing `https://<host>/verify-email?token=<32-byte-hex>`.
3. Response is always `200 OK` (same enumeration-safe posture as DD-021, even though the user is authenticated — keeps the surface consistent and avoids leaking "this email was previously changed to X").
4. User clicks the link. Server: `GET /verify-email?token=...` → looks up the `verification` row, checks `expiresAt`, verifies the `value` matches the currently-logged-in user (or at minimum an existing user), deletes the row, sets `users.emailVerified=true`, redirects to `/` with a flash toast *"Email verified."*
5. Banner no longer renders on subsequent pages.

A token that is expired or already consumed renders the same generic "link invalid or expired" page DD-021 uses. No distinction between the two cases.

**Invited-user flow (deferred to PL-011 — recorded here as forward-compatible design).**

- Admin invites `bob@example.com` from `/admin/users`. Invite row created; email sent with `https://<host>/accept-invite?token=...`.
- Bob clicks the link. Server checks the invite token, presents a "set your password" form.
- On successful password set, in a single transaction: create `users` row with `emailVerified=true`, consume the invite token, create `organization_members` row, start a session, redirect to `/`.
- No separate verification email is sent — the click proved receipt.

This flow is not implemented in MVP (see PL-011 in `parking-lot.md`); the only user-creation surfaces are the `/setup` wizard and `node dist/cli bootstrap-admin --force`.

**Bootstrap admin flow.**

- DD-020's `/setup` wizard completes. The final transaction writes the `users` row with `emailVerified=false`.
- On next page load, the top-bar banner renders if `users.emailVerified=false` AND `SMTP_HOST` is set. Banner is present on every page until verified or the user is logged out.
- Banner copy (subject to UX review, see `design:ux-copy` skill when we iterate on onboarding): *"Verify your email to enable password reset. This email won't receive important account notifications otherwise. [Send verification email] [Why?]"*. Clicking "Why?" opens a small popover explaining that password reset requires a reachable email.
- Banner has no dismiss button — it goes away when verification succeeds, and it's the only persistent nag in the product.

**Admin visibility.**

`/admin/users` gets an "Email verified" column showing a green dot for `true` and a grey dot for `false`. Admins can trigger a resend of the verification email from a row action using the same endpoint the self-serve banner calls, scoped to the target user. Rate limits apply to the admin-triggered resends too (they share the per-user 3/hour cap). In MVP the only users visible on this screen are the bootstrap admin plus any CLI-created admins (see PL-011 for the deferred multi-user expansion).

**SMTP-not-configured UX.**

When `SMTP_HOST` is unset:
- The top-bar banner never renders for any user.
- `POST /api/v1/account/verify-email/send` is not mounted — the route returns `404`. The `/admin/users` resend row action is hidden (not greyed out — genuinely not rendered).
- `GET /verify-email?token=...` is still mounted and functional: a verification link mailed from a past SMTP-configured period still works if someone kept it. This is defensive; the common case is that SMTP either stays configured or stays unconfigured for the lifetime of the instance.
- No nagging, no banner explaining that SMTP isn't set up. Matches DD-021's "hide buttons that can't work" principle.

**Rate limits.**

Canonical rows live in DD-012's Layer 2 table (see DD-029 for the consolidation decision):
- `POST /api/v1/account/verify-email/send`: **3 req/hour per user + 10 req/min per IP** — "Email verification — send" row.
- `GET /verify-email?token=...`: covered by the general authenticated-API row (600 req/min per user). Consuming a verification token is cheap and a flood indicates something weird, not abuse.

**Token policy.**

- 32-byte opaque tokens (identical format to DD-021).
- Single-use; consumed atomically with the `users.emailVerified=true` write.
- 24-hour TTL. Nightly sweep prunes expired rows from `verification` (Better Auth's built-in cleanup job already handles this).
- `value` column holds the target user ID (not the token itself — the token is the `id`-like column per Better Auth's schema).

**Observability.**

- Structured log line on each successful verification: `{ event: 'email.verified', userId, durationSinceCreatedMs }`. The `durationSinceCreated` metric is a useful signal — if the p50 is three weeks, the banner isn't persuasive enough; if the p99 is five seconds, operators are bulk-clicking and the typo-catching goal isn't working.
- Counter `metric:email.verification.sent` and `metric:email.verification.consumed`. A send/consume ratio far below 1 suggests verification emails are ending up in spam folders (worth flagging).

**Non-goals (out of scope for MVP).**

- **Hard-gating on `emailVerified`.** Not in Community. Business Edition can add an org-level setting (`require_email_verified_for_writes`) post-MVP.
- **Email change.** `PATCH /users/:id/email` with re-verification is a separate flow (the whole point of email change is re-verifying the new address). Not in MVP.
- **Magic-link login.** Better Auth supports this, but we stay on email/password for Community MVP.
- **Verification for SSO/SAML users (Business).** IdP sets `emailVerified=true` on JIT provision. Covered when SSO lands.
- **"Re-verify my email periodically" flow** (some compliance regimes want this). Business Edition / post-MVP.
- **Multiple emails per user.** One email per account; no "primary/secondary" concept (that's GitHub-sized complexity for no MVP win).

---

### DD-023 — Project delete, per-run export, and cascade rules: hard delete with confirm-by-typing, CTRF-symmetric export; MVP uses cascade-only artifact cleanup

**Status:** Accepted · **Date:** 2026-04-22

**Context.** MVP had an undocumented delete/export story across four surfaces: project delete (implied by "project settings" but with no cascade rules, confirmation UX, or artifact-cleanup contract), org delete (no design), user account delete (moot in a single-admin MVP per PL-011), per-run export (ingest is CTRF JSON but no symmetric export was designed), and bulk export (undesigned). Without an explicit cascade contract, partial deletes are a footgun — a deleted project row whose artifacts remain on disk is a slow storage leak and a subtle privacy failure. Without a symmetric export path, CTRFHub violates its own "CTRF-native" positioning — data can enter but can't leave in the format it arrived in.

**Decision.** MVP ships **project delete** (hard delete with confirm-by-typing, full cascade) and **per-run export in two shapes** (JSON + ZIP). Org delete is deferred to "drop the Docker volume" (Community MVP is single-org-per-instance per the PL-011 scope reduction — deleting the org is operationally equivalent to deleting the instance). User account delete is deferred to PL-011 alongside invites. Bulk / CLI export is deferred to PL-012. Orphaned-artifact reconciliation — the nightly sweeper that catches rows where the DB delete committed but the file unlink failed — is deferred to PL-013; MVP accepts the bounded leak with structured logging on unlink failures so operators can detect the condition. Data-controller compliance machinery (GDPR Article 17 SAR tracking, anonymization as a delete alternative) is explicitly operator responsibility; CTRFHub's job is providing the tools (delete with cascade, export in a portable format), not the bookkeeping.

**Rationale.**

- *Hard delete over soft delete.* The 30-day-recovery-window pattern is a SaaS-era assumption that doesn't survive first contact with self-hosted operators who take their own backups. Confirm-by-typing-project-name is the friction that prevents accidents; a recovery window is belt-and-suspenders that costs a `deleted_at` column, query-time filtering on every read, a nightly sweeper, and user confusion about why "deleted" data still shows up in disk usage.
- *Confirm-by-typing, not a checkbox.* A checkbox becomes muscle memory. A typed project name forces the admin to pause and read. The modal also shows the blast radius up front — *"This will delete 847 runs, 52,103 tests, and 14.2 GB of artifacts. Type `nightly-hermes-tests` to confirm."* — so the deletion is never surprise-shaped.
- *Cascade-only cleanup in MVP.* The alternative (nightly reconciliation sweeper — PL-013) costs a storage-list scan every night. For small deployments it's cheap; for large ones with S3-backed artifacts it's an ongoing cost line. MVP takes the simpler path: delete-order is DB-first-then-unlink, the unlink runs inside the same request, and if it fails we log loudly. The leak is bounded by user-initiated deletes, not ingest volume — a slow drip, not a fast fill.
- *Export format = CTRF JSON (symmetric with ingest).* The whole product positioning is "CTRF-native". Export should round-trip: a run exported from instance A can be re-ingested into instance B and land as a recognizable run. Plus a `ctrfhub` metadata envelope carrying AI categorizations, manual overrides, comments, and artifact URLs — enough to make the export useful inside the CTRFHub ecosystem without breaking the CTRF-spec purity of the `results` subtree.
- *ZIP alongside JSON, same URL namespace.* `/export.json` and `/export.zip` are two extensions on the same endpoint. JSON is the lightweight link ("paste this into a gist"); ZIP is the archive ("attach this to the bug ticket"). Cheap to ship both.

**Cascade rules for project delete.**

```
projects                                                (starting row)
├── test_runs                                           ON DELETE CASCADE
│   ├── test_results                                    ON DELETE CASCADE
│   │   ├── test_result_tags                            ON DELETE CASCADE (junction)
│   │   ├── test_result_comments                        ON DELETE CASCADE
│   │   └── test_result_artifacts                       ON DELETE CASCADE
│   │       └── filesystem unlink / S3 DeleteObject     (application-level, post-DB-commit)
│   ├── ai_pipeline_log                                 ON DELETE CASCADE (by test_run_id, added in DD-017)
│   └── ingest_idempotency_keys                         ON DELETE CASCADE (added in DD-019)
├── project_tokens                                      ON DELETE CASCADE
├── project_webhooks                                    ON DELETE CASCADE (added in DD-018)
│   └── webhook_deliveries                              ON DELETE CASCADE (by webhook_id)
├── project_slug_aliases                                ON DELETE CASCADE (added in DD-012)
└── milestones (Business Edition)                       ON DELETE CASCADE
    └── test_plan_entries                               ON DELETE CASCADE
```

All FK-level cascades run inside the transaction that deletes the `projects` row. The artifact filesystem/S3 unlinks run *after* the DB commit, because rolling back a file deletion is impossible — we accept the orphan-on-unlink-failure risk (tracked by PL-013) over the alternative of rolling back a user-confirmed delete.

**Delete flow.**

1. Admin navigates to `/projects/:id/settings` → scrolls to "Danger zone" → clicks **Delete project**.
2. Modal opens with: project name (bold), blast-radius summary (*"847 runs, 52,103 tests, 14.2 GB of artifacts — computed in real time"*), empty text input, Confirm button disabled until the typed value matches the project slug exactly (case-sensitive).
3. User types the slug → Confirm enables → click → `DELETE /api/v1/projects/:slug?acknowledge=true`.
4. Server: permission check (caller must be Admin in the project's org). Read the project row into a local. Start transaction. Delete the `projects` row — FK cascades fire. Commit. Outside the transaction: unlink all artifact files (local FS `unlink()` per path, or S3 `DeleteObjects` batched up to 1000 keys per call). Each unlink failure is logged (`level=warn`, `event=artifact.unlink_failed`, with the path/key for later reconciliation). Return `204 No Content`.
5. UI navigates to `/projects` and shows a toast — *"Deleted project <name>. 14.2 GB of artifacts are being removed in the background."*
6. If every artifact unlink succeeded, the project is fully gone. If some failed, the DB is clean but files remain on disk / in S3 — PL-013 territory.

**Per-run export endpoints.**

- `GET /api/v1/runs/:id/export.json` — streams an `application/json` response shaped like:

```jsonc
{
  "reportFormat": "CTRF",          // original CTRF subtree
  "specVersion": "1.0.0",
  "results": { /* … original CTRF, preserved as ingested … */ },

  "ctrfhub": {                     // CTRFHub metadata envelope
    "version": "1.0",
    "runId": 12345,
    "projectSlug": "nightly-hermes-tests",
    "ingestedAt": "2026-03-01T04:12:33.000Z",
    "aiCategorizations": [ { "resultId": "…", "category": "App Defect", "confidence": 0.87, "override": null } ],
    "comments": [ { "resultId": "…", "author": "alice@ex.com", "body": "…", "createdAt": "…" } ],
    "artifacts": [ { "resultId": "…", "url": "https://…/api/files/…", "type": "screenshot" } ]
  }
}
```

- `GET /api/v1/runs/:id/export.zip` — streams a `.zip` (not a tarball — better cross-platform UX) containing `manifest.json` + the JSON above + `artifacts/<resultId>/<filename>` for each linked local artifact. S3-backed artifacts are fetched server-side and streamed into the ZIP as the response is produced; if the operator's S3 bucket is far from the CTRFHub host, this is bandwidth-intensive but produces a self-contained archive. The alternative ("manifest with links only") was rejected because the whole value of the ZIP is archival self-containment — links that expire in an hour (per the DD-005 pre-signed URL policy) would make the ZIP useless offline.

Both endpoints respect project-level read authorization (same check as `GET /api/v1/runs/:id`). Covered by the general authenticated-API rate limit.

**Filename conventions.**

- JSON: `run-<runId>-<YYYYMMDD>.json`
- ZIP: `run-<runId>-<YYYYMMDD>.zip`

Set via `Content-Disposition: attachment; filename=…`.

**Schema.**

- **No new tables.** The `DELETE ... CASCADE` contract is already established on every FK relationship listed above; DD-023 is the first place the full cascade fan-out is written down in one table but it doesn't change any migration.
- **No new columns in MVP.** The `test_result_artifacts.deleted_at` column briefly considered during planning is deferred to PL-013 — without the reconciliation sweeper there's no consumer for it.

**Rate limits.**

Canonical rows live in DD-012's Layer 2 table (see DD-029 for the consolidation decision):

- `DELETE /api/v1/projects/:slug`: **5 req/hour per admin** — prevents a compromised credential or a runaway admin-owned automation from scripting project deletion. "Project delete" row.

Export endpoints fall under the general authenticated-API row (600 req/min per user). Large ZIP exports stream — no additional limit needed.

**Data-controller posture.**

CTRFHub is self-hosted. The operator is the data controller for all data stored in their instance. CTRFHub's responsibility ends at providing the tools: delete-with-cascade, export-in-a-portable-format, and honest documentation of what the tools do (this section). CTRFHub does not track subject-access-requests, does not maintain a deletion audit log in Community MVP (Business Edition audit log covers this — see B3), and does not offer anonymization as a delete alternative. Operators with GDPR/CCPA obligations layer their own compliance machinery on top — the tools here are sufficient for the mechanical parts (find-the-data, export-the-data, delete-the-data) of a SAR response.

**What this intentionally does not cover.**

- **Org delete.** Deferred — single-org-per-instance is the PL-011 scope reduction; deleting the org = deleting the instance = `docker volume rm`. Promoted alongside PL-011 when multi-org Community deployments become plausible.
- **User account delete.** Deferred to PL-011. Account-delete is meaningful when there are multiple users on an instance; until invites land, "delete my account" and "delete the instance" are the same operation.
- **Bulk / CLI export.** Deferred to PL-012 with decisions frozen. Per-run export covers the *"I want this one run's data"* case; the *"I want to migrate to a new instance"* case is what PL-012 exists for.
- **Orphaned-artifact reconciliation.** Deferred to PL-013. MVP accepts the bounded leak with structured logging (`event=artifact.unlink_failed`) so operators can detect the condition; PL-013 adds the nightly sweeper and the optional `ctrfhub fsck` CLI.
- **Soft delete / recovery window.** Explicitly rejected — Stripe-style 30-day windows are a SaaS assumption. Self-hosters have their own backups.
- **Anonymization.** Not a delete alternative in MVP. Test data rarely contains PII; operators who need it do it in the export.
- **Cross-region / replicated storage deletion.** Operator concern. If S3 replication is configured, the unlink hits the primary bucket only. Documented as such.
- **Audit-log entries for delete events (Community).** Structured log line suffices. Business Edition audit log (see B3) persists it.

---

### DD-024 — API versioning: URL-based `/api/v1/`, 6-month overlap, `410 Gone` after sunset; webhook payload version decoupled from URL; `/hx/*` for HTMX partials

**Decision:** CTRFHub commits to a specific, narrow definition of what `v1` promises. Breaking changes require a v2. Deprecated endpoints signal via standard HTTP headers for at least one full overlap window before removal. HTMX-only partial endpoints are explicitly carved out of the `/api/v1/` contract and move freely with the server HTML that consumes them.

**Why this matters for CTRFHub specifically:** the most externally-consumed surface is `POST /api/v1/projects/:slug/runs`. Every CTRF reporter in every CI pipeline on every downstream team points at that URL with a particular payload shape. Reporters are typically authored once and left untouched for years. A silent breaking change in CTRFHub 0.9 simultaneously breaks every community-maintained pipeline the day they `docker compose pull`. The secondary externally-consumed surface is the export API (DD-023) — round-tripping between CTRFHub instances implies the export shape is stable enough that a newer instance can ingest an older instance's export. The webhook payload shape (DD-018) is a third contract with its own audience (chat-ops receivers, Zapier bridges) and its own change cadence.

#### What `v1` promises

The `v1` prefix is a stability commitment. For every endpoint under `/api/v1/*`, CTRFHub guarantees:

- **Response field shapes stay stable.** Existing fields keep their names, types, and semantic meaning across minor releases.
- **Request payload validation stays backward-compatible.** A request that was accepted by `v1` in a previous release will continue to be accepted (unless the endpoint is explicitly deprecated and sunsetted per the mechanism below).
- **Status codes stay semantically stable.** `201 Created` on ingest success stays `201`; `409 Conflict` on idempotency collision stays `409`. New status codes may be added for genuinely new conditions but existing codes will not be redefined.
- **Auth requirements stay stable.** An endpoint that accepted `x-api-token` will continue to accept `x-api-token`; CTRFHub will not silently switch an endpoint to session-only auth and break CI pipelines.

#### Breaking-change definition

The following are **breaking** and require v2 (or a deprecation-and-sunset cycle for the specific endpoint):

- Removing a response field; renaming a response field; changing a response field's type or format.
- Adding a new **required** request field, or a new required header.
- Tightening validation to reject input shapes that previous releases accepted.
- Removing an endpoint.
- Changing the semantic meaning of an existing status code on an existing endpoint.
- Changing auth requirements on an existing endpoint.
- Changing the shape of an existing event's webhook payload under the same `version`. (Shipping a new `version` is the non-breaking alternative — see §Webhook payload versioning below.)

The following are **non-breaking** and ship freely in minor releases:

- Adding optional request fields or headers.
- Adding response fields (clients that don't know the field ignore it).
- Adding new endpoints.
- Adding new status codes for genuinely new conditions (not redefining existing ones).
- Adding new query parameters with safe defaults (default behaviour matches pre-existing behaviour).
- Relaxing validation (accepting input that used to be rejected).
- Adding a new webhook `version`; adding a new event type (receivers filter on `event`).

#### Deprecation headers

When an endpoint is being phased out, every response carries the following headers (RFC 8594 + RFC 9745):

```
Deprecation: true
Sunset: Sun, 31 Dec 2026 23:59:59 GMT
Link: <https://ctrfhub.dev/docs/api/migrations/v1-v2>; rel="sunset"
```

The `Sunset` date is a hard commitment — after that date, the endpoint returns `410 Gone` with a JSON body pointing at the migration doc (see §v1 → v2 transition). `404` is not used for retired endpoints because it is ambiguous with "you typoed the slug"; `410` is self-diagnosing ("this endpoint existed, it was removed").

Every request that hits a deprecated endpoint logs a structured event:

```
event=api.deprecated_endpoint.hit
endpoint=POST /api/v1/projects/:slug/runs
caller_type=project_token
caller_id=<project_token.id>
user_agent=<...>
```

(Caller is identified by the token ID for `x-api-token` requests and by the user ID for session-auth requests; the value lands on the admin dashboard even when logs aren't shipped off-box.)

**Admin visibility.** The System Status page gains a "Deprecated endpoints in use" subsection showing any endpoint with hits in the last 7 days, with caller counts broken down by `caller_id` so operators can identify which CI pipelines or users still need to migrate before the sunset date. Clears automatically when 7 days pass with no hits.

#### v1 → v2 transition mechanics

When enough breaking changes accumulate (or a specific blocking change lands — e.g. the CTRF spec publishes a major revision the existing ingest endpoint cannot absorb without a payload-shape change) CTRFHub ships both prefixes concurrently:

- `/api/v1/*` continues to serve the v1 contract, now with `Deprecation: true` and `Sunset: <date-6-months-out>` on every response.
- `/api/v2/*` serves the new contract.
- Migration documentation at `https://ctrfhub.dev/docs/api/migrations/v1-v2` enumerates every diff: which endpoints moved, which fields renamed, which validation tightened.

**Minimum overlap: 6 months.** Covers one quarterly CI-maintenance cycle for most teams, plus slack for teams that don't maintain on a quarterly cadence. After the sunset date, `/api/v1/*` endpoints return `410 Gone` with a body like:

```json
{
  "error": "endpoint_sunset",
  "message": "This endpoint was part of the v1 API and was retired on 2027-04-22. See the migration guide to upgrade.",
  "migration": "https://ctrfhub.dev/docs/api/migrations/v1-v2",
  "current_api": "/api/v2"
}
```

Operators running long-lived reporters that cannot be updated for contractual reasons can self-extend the window by not upgrading CTRFHub — the old version keeps serving `/api/v1/*` indefinitely. This is a self-hosted product; the upgrade decision is the operator's.

**The sunset date is committed in the migration doc at the time v2 ships,** not "some time later". A date without a commitment isn't a sunset, it's a threat.

#### Webhook payload versioning — separate from URL version

Webhook payloads (DD-018) carry an explicit top-level `"version"` field (currently `"1"`). Breaking changes to the payload shape cut a new `version` value, independent of URL API version. Each `project_webhooks` row pins `payload_version` at creation time (default: latest at creation); the pin holds across CTRFHub releases until the admin changes it explicitly.

**Why decoupled:** chat-ops integrations and CI pipelines are two audiences with different change-tolerance profiles. A CI pipeline author is a developer who can read a migration doc and update a reporter. A webhook receiver is often a Zapier/n8n bridge, a small bash script transforming into a Slack-incoming-webhook body, or a PagerDuty Events API mapper — authored once by someone who is no longer on the team. Forcing webhook payload evolution to move in lockstep with API evolution means every v2 silently kills chat-ops automation that was fine for years.

**Schema impact:** additive — `project_webhooks.payload_version VARCHAR(16) NOT NULL DEFAULT '1'` already added in §4.21.

**Deprecation mechanism for payload versions** mirrors the URL version mechanism: when a new payload version ships, old-version rows keep emitting the old shape for a minimum 6-month overlap with the same `event=webhook.deprecated_payload_version.used` structured log event. After sunset, deliveries for retired versions are rewritten to the current version at send time (old version rows can't emit the new shape without admin action, and failing the delivery is worse than rewriting the shape once).

Admins see a "Webhooks still on payload_version=1" summary on the integrations surface during the overlap window — same detection-before-breakage pattern as deprecated endpoints.

#### External vs. internal API boundary — `/hx/*` prefix for HTMX partials

The `/api/v1/*` stability commitment covers **externally-consumed** endpoints only — ingest, export, account APIs called by CLIs or scripts, and anything a CI pipeline or third-party integration plausibly calls. HTMX-partial endpoints have no external consumers; they ship with the HTML that calls them and move freely with the server.

To make this boundary visible in the URL, HTMX-only partial endpoints live under `/hx/*` instead of `/api/v1/*`. Examples:

| URL | Audience | Response | Versioning |
|---|---|---|---|
| `POST /api/v1/runs/:id/comments` | External (CLI, third party) | JSON comment object | v1 contract |
| `POST /hx/runs/:id/comments` | HTMX partial (server-rendered dashboard) | `<li>…</li>` fragment | Moves with server |
| `GET /api/v1/runs/:id` | External | JSON run object | v1 contract |
| `GET /hx/runs/:id/flaky-panel` | HTMX partial | `<div>…</div>` fragment | Moves with server |

**Code organization** mirrors this: `server/src/routes/api/v1/*` vs. `server/src/routes/hx/*`. Auth middleware, rate limits, and search indexing are shared; response-shape contracts differ.

**`/hx/*` responses set `Vary: HX-Request` and may return `400 Bad Request` to callers that do not send the `HX-Request: true` header** — reinforces "these are not for external consumption" without requiring a separate auth surface. The server does not promise that requests without the header will work.

Callers that think they need an `/hx/*` endpoint programmatically should file an issue requesting the `/api/v1/*` equivalent — it will either already exist or land additively.

#### Rate limits, search indexing, auth

`/hx/*` endpoints share the auth middleware, session enforcement, and search-indexing hooks with `/api/v1/*`. They differ only in response-shape contract and audience. Rate limits: the general authenticated-API limit (600 req/min per user) covers both prefixes jointly — a single dashboard page load that fires multiple HTMX partial requests is still one user, and counting `/hx/*` separately would invite an artificial limit.

#### What this intentionally does not cover

- **OpenAPI 3.1 spec at `GET /api/v1/openapi.json`.** Recommended but deferred to PL-015 — specific promotion trigger is "first accidental break slipped past code review" or "community asking for codegen" or "Business Edition launch". The spec is generated from Fastify schemas (which already exist for Zod-validated routes), so the work is ~1 day — the reason to park is that MVP has no external users whose CI we can break, and diff-the-spec-across-releases only yields value once there's a committed baseline.
- **GraphQL.** No. `v1` is REST. Operators who want a GraphQL surface can run a gateway; CTRFHub is not going to maintain two API surfaces.
- **API-level feature flags.** Not versioning. Feature flags are a rollout mechanism, not a compatibility contract. If we want to gate a new endpoint behind a flag, the endpoint itself doesn't exist from the client's perspective until the flag is on; no versioning implication.
- **Semantic versioning of the API independent of CTRFHub releases.** Not pursued — `/api/v1/` is a coarse-grained commitment tied to a major-version bump. Finer-grained semver on the API surface would imply headers like `Accept: application/vnd.ctrfhub.v1.2+json`, which is exactly the content-negotiation complexity we avoided in E1. Operators who need to know which CTRFHub release a behaviour landed in read the CHANGELOG.
- **Dual-serving behind a proxy during v1→v2 overlap.** Not needed — both versions are served by the same CTRFHub process on the same port. No reverse-proxy trickery, no two-deployment migration. Operators upgrade the single container and the new prefix becomes available.
- **Client libraries.** Not in MVP. The `curl` + `x-api-token` example in `/setup` step 4 is the client; the CTRF reporters for Playwright/Cypress that land in Feature 6 are thin HTTP posters. A first-party SDK is additive (PL-015 adjacent) and requires an OpenAPI spec to stay in sync.

#### Cross-references

- DD-018 — Webhook payload shape (now carries `version`).
- DD-019 — `Idempotency-Key` header is part of the `v1` contract; its behaviour cannot change without a v2.
- DD-023 — Export JSON shape is part of the `v1` contract; round-trippability across instances depends on this.
- Section 11 — CTRF Field Mapping — CTRF spec versioning (adapters keyed by CTRF `specVersion`) is a separate concern from CTRFHub's own API versioning; the two evolve on different timelines.
- PL-014 — the `event=api.deprecated_endpoint.hit` structured log event is one of the scattered `event:*` conventions that PL-014 sub-item 3 (metrics surface) eventually unifies.
- PL-015 — OpenAPI spec (deferred).

---

### DD-025 — Timezone handling: TIMESTAMPTZ everywhere, ISO 8601 UTC on-wire, user→org→env→UTC display hierarchy, Luxon for rendering

**Decision:** Every timestamp is stored as `TIMESTAMPTZ` and serialized on-wire as ISO 8601 UTC with explicit `Z`. Display timezone resolves through a four-level hierarchy per surface (user preference → org default → `DEFAULT_TIMEZONE` env var → UTC). Only IANA zone identifiers (`America/Los_Angeles`), never abbreviations (`PST`, `IST`). Luxon is the single rendering library. Aggregation windows resolve in the relevant actor's TZ (user for dashboards, org for retention). DST is handled by Luxon, not by us.

**Why this matters:** before this DD the schema mixed `TIMESTAMP` (Postgres: timezone-naive, stores the operator's local wall-clock based on the server `TZ` env var) and `TIMESTAMPTZ` (timezone-aware, normalized to UTC). Two CTRFHub deployments running in different regions would store mutually-incomparable values in the same column. SQLite has no timezone-aware type at all, so the dialect discrepancy made this worse. The display story was undefined: nothing in the docs told a developer implementing the dashboard what timezone the chart's X-axis should be in, what timezone retention cutoffs use, or how to render a webhook payload's `delivered_at`. DD-025 closes all of those with one coherent contract.

#### Storage and on-wire format

**Storage.** All timestamp columns declared as `TIMESTAMPTZ` — Postgres stores UTC internally, SQLite via MikroORM stores ISO 8601 UTC strings. MikroORM entity convention:

```typescript
@Property({ type: 'datetime' })
createdAt: Date = new Date();
```

This emits `TIMESTAMPTZ` on Postgres and `DATETIME` (ISO 8601 UTC TEXT) on SQLite without per-dialect special-casing. The style guide (in `CONTRIBUTING.md`) forbids `@Property({ columnType: 'timestamp' })` — a naked `columnType: 'timestamp'` is the bug this DD exists to prevent.

**On-wire.** Every timestamp emitted by CTRFHub — API JSON responses, webhook payloads, export files, logs, CLI output — is ISO 8601 UTC with explicit `Z` (never offsets like `+00:00`, never floating TZ-naive strings):

```json
"created_at": "2026-04-22T14:23:00.481Z"
```

The client's `<time>` element carries the raw ISO string; Luxon renders it into the user's configured zone at view time. This keeps on-wire stable and puts all locale variation at the presentation layer.

#### Display-timezone hierarchy

Effective TZ for a given user at view time resolves in order:

1. `users.settings.timezone` (IANA ID set by the user; NULL by default).
2. `organizations.settings.default_timezone` (IANA ID set by org admin).
3. `DEFAULT_TIMEZONE` env var on the CTRFHub instance.
4. Hard-coded fallback: `UTC`.

Only IANA zone names (`America/Los_Angeles`, `Europe/Berlin`, `Asia/Singapore`). Abbreviations (`PST`, `IST`, `CST`) rejected on write — some are ambiguous (IST maps to India, Ireland, or Israel depending on context; CST maps to US Central or China Standard; BST maps to British Summer or Bangladesh Standard) and Luxon does not treat them as first-class identifiers.

Validation on write (any PATCH to a timezone field): `DateTime.local().setZone(candidate).isValid` — rejects typos, rejects abbreviations, rejects nothing-weird strings.

#### Which surface uses which TZ

| Surface | Rendered in | Rationale |
|---|---|---|
| Dashboard / run detail / tables / charts | User TZ | Single viewer, single location |
| Personal emails (password reset, verification, reset-success notification) | Recipient's user TZ | The reader is in their own location; an email that says "your password was reset at 14:23 UTC" when the user reset it at 09:23 local is disorienting and makes fraud detection harder |
| Retention cron cutoff | Org TZ | Retention is an org policy, not a viewer preference — all viewers see the same fleet of runs survive or disappear |
| System Status page | Org TZ | Shared operational view; admins coordinating on an incident need one timeline |
| Admin-dashboard "deprecated endpoints in use" counters (DD-024) | Org TZ | Same reason — shared operational view |
| Exports (`GET /api/v1/runs/:id/export.{json,zip}`) per DD-023 | UTC | Machine-readable artifacts don't embed human-location choices; round-trippability across instances requires a canonical time base |
| Webhook payloads (DD-018) | UTC | Receivers normalize; DD-018's example already uses `Z` |
| API JSON responses | UTC | Same reason as webhooks — every downstream client normalizes |
| Logs (Pino stdout) | UTC | Operator's log pipeline needs a canonical base; Pino's default `time` field is UTC epoch ms, which is compatible |
| CLI output (`bootstrap-admin`, `reset-admin-password`, migrations) | UTC | Shared across scripts, interactive use, CI captures; UTC is the common ground |
| CTRF ingest parsing (`results.summary.start`/`.stop`) | Treated as UTC epoch ms per CTRF spec | Inbound is unambiguous — see F6 below |

#### Aggregation windows and DST

**Dashboard filters** — "Last 7 / 30 / 90 days" — resolve to a half-open interval in **user TZ**:

```
[start-of-day-in-user-TZ − N days, now]
```

Expressed in Luxon:

```typescript
DateTime.now().setZone(userTz).startOf('day').minus({ days: N })
```

**Chart bucket boundaries** (X-axis labels for pass-rate-over-time, duration-over-time) land on **user-TZ midnight**. A chart viewed by a Singapore user and a Berlin user of the same org will show different buckets for the same underlying runs — that's correct: "yesterday" is a different 24-hour window for each of them.

**Retention cutoff** — the nightly cron — resolves in **org TZ**:

```
runs WHERE started_at < DateTime.now().setZone(orgTz).startOf('day').minus({ days: retention_days })
```

**The cron itself runs at 03:00 UTC**, not in the org TZ. UTC has no DST so the cron fires exactly once per day year-round; running in org TZ would either fire twice on DST fall-back or skip on DST spring-forward. The cron's *trigger time* is UTC; the cron's *cutoff calculation* is org TZ — these are orthogonal.

**DST correctness** — never roll our own. Luxon's `DateTime.plus({ days: 7 })` handles DST boundaries correctly (arithmetic in local calendar units, not in fixed 24-hour chunks). Avoid raw millisecond arithmetic for anything crossing a day boundary.

#### Rendering library — Luxon

MIT licensed, actively maintained, ships IANA timezone data, correct DST math, relative-time formatting built in (`DateTime.fromISO(iso).toRelative()` returns `"3 hours ago"`).

**Rejected alternatives:**

- **moment-timezone** — moment is in legacy-only mode per its maintainers. Any new project greenfielding with moment is adopting technical debt from day one.
- **date-fns-tz** — works but requires a sibling `date-fns` bundle plus the `date-fns-tz` timezone data, roughly 2× Luxon's footprint with no functional advantage for our use case.
- **Native `Intl.DateTimeFormat`** — handles absolute formatting adequately but has no relative-time formatting (`3 hours ago`) and no arithmetic (`startOf('day')`, `plus({ days })`). Either we bolt on a second library for these or we reinvent them; Luxon already has them.
- **Temporal proposal polyfill** — Stage 3, but not production-ready on Node 22 LTS without flags; revisit post-MVP when it hits baseline.

One library, no split-brain between "render this timestamp for a user" and "compute this week's bucket" and "figure out if this retention cutoff is before or after a specific run".

#### CTRF timestamp interpretation

Per the CTRF 1.x spec, `results.summary.start` and `results.summary.stop` are epoch milliseconds, UTC. Ingest parses via `new Date(ms)`:

- **Valid epoch ms.** Parsed and stored. Normal path.
- **ISO 8601 string with TZ designator** (some non-compliant reporters emit these). Parsed via `DateTime.fromISO(value).toJSDate()`. Succeeds; stored as UTC.
- **ISO 8601 string without TZ designator.** Parsed via `DateTime.fromISO(value, { zone: 'utc' })` — assumes UTC. Logs `event=ctrf.timestamp_assumed_utc` with `reporter`, `project_id`, and the raw value so operators can spot a reporter emitting TZ-naive timestamps.
- **Non-parseable.** Ingest returns `422` with a specific validation message (`results.summary.start: unparseable timestamp`).
- **Missing `start` or `stop`.** Both allowed to be NULL. `test_runs.created_at` is the fallback for ordering when `started_at` is NULL. Duration (`completed_at - started_at`) is NULL when either endpoint is missing.

Section 11 already says "Epoch ms → TIMESTAMPTZ" for these two fields; DD-025 extends that with the fallback paths above.

#### Browser TZ detection at `/setup` and user profile bootstrap

**`/setup` Step 2 (Organization)** pre-fills `default_timezone` from the browser's `Intl.DateTimeFormat().resolvedOptions().timeZone`. The form field carries the detected value as its initial content, with a dropdown of common zones plus a search-by-city free-text. Admin can change; default is browser-detected.

**New user bootstrap** (additional admin via `bootstrap-admin --force`; future invited user via PL-011):

- `users.settings.timezone` is NULL by default.
- Cascade to org default per the F2 hierarchy.
- On first dashboard load after login, if the detected browser TZ differs from the effective TZ, show a **dismissable** top-bar banner: "We detected you're in America/Los_Angeles. [Use this zone] [Keep <effective>]". One-shot — clicking either button persists the dismissal; no nagging.

**Rejected:** forcing explicit TZ selection at `/setup` — most users won't know the IANA name for their location (they'd guess "PST" or "Eastern" and get rejected by the validator). Browser-detection-with-confirmation is the UX that works.

#### Schema migration

Because CTRFHub is pre-launch with zero production data, the `TIMESTAMP` → `TIMESTAMPTZ` conversion happens in the initial migration as a single schema change — no backfill, no online migration, no lock-avoidance gymnastics. The MikroORM entity definitions land as `@Property({ type: 'datetime' })` from the start; the generated SQL carries `TIMESTAMPTZ` on Postgres and `DATETIME` on SQLite.

Every column in §4 that previously read `TIMESTAMP` has been updated in this doc to `TIMESTAMPTZ`. No semantic change — those columns were always intended to store UTC instants; the prior `TIMESTAMP` declarations were a latent bug.

**Style-guide rule** added to `CONTRIBUTING.md` (to be written): all timestamp columns use `@Property({ type: 'datetime' })`. Reviewers reject `@Property({ columnType: 'timestamp' })` on sight — if you need a TZ-naive value (a birthday, a policy date that's deliberately floating), use `@Property({ columnType: 'date' })` and document why.

#### Env var

One new env var lands in `deployment-architecture.md`:

```
DEFAULT_TIMEZONE=UTC    # IANA zone. Fallback when user and org haven't set one.
```

Default: `UTC`. Operators in a single-timezone shop set this once at deploy time and forget it — new orgs and new users without explicit preferences inherit.

#### What this intentionally does not cover

- **Per-project timezone override.** Not added. If a team runs CI fleets across multiple regions they configure their CI to emit UTC epoch ms (standard CTRF) and view the dashboard in their own TZ; the chart X-axis is a display concern, not a project-storage concern.
- **Timezone change observability.** No admin notification when a user or org admin changes TZ. Low-risk change, not security-relevant.
- **Storage of the user's raw browser-detected TZ separate from the persisted `settings.timezone`.** Not worth the column — the one-shot banner compares at render time and doesn't need historical state.
- **Daylight-saving transition warnings.** If a chart window crosses a DST boundary, one of the 24-hour segments has 23 or 25 real hours in it. Luxon handles this correctly (the aggregation counts still work — we group by calendar-local day, not by fixed millisecond windows). No explicit UI acknowledgement.
- **Support for legacy TZ abbreviations in API input.** Rejected on write with a `422` and a helpful error listing the three most-likely intended IANA zones (`Asia/Kolkata` for IST-India, `Europe/Dublin` for IST-Ireland, etc. — precomputed lookup table, five entries, doesn't grow).
- **Frontend timezone picker UX design.** Dropdown + search-by-city is the shape; exact widget selection (Flowbite Select vs. custom combobox) is an implementation detail.
- **Audit-log entries for TZ changes.** Business Edition audit log (B3) covers this when promoted; Community MVP logs a structured event (`event=settings.timezone_changed`) and moves on.

#### Cross-references

- DD-009 — Settings storage model: `settings.timezone` lives in the JSONB pref column, not a typed column.
- DD-018 — Webhook payloads already use UTC-with-`Z`; DD-025 makes this a rule rather than an accident.
- DD-020 — `/setup` wizard pre-fills `default_timezone` at Step 2.
- DD-023 — Export JSON is always UTC; export timestamps round-trip across instances.
- DD-024 — API `/api/v1/*` stability commitment includes timestamp *format* (ISO 8601 UTC with `Z`); a future switch to offset notation (`+00:00`) or epoch ms would be a breaking change requiring v2.
- Section 11 — CTRF ingest timestamps parsed per DD-025's fallback paths.

---

### DD-026 — Backup and recovery: standard tools, stop-service for clean backups, newer-binary runs rollbacks, startup version guardrail

**Decision:** Backup uses standard tools (`pg_dump`, `sqlite3 .backup`, `tar`/`rsync`) — no bespoke CTRFHub CLI in MVP (that's PL-016). Three documented recipes cover Postgres+local, Postgres+S3, and SQLite; each carries a stop-service variant as the cleanest path. Restore runs a seven-step runbook: stop → DB → artifacts → version-compat check → start → `/health` check → smoke test. Downgrades follow Mattermost's pattern: the **newer binary** runs the rollback migration, then the operator swaps in the older binary. The app refuses to start if schema version exceeds the binary's expected version (the "newer-schema-older-binary" guardrail Mattermost documents verbally but doesn't enforce). Encryption is operator responsibility; CTRFHub documents exactly what's in a dump so operators can make informed choices.

**Why this matters:** prior planning said "back up `db_data` and `artifacts_data`" and stopped. Seven questions had no documented answer: what tools, in what order, service running or stopped, what doesn't restore cleanly, how to downgrade safely, what happens when schema and binary disagree, and what an operator must encrypt. Any one of these becomes a Sev-1 ticket on first operator distress. DD-026 fills all seven, with Mattermost's production-validated self-hosted backup patterns as the reference (standard-tools posture, stop-service for cleanliness, newer-binary-runs-rollback for downgrades, sequential version stepping post-v1). It also fills three gaps Mattermost leaves open: restore order, encryption posture, and startup version-mismatch guardrail.

#### Backup strategy: standard tools, documented recipes

Operators run pg_dump, sqlite3, tar, and rsync — tools they already know from the rest of their stack. The value CTRFHub adds is the **exact command for each deployment shape**, not a wrapper CLI that hides them. Wrapping happens in PL-016 once the lack of it demonstrably costs operators time.

Three deployment shapes → three recipes. Full shell in `docs/ops/backup-and-restore.md`; here's the essence.

**Recipe A — Postgres + local artifacts (common self-hosted case).**

```bash
# Cold / stop-service (cleanest)
docker compose stop api worker
docker compose exec -T db pg_dump -U ctrfhub -F c -Z 9 ctrfhub > backup/db-$(date +%Y%m%d).dump
tar -czf backup/artifacts-$(date +%Y%m%d).tar.gz \
  -C /var/lib/docker/volumes/ctrfhub_artifacts_data/_data .
docker compose start api worker
```

Hot variant (service running) is acceptable: `pg_dump` takes a consistent DB snapshot via a transaction; `rsync -a --delete` captures the artifact tree. Brief window between the two can produce orphans (file-with-no-row, row-with-no-file); DD-014's placeholder path and the retention sweeper handle both gracefully.

**Recipe B — Postgres + S3 (production case).**

```bash
docker compose exec -T db pg_dump -U ctrfhub -F c -Z 9 ctrfhub > backup/db-$(date +%Y%m%d).dump
# S3 durability (11 9s) + optional bucket versioning is the artifact-layer story.
aws s3api put-bucket-versioning --bucket $ARTIFACT_BUCKET \
  --versioning-configuration Status=Enabled
```

Stealing Mattermost's stance verbatim: *"If you store your files in S3, you can typically keep the files where they are located without backup."* No artifact tarball; S3's durability does the job.

**Recipe C — SQLite.**

```bash
docker compose stop api worker
docker compose exec -T api sqlite3 /var/lib/ctrfhub/ctrfhub.db \
  ".backup '/var/lib/ctrfhub/backup/db-$(date +%Y%m%d).db'"
tar -czf backup/artifacts-$(date +%Y%m%d).tar.gz \
  -C /var/lib/docker/volumes/ctrfhub_artifacts_data/_data .
docker compose start api worker
```

SQLite's `.backup` is safe with the service stopped; hot path exists but invites the well-known WAL-checkpoint interactions that aren't worth the 10 seconds of downtime saved.

#### Restore runbook (filling the order Mattermost leaves unspecified)

1. **Stop service.** `docker compose stop api worker`. Restoring into a live instance races every write path (ingest, webhook delivery, AI pipeline) and is never correct.
2. **Restore DB.** `pg_restore -U ctrfhub -d ctrfhub --clean --if-exists backup/db-YYYYMMDD.dump` (Postgres) or `cp backup/db-YYYYMMDD.db /var/lib/ctrfhub/ctrfhub.db` (SQLite).
3. **Restore artifacts.** `tar -xzf backup/artifacts-YYYYMMDD.tar.gz -C /var/lib/docker/volumes/ctrfhub_artifacts_data/_data/` (skip for Recipe B; S3 is untouched).
4. **Version-compatibility check.** `docker compose run --rm api node dist/cli migrate:status`. If schema version > binary's expected version, **stop here** and consult the downgrade procedure. Starting the service in this state is refused by the guardrail (below); checking first is cheaper than crashing first.
5. **Start service.** `docker compose up -d`. Binary > schema → MikroORM runs forward migrations at boot (during which `/health` returns 503 with `bootState=migrating`). Binary = schema → no-op startup. Binary < schema → **refuse to start**.
6. **Verify `/health`.** `curl localhost/health` → `{"status":"ok","bootState":"ready",…}`. If stuck at `migrating` beyond expected duration, `docker compose logs api` for the migration progress.
7. **Smoke test.** POST a small CTRF sample to `/api/v1/projects/<slug>/runs`; confirm the new run appears and artifact links resolve.

**Order rationale.** DB before artifacts, because if artifacts were restored first and the service started between step 3 and step 2 (operator mistake), the app's FK constraints would fire noisily — a loud-failure path is better than a silent corruption path. Mattermost elides this by always stopping service; we keep that and spell out the order anyway because operators read runbooks by skipping steps.

#### What doesn't restore cleanly

The catalogue Mattermost doesn't publish. None of these require operator intervention; all are accepted losses or self-healing.

| State | Behavior on restore | Action |
|---|---|---|
| Better Auth sessions | DB rows survive; browser cookies now reference sessions that are a backup old | Users re-login — treated as a feature |
| In-flight `ai_pipeline_log` rows (`running` status) | Heartbeat stale; DD-017's on-boot sweeper resets to `pending` and the idempotency guard (stage checks its primary output column) avoids double-LLM-billing | Self-healing; no double-charge |
| Webhook outbox entries past 6h TTL | Past last-attempt deadline; sweeper marks `failed` | Accepted loss; `X-CTRFHub-Delivery-Id` + receiver idempotency handle any replays |
| Rate-limit counters (in-process / Redis) | Rebuild on first-hit basis | Self-healing |
| SSE subscriber state (DD-011 EventBus) | Connections drop at restart; HTMX/Alpine client reconnects | Self-healing |
| Ephemeral Pino metric counters | In-memory counters zero; log-stream history intact | Accepted; operators querying logs still have history |
| `ingest_idempotency_keys` past TTL | Nightly TTL sweep clears stale rows | Self-healing |

The design invariant: any state whose correctness depends on "continuity with the previous process" is either persisted (via DD-017's reserve-execute-commit or DD-018's outbox) or accepted-lost. No restore scenario requires an operator to manually replay anything.

#### Version-mismatch policy (newer binary runs the rollback)

**Binary > schema (upgrade).** On startup, MikroORM `migrator.up()` runs from the persisted schema version to the binary's expected version. During migration `/health` returns `503` with `bootState=migrating` per the existing state machine. Override: `CTRFHUB_AUTO_MIGRATE=false` holds the app at `bootState=booting` with a message pointing operators at `node dist/cli migrate:up` — for operators who run migrations outside service boot (e.g. in Kubernetes init containers).

**Binary = schema.** No-op boot.

**Binary < schema (guardrail).** App refuses to start:

```
FATAL: schema version 127 is ahead of binary version 125.
This binary does not know about migrations applied by a newer version.
Running will silently ignore unknown columns and may lose data.

To downgrade: keep the newer binary mounted, run
  node dist/cli migrate:down --to 125
then swap in this older binary and start again.

See docs/ops/backup-and-restore.md#downgrade.
```

Process exits non-zero; `/health` is never served (the app hasn't finished booting). Mattermost documents this failure mode in prose (*"ensure that your plugins and integrations are compatible with the downgraded version"*) but does not enforce it at startup. CTRFHub enforces.

**Downgrade procedure (Mattermost pattern, verbatim).**

1. Stop the service on the newer binary.
2. Keep the newer binary's image / tarball on disk — it's the only thing that knows how to roll back its own migrations.
3. `node dist/cli migrate:check --to <target>` with the newer binary — prints the down migrations that will run. This is the `--dry-run` / save-plan equivalent (Mattermost stores this as a JSON plan file on disk; MikroORM stores it as committed `.down.ts` migration files in Git — same audit trail, different medium).
4. `node dist/cli migrate:down --to <target>` with the newer binary — executes the rollback.
5. Swap in the older image tag in `docker-compose.yml`.
6. `docker compose up -d`. Older binary now faces its expected schema version.

Mattermost's formulation: *"the newer Mattermost binary contains the downgrade SQL for the migrations to be rolled back. The newer binary version is used to perform the downgrade; then you start using the application binary of the version you want to downgrade to."* CTRFHub inherits this whole-cloth via MikroORM's up/down pairs.

**Version-skipping policy.** Pre-v1 (MVP): any-to-any, no formalized stepping. Post-v1: upgrades step through Extended Support Releases — the `migrate:check` CLI refuses to apply migrations that span more than one ESR. This matches Mattermost's ESR model. The ESR cadence (quarterly) and identification are deferred until a real release cadence exists; MVP has no policy to enforce because there is no v0.9 to leapfrog.

#### Encryption-at-rest (the gap Mattermost doesn't address)

Backups produced by the documented recipes are **plaintext**. Operators are responsible for encrypting before off-box storage.

**What's in a CTRFHub dump** (read this before choosing an encryption posture):

- **User PII** — email addresses and display names (Better Auth `users`).
- **Org/project names** — usually non-sensitive; check naming conventions.
- **Test names, failure messages, and stack traces** (`test_results.error_message`, `test_results.stack_trace`). **⚠️ Stack traces are the highest-risk field** — they commonly include file paths, hostnames, and occasionally leaked env-var values via stack frames (secrets logged into exceptions). Treat every dump as if it contains secrets.
- **Webhook URLs** (`project_webhooks.url`) — secret-bearing when they embed tokens (Slack incoming webhooks, PagerDuty integration URLs, Discord webhooks).
- **Hashed passwords** (Better Auth bcrypt) — not plaintext, but a stolen dump is an offline brute-force target.
- **Hashed API tokens** (`project_tokens.hash`) — same posture.
- **TOTP secrets** if PL-010 promotes — Better Auth stores these encrypted with an AES key supplied via env var; if the `.env` file sits alongside the dump, the encryption is defeated.
- **AI API keys** (`ai_provider_credentials` per DD-016) — encrypted at rest when `AI_ENCRYPTION_KEY` is set; plaintext without it.
- **Raw CTRF JSON** (`test_runs.raw_ctrf`, `test_results.raw_extra`) — reporter-specific; may contain env dumps, framework config, file paths.

**Recommended operator posture.**

- Encrypt tarballs with `gpg --encrypt --recipient <key>` (or `age`) before off-box storage.
- Use SSE-KMS on S3 backup buckets; use encrypted block volumes on self-managed backup servers.
- **Never** archive `.env` in the same bundle as the DB dump. Different trust paths for data vs. secrets so a compromised backup store doesn't also leak the key that encrypts the backup.
- Rotate encryption keys per the organization's policy.

CTRFHub does not bundle encryption into the backup flow. Operators already have a security posture (gpg/age/SSE-KMS/encrypted volumes); duplicating or forcing it would replicate existing tooling badly.

#### Non-goals

- **Bespoke `ctrfhub backup` / `ctrfhub restore` CLI in MVP.** Deferred to PL-016.
- **Point-in-time recovery / WAL archiving.** Operators who need PITR run Postgres replication and WAL shipping through standard ops tooling (pgBackRest, Barman, AWS RDS PITR). CTRFHub doesn't prescribe.
- **Encrypted-backup-by-default.** Operator responsibility per above.
- **Backup verification / restore drills as a product feature.** Recommended operator practice; not in-product.
- **Cross-major downgrade (post-v1).** Forbidden — one ESR step at a time.
- **Cross-dialect restore** (SQLite backup → Postgres restore, or vice versa). Separate migration path already documented in `deployment-architecture.md`.
- **Automatic backup scheduling.** Operators use cron / systemd timers / Kubernetes CronJobs.
- **Incremental backups.** MVP takes full snapshots; incrementals imply WAL and move toward PITR's complexity envelope.

#### Cross-references

- DD-014 — Artifact storage backend (local vs S3) selects Recipe A vs B.
- DD-017 — AI pipeline restart recovery: in-flight stage rows self-heal on restore.
- DD-018 — Webhook outbox: past-TTL entries drop; receiver idempotency via `X-CTRFHub-Delivery-Id` tolerates any replay.
- DD-023 — Project delete already exercises a subset of FK cascade paths; the delete runbook and restore runbook share engineering.
- DD-024 — API versioning: v1 URL contract is independent of DB schema version. An older binary facing a newer schema fails at startup (guardrail), never at runtime (data loss).
- Deployment architecture — `db_data` and `artifacts_data` volume targets; `DATABASE_URL` / SQLite path config.
- `docs/ops/backup-and-restore.md` — operator runbook with exact commands.
- PL-016 — bespoke backup/restore CLI (deferred).

---

### DD-027 — Previously-undefined tables: full schemas for `user_notification_preferences`, `sso_configurations`, `org_integrations`, `audit_logs`, `licenses`; patched `project_custom_field_settings`; Better Auth ownership note at §4 header

**Decision**

Define the five tables referenced in `settings-architecture.md` but missing from §4: `user_notification_preferences`, `sso_configurations` (Business), `org_integrations`, `audit_logs` (Business), and `licenses` (Business). Patch `project_custom_field_settings` (§4.19) to add the timestamp pair and the `UNIQUE (project_id, field_id)` constraint that every other junction table in the schema already has. Add a Better Auth ownership note at the top of §4 so the reader knows why `users`, `sessions`, `accounts`, `apiKey`, `organization`, `member`, and `verification` are absent by design.

Tables deferred from this pass — `groups`, `group_members`, `group_project_access`, `role_definitions`, `role_permissions` (all Business) and `user_slack_identities` (PL-009) — are not referenced by any MVP-path code and belong to feature work that hasn't started.

**Why**

Three distinct gaps had accumulated in §4:

1. **MVP-path references with no schema.** `user_notification_preferences` is the read/write target of the settings page (settings-architecture.md §2.2) and the gating check inside the webhook dispatcher. Shipping §4.21 (`project_webhooks`) and §4.22 (`webhook_deliveries`) without defining the preference lookup they depend on left a structural hole that MikroORM would have discovered the morning implementation started. Same story for `org_integrations`: Slack/Mattermost webhook URLs need a home that isn't `project_webhooks`, because those are project-scoped URL-per-webhook rows and a Slack OAuth token is org-scoped.

2. **Business Edition tables that gate MVP-path code.** `licenses` is loaded on startup to decide whether Business-only features are active (seat caps enforced in member-add; `ENGINE_EDITION` badge on the dashboard). `audit_logs` is written from retention changes (§4.1 `retention_days` setting), SSO config updates, and license uploads — all of which live in MVP-adjacent admin flows. Defining the tables now (even if Community installs leave them empty) lets the edition-upgrade path be a config flip, not a migration.

3. **A constraint-level inconsistency.** §4.19 `project_custom_field_settings` has the shape of a junction table (project × field × toggle) but lacked `UNIQUE (project_id, field_id)` and the `created_at`/`updated_at` pair that every other CTRFHub-owned table carries. That's the kind of gap that surfaces at 2 a.m. when the settings UI double-POSTs under a flaky connection and two rows for the same (project, field) appear.

**Scope of this decision**

What DD-027 adds to §4:

| § | Table | Edition | Primary constraint |
|---|---|---|---|
| 4.24 | `user_notification_preferences` | Community | `UNIQUE (user_id, event_type, channel)` |
| 4.25 | `sso_configurations` | Business | `UNIQUE (org_id)` |
| 4.26 | `org_integrations` | Community | `UNIQUE (org_id, integration_type)` |
| 4.27 | `audit_logs` | Business | append-only, org-scoped |
| 4.28 | `licenses` | Business | `UNIQUE (org_id)` |

What DD-027 changes in §4:

- **§4.19** `project_custom_field_settings` — adds `created_at`, `updated_at`, and `UNIQUE (project_id, field_id)`.
- **§4 header** — adds the Better Auth ownership note listing `users`, `sessions`, `accounts`, `apiKey`, `organization`, `member`, `verification` as externally-managed so readers stop searching §4 for them.

What DD-027 defers:

- **Per-user Slack DM identities** (`user_slack_identities`) → **PL-009** (personal Slack connections). DD-018 already scoped Slack out of MVP webhook destinations; a per-user OAuth mapping is a dependency of that future work and its schema stays in the parking lot until the feature is staffed. PL-009 carries the schema sketch so promotion starts with a concrete shape.
- **Group-based project access** (`groups`, `group_members`, `group_project_access`) — Business Edition, no MVP references. Defining them now would invite premature column decisions (hierarchy? nested groups?) that we should make at feature-scoping time.
- **Custom role definitions** (`role_definitions`, `role_permissions`) — Business Edition. The MVP permission model is the fixed five-role enum on `organization_members`; custom roles are a deliberate later-phase expansion.

**Encryption**

Three of the new tables store credential material in JSONB:

- `sso_configurations.config` — IdP client secrets, SAML signing keys
- `org_integrations.config` — Slack OAuth tokens, Jira API credentials
- `licenses.license_key` — the opaque signed blob (not a secret per se, but should not leak via logs)

All three follow the **AI_ENCRYPTION_KEY pattern from DD-016**: the application encrypts secret fields at write-time using a Fernet-like AES-256-GCM wrapper keyed on `APP_ENCRYPTION_KEY` (generalised from `AI_ENCRYPTION_KEY` — one key, both purposes). The database stores ciphertext. A `pg_dump` without the key yields rows that can be restored but whose credential fields are useless — the "encryption as operator responsibility" posture already established in DD-026.

**Additive enum strategy**

`event_type`, `channel`, `provider`, `integration_type`, and `tier` are all ENUMs. The intent is that every one of them expands additively — adding `slack_dm` to `channel`, `enterprise_esr` to `tier`, `gitlab_issues` to `integration_type` is a migration that adds an enum value, never removes one. Readers should not assume the enum set is exhaustive; assume it's the MVP+next-quarter set.

**Alternatives considered, rejected**

- **JSONB `preferences` column on `users`.** Tempting for the notification prefs case. Rejected because (1) per-event analytics become JSONB introspection instead of a clean GROUP BY, (2) adding a channel becomes a JSONB-shape migration across every user row, and (3) the settings UI naturally maps to an UPSERT per (event, channel), not a JSONB patch.
- **One generic `integrations` table for both project-level webhooks and org-level OAuth.** Rejected because the two have different cardinality (1-project : N-webhooks vs. 1-org : 1-workspace) and different delete semantics (webhook delete is cheap; OAuth revocation is a round-trip to the provider). Conflating them would push conditional columns into the table and complicate the dispatcher's indexing.
- **Defer all Business tables to the edition-upgrade migration.** Rejected because `licenses` has to exist on Community installs (empty) for the runtime license check to be a SELECT instead of a `SHOW TABLES` + SELECT. Same argument for `audit_logs` once any MVP admin action needs to write to it (retention changes, first and foremost).

**Touches**

- `database-design.md` §4.19 patched; §4.24-4.28 added; §5 indexes extended; §4 header note added.
- `settings-architecture.md` — §2.3 (notifications) and §2.4 (SSO) cross-references updated to point at the new §§; Business deferral notes preserved.
- `parking-lot.md` PL-009 — `user_slack_identities` schema sketch added for promotion-day starting point.

**See also**

- DD-001 — Better Auth owns the authentication tables; DD-027's §4 header note just makes that visible to the schema reader.
- DD-016 — `AI_ENCRYPTION_KEY` pattern generalised to `APP_ENCRYPTION_KEY` for all encrypted JSONB in §§4.25, 4.26.
- DD-017 — `config JSONB` + encrypted-secrets pattern first landed for AI provider credentials; reused here for SSO, integrations, licenses.
- DD-018 — Webhook outbox depends on `user_notification_preferences` as the gating check for notifications to users (§4.24); DD-018 ships the webhook schema, DD-027 supplies the preference schema it reads from.
- DD-026 — Encryption as operator responsibility; this decision adds the tables that now have encrypted columns to defend at rest.
- settings-architecture.md §2.3, §2.4, §2.5 — admin-UI flows that read/write these tables.
- PL-009 — Personal Slack DM, carries the `user_slack_identities` schema sketch.

---

### DD-028 — Artifact XSS hardening: drop `allow-same-origin` from report sandbox, attachment-by-default for active types, magic-bytes validation, per-response isolation headers, optional separate artifact origin

**Decision**

Treat every uploaded artifact as adversarial content and serve it accordingly. Six defence-in-depth layers (I1–I7 below), applied in order so that any one alone would block the realistic exploit path. Default configuration serves artifacts from the CTRFHub origin with full I3–I7 in effect; operators who want GitHub-grade isolation can opt into a separate artifact origin via `ARTIFACT_PUBLIC_URL` (I2) and pick up the remaining cookie-jar separation for free.

**Why**

Two pre-existing design choices put session cookies at risk. `architecture.md` explicitly specified `sandbox="allow-scripts allow-same-origin"` on the Playwright HTML report iframe served from `/runs/:id/report/`. That token combination is a known no-op: when the iframe's src is same-origin with its parent, a script inside the iframe can force-reload the page without the sandbox attribute and gain full access to the parent origin's cookie jar and API surface. Any malicious Playwright reporter — or any compromised CI pipeline with an ingest token — could have injected `<script>fetch('/api/v1/admin/users', { credentials: 'include' })…</script>` into a report and exfiltrated the admin session the next time an admin opened the failing run. `database-design.md`'s "Single-file `text/html` attachments are served in a sandboxed `<iframe>`" was similarly unspecified. Both are fixed here. Nothing else in the stack prevented this before DD-028.

Three latent issues also exist and are addressed in the same pass: no file-signature validation on upload (claimed `image/png`, actually HTML with polyglot magic bytes, sniffed and rendered by some browsers); no documented `Content-Disposition` policy for active types (HTML/SVG/XML/PDF relied solely on correct `Content-Type` plus sandbox — brittle); and the main app lacked COOP, so a new-tab-opened artifact could reach back via `window.opener` even when its own sandbox was tight.

Adversary model is unchanged from the MVP threat model: an attacker with a valid project ingest token (legitimate CI author turned malicious, compromised CI pipeline, typo-squatted reporter dependency). The goal is to keep "attacker controls artifact content" from escalating to "attacker reads CTRFHub session cookies of any admin who views the run".

---

**I1 — Drop `allow-same-origin` from the report iframe sandbox**

New directive, used on both the Playwright HTML report iframe (`/runs/:id/report/`) and single-file `text/html` attachment iframes:

```
sandbox="allow-scripts allow-forms allow-popups"
```

`allow-scripts` stays because Playwright HTML reports have interactive navigation (clickable test-case rows, filter chips, timeline scrubber) that requires JS. `allow-forms` covers any filter/search input inside the report. `allow-popups` preserves the "open this trace in a new tab" pattern some reports use. `allow-same-origin` is the one we drop: the iframe now runs in an opaque origin, so `document.cookie` returns empty, `fetch('/api/v1/…')` is cross-origin and won't send the CTRFHub session cookie, and `localStorage`/`IndexedDB` access is scoped to the opaque origin and cleared when the iframe unloads. Playwright HTML reports are read-only forensic artefacts — no functionality is lost because they don't persist state.

**I2 — Optional separate artifact origin via `ARTIFACT_PUBLIC_URL`**

New env var. When set (e.g. `ARTIFACT_PUBLIC_URL=https://artifacts.ctrfhub.example.com`), the app rewrites all rendered artifact URLs (inline `<img>`, `<video>`, `<a href>`, and the report iframe `src`) to point at that origin. Operator configures their reverse proxy (nginx, Caddy, Cloudflare, Traefik) to route the subdomain at `/api/files/*` and `/runs/*/report/` back to the CTRFHub backend. Session cookies are scoped to the main origin (not the subdomain) by Better Auth's default `SameSite=Lax` + explicit domain — an XSS in artifact content on the artifacts origin cannot read the session cookie even if I1 were bypassed.

When unset (default), artifacts serve from the main CTRFHub origin with I3–I7 as the defence. Document a minimal nginx + Caddy snippet in a new `docs/ops/artifact-origin.md`. No schema impact; pure config.

**I3 — `Content-Disposition: attachment` by default; narrow inline-safe whitelist**

Inline-safe MIME types (served with `Content-Disposition: inline`):

| Type pattern | Rationale |
|---|---|
| `image/png`, `image/jpeg`, `image/webp`, `image/gif` | Raster images; no active content |
| `video/mp4`, `video/webm` | Playwright recordings |
| `audio/mpeg`, `audio/ogg` | Rare but supported by the `<audio>` tag |
| `text/plain ≤ 500 KB` | Log preview; browsers render as plain text not HTML |

Everything else — including explicit enumeration of the active-content offenders — is served with `Content-Disposition: attachment; filename*=UTF-8''<sanitised>`:

| Type | Note |
|---|---|
| `text/html`, `application/xhtml+xml` | Browser would render as active content; forced download |
| `image/svg+xml` | SVG can contain `<script>`; even with CSP the safest answer is "never inline" |
| `application/xml`, `text/xml` | Some browsers render XSLT; forced download |
| `application/pdf` | Some PDF viewers run JS; forced download (user opens in their own viewer) |
| `application/zip`, `application/x-tar`, `application/gzip` | Archives — no render value |
| `application/octet-stream`, unrecognised, missing | Forced download |

The HTML report bundle at `/runs/:id/report/` is the explicit exception: served inline into the I1-sandboxed iframe because that's its whole point, but with I6 headers (CSP `sandbox` directive + CORP) as defence-in-depth. Trace zips fetched by the Playwright Trace Viewer are served with CORS headers per DD-014 and are read as zip bytes by the viewer's JS — not interpreted as HTML — so no XSS surface.

**I4 — Upload-time magic-bytes validation against claimed `Content-Type`**

Every multipart part runs through a `file-type`-style sniffer reading the first 4 KB:

- **Match** → store the validated type in `test_artifacts.content_type`, set `content_type_verified=TRUE`, proceed.
- **Mismatch** → reject the whole request with `415 Unsupported Media Type`, structured error listing the claimed type and detected type, log `event=ingest.content_type_mismatch` with `project_id`, `token_id`, `claimed_type`, `detected_type`. Blocks the "file claims PNG but is HTML" polyglot attack without having to enumerate polyglot patterns.
- **Text files** (`text/plain`, `text/csv`, `text/markdown` — no distinctive magic bytes) validated by (a) UTF-8 decodability of the first 4 KB and (b) absence of `<html` or `<script` tokens anywhere in that window. Case-insensitive, byte-level check — not a parser.

Back-compat: rows predating I4 default `content_type_verified=FALSE` so a forensic audit can distinguish validated-from-the-start artifacts from ones imported during a restore.

**I5 — Filename sanitisation for `Content-Disposition`**

The `filename` token in `Content-Disposition` comes from CTRF `attachment.path` or the multipart part's own `filename=`. Both are attacker-controlled. Rules:

- Emit in RFC 5987 `filename*=UTF-8''<pct-encoded>` form. Some browsers still read the legacy `filename="…"` token — emit both; the legacy form is ASCII-only, punctuation stripped, non-ASCII replaced with `_`.
- Strip `\r`, `\n`, `\0` before encoding. Header-split attacks are the payoff here — CR/LF in any header field can inject a second header or a fake response body.
- Length-cap at 200 characters after encoding. Fastify's default header budget is 8 KB and we want headroom for Set-Cookie, CSP, CORP, Referrer-Policy, and the half-dozen other headers on an artifact response.
- Storage-side key is a UUID — the sanitised filename is display-only and never used to locate the file on disk or in S3.

**I6 — Per-response origin-isolation headers on artifact routes**

Applied to `/api/files/*` and `/runs/:id/report/*`:

| Header | Value | Purpose |
|---|---|---|
| `X-Content-Type-Options` | `nosniff` | Stops browser MIME-sniffing; the server's `Content-Type` is authoritative |
| `Cross-Origin-Resource-Policy` | `same-site` (default) or `cross-origin` (when `ARTIFACT_PUBLIC_URL` is set) | Stops other sites loading artifacts via `<img>`/`<script>`/`<iframe>` as a pivot |
| `Referrer-Policy` | `no-referrer` | Prevents leaking CTRFHub URL structure to anything the artifact embeds |
| `Content-Security-Policy` | `sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:` | **Only on HTML artifact responses** — belt-and-braces to the I1 iframe sandbox. The `sandbox` directive alone makes the browser treat the response as a sandboxed document even if the outer iframe attribute was stripped. `default-src 'none'` disables JS `fetch`, WebSocket, etc. within the artifact |
| `Cache-Control` | `private, max-age=300, immutable` on `/api/files/*`; `no-store` on `/runs/:id/report/` index | Stale caches can't serve pre-XSS content after a report is replaced |

The existing DD-014 CORS headers (`Access-Control-Allow-Origin: trace.playwright.dev`, etc.) are compatible with I6 — they're additive, not contradictory. `Access-Control-Allow-Credentials` remains **unset** so cross-origin fetches from the trace viewer are uncredentialled (the trace viewer doesn't send cookies anyway).

**I7 — Main-app hardening: COOP + `rel="noopener noreferrer"`**

Two additions to `@fastify/helmet` config for main-app responses (not artifact responses):

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: unsafe-none    # unchanged; see note below
```

COOP `same-origin` severs the `window.opener` reference when a user opens an artifact in a new tab — even if I1 were somehow bypassed, the artifact tab cannot reach back into the CTRFHub tab via `window.opener.location = 'https://evil.com'` phishing or via `window.opener.postMessage`. COEP is **not** tightened to `require-corp` in MVP because that would break Playwright trace viewer embedding (third-party origin) and external video embeds (Loom, YouTube); can revisit if and when everything CTRFHub embeds ships COEP-compatible resources.

Every link or `window.open` call that opens an artifact in a new tab uses `rel="noopener noreferrer"`. The Eta/HTMX templates for "Open HTML report", "Open in Trace Viewer", and external video links all emit this attribute. When the main app itself calls `window.open`, the features argument includes `'noopener,noreferrer'`. Defence-in-depth with COOP — browsers ignoring COOP still get the link-level protection, browsers ignoring the link-level attribute still get COOP.

---

**Threat-model summary**

| Attack | Blocked by |
|---|---|
| Malicious Playwright reporter injects `<script>` into HTML report, steals admin cookies via `document.cookie` | I1 (opaque origin) |
| Report injects `<script>fetch('/api/v1/…', { credentials: 'include' })` | I1 (cross-origin request, no cookies sent) + I7 (no `window.opener` callback channel) |
| Upload claims `image/png`, is actually HTML with PNG magic-bytes prefix (polyglot) | I4 (byte-level sniff of first 4 KB) |
| Upload is SVG with embedded `<script>` | I3 (forced download; never rendered inline) |
| Upload is PDF with JS action | I3 (forced download) |
| CR/LF injected into filename to inject a second response header | I5 (`\r\n\0` stripped before encoding) |
| Artifact page opened in new tab navigates opener to phishing URL | I7 (COOP + `rel="noopener noreferrer"`) |
| External site embeds artifact via `<img>` to fingerprint authed users | I6 (`Cross-Origin-Resource-Policy: same-site`) |
| Reverse-proxy-layer cache serves pre-replacement artifact to admin | I6 (`Cache-Control: private, max-age=300` with version-pinned storage keys — replacement changes the key, not the URL) |

**What's out of scope**

- **Malware scanning** of uploaded artifacts (ClamAV sidecar + `scripts/scan-artifacts.sh` cron). Useful in regulated industries but not MVP. → **PL-017**.
- **HTML sanitisation / content rewriting** via DOMPurify or similar. I1's opaque-origin sandbox makes this unnecessary for the CTRFHub-origin threat model. Operators who want belt-and-braces content sanitisation can add it. → **PL-018**.
- **Per-artifact encryption-at-rest with viewer-side key.** Sometimes requested for CI secrets in failing test output; genuinely off the XSS axis. Deferred without a PL entry until the request arrives.
- **COEP `require-corp`** on main-app responses. Would break Playwright trace viewer embedding and external video embeds. Revisit when those ship COEP-compatible resources.

**Alternatives considered, rejected**

- **Keep `allow-same-origin`, rely on CSP.** CSP on the iframe document alone doesn't stop a `window.parent.document.cookie` read when the iframe is same-origin. The sandbox attribute is the actual same-origin control; CSP complements it but can't replace it.
- **Serve only with `Content-Disposition: attachment`, never inline anything.** Would break the dashboard's inline screenshot thumbnails — a big UX regression to prevent a threat the inline-safe allowlist (I3) already handles.
- **DOMPurify pass on every uploaded HTML.** Adds a parser dependency to the ingest hot path, still has to be paranoid about mutation-XSS payloads, and the opaque-origin sandbox (I1) makes it unnecessary. Kept as PL-018 for operators who want the extra layer.
- **Enforce `ARTIFACT_PUBLIC_URL` as mandatory.** Makes a solo-dev laptop `docker compose up` require reverse-proxy setup before artifacts render correctly. Too much friction for MVP. Same-origin + I3–I7 is the tested default; separate-origin is the opt-in upgrade.
- **Sign artifact URLs with per-user tokens.** Useful for access-control isolation (prevents URL sharing outside the org) but doesn't address XSS — a signed URL still executes scripts in the viewer's origin. Orthogonal concern; not pursued.

**Schema impact**

One additive column: `test_artifacts.content_type_verified BOOLEAN NOT NULL DEFAULT TRUE` (added to §4.6). No new tables, no new indexes. The default is `TRUE` because every MVP write goes through I4; rows imported via DD-026 restore or a future import path may set `FALSE` explicitly.

**Files touched**

- `database-design.md` — this DD; §4.6 column addition; sandbox paragraph in DD-014 rewritten to reflect I1 + I6.
- `architecture.md` — CSP section extended with the artifact-response CSP and the iframe sandbox change; artifact-route rate-limit section extended with I6 headers; helmet config gains COOP per I7.
- `deployment-architecture.md` — `ARTIFACT_PUBLIC_URL` env var.
- `product.md` — one-line artifact-security posture under Non-Functional Requirements.
- `parking-lot.md` — PL-017 (ClamAV), PL-018 (DOMPurify).
- `docs/ops/artifact-origin.md` — new runbook for the separate-origin deployment, with nginx + Caddy snippets.

**See also**

- DD-001 — Better Auth session cookie scoping is what the I2 separate-origin approach leverages for free.
- DD-014 — Artifact storage interface and CORS for the Playwright Trace Viewer; this DD adds the I6 headers alongside the existing CORS set.
- DD-016 — `APP_ENCRYPTION_KEY` (generalised from `AI_ENCRYPTION_KEY`) protects secrets *in* artifacts at rest on disk, orthogonal to the browser-side XSS concerns addressed here.
- DD-018 — Webhook payload version is part of the API v1 contract, a separate surface from artifact content.
- DD-024 — API versioning contract defines `/api/v1/…`; artifact URLs are explicitly scoped under `/api/files/*` and `/runs/:id/report/` which are in the v1 surface for routing but carry their own content-security contract per this DD.
- DD-026 — Backup restore preserves `content_type_verified` values; a restore that drops the column would mislabel old rows. The DD-026 restore runbook notes verification columns must restore cleanly.
- PL-017 — ClamAV sidecar (parking lot).
- PL-018 — DOMPurify HTML sanitisation (parking lot).

---

### DD-029 — Rate-limit decisions are consolidated into DD-012's Layer 2 table as the single canonical source

**Decision:** Every application-layer rate limit lives in exactly one place — DD-012's Layer 2 table. Future DDs that introduce a new rate-limited route add a row to that table and reference it from their own prose; they do **not** restate the numeric limit, the key, the backend, or the response shape. This DD records the consolidation and spells out the supporting subsections (response contract, enumeration-safety rule, `keyGenerator` pattern, observability) that were previously scattered across DD-018, DD-019, DD-021, DD-022, DD-023, and `architecture.md`.

**Context — the problem this fixes.** Between first draft of DD-012 and this review, seven downstream DDs added their own rate-limit paragraphs, each in a slightly different shape. DD-018 invented a webhook-dispatcher limit (1/sec/URL) with no row in DD-012. DD-019 described the idempotency-replay interaction with the limit but didn't surface the interaction back in DD-012. DD-021 documented enumeration-safety for password reset but didn't generalise it. DD-022 inherited the pattern implicitly. `architecture.md` carried the artifact-serving limit (300/min/user) as a one-line mention in the tech-stack row and a standalone section, neither of which pointed at DD-012. The Layer 2 table itself had no column for the key, no column for the storage backend, and no response-shape contract. An operator wanting to reason about the full rate-limit posture had to grep across six files, reconcile near-duplicates, and trust that the numbers in different places still matched.

**What DD-029 changes.**

1. **The Layer 2 table is canonical.** It gains two columns — **Key** (what the limit is keyed on: IP / session-user-id / email / project-token-id / admin-user-id / destination URL / combinations) and **Backend** (`@fastify/rate-limit` default store vs. in-proc LRU vs. Layer-3 counter). The Key column makes the attacker-controllability invariant auditable at a glance; the Backend column makes the in-process-vs-shared storage posture explicit.
2. **Three previously-missing rows are added.** Artifact serving (300 req/min per session-user-id; local-disk only — S3 pre-signed URLs are self-limiting and need no app-layer row). Webhook dispatcher outbound (1 delivery/sec per destination URL; in-proc LRU in the dispatcher). The ingest row's prose is extended to note that idempotent replays (DD-019) count against the limit before the dedup lookup runs.
3. **Two deferred rows are surfaced.** TOTP verify (PL-010) and admin invites (PL-011) get placeholder rows in the table flagged "Deferred." Keeping them visible prevents the same scattering problem when those features land.
4. **429 response shape is spelled out once.** RFC 9728 draft `RateLimit-Limit` / `RateLimit-Remaining` / `RateLimit-Reset` on every 429, with `Retry-After` for older-client compatibility. `/api/v1/*` gets a JSON body (`{"error": "rate_limited", "code": "too_many_requests", "retry_after_s": <int>}`); `/hx/*` gets an empty body and an `HX-Trigger: rate-limited` header for Alpine toast rendering. The non-standard `X-RateLimit-*` header variant is deliberately not emitted.
5. **Enumeration-safety is a named rule, not an ad-hoc pattern.** Any route keyed on attacker-controlled input (email, invite-email, username) must return the happy-path response on rate-limit exceeded — never `429`. Counter increments regardless. DD-021 stays the reference implementation; DD-022 inherits explicitly; any future account-recovery route falls under this rule by default without a new decision.
6. **The `keyGenerator` pattern for per-token ingest is documented.** Six-line code sketch in DD-012 showing how `@fastify/rate-limit` reads `project_tokens.rate_limit_per_hour` via a custom `keyGenerator` + dynamic `max` + `skip` hook for the `0 = unlimited` branch.
7. **Observability contract.** Every 429 emits a Pino structured-log line `event=ratelimit.exceeded` with the rate-limit key hashed (first 8 hex chars of SHA-256) so repeat-offender patterns are visible without writing emails/IPs/token-IDs verbatim. A parallel counter `ctrfhub_ratelimit_exceeded_total{endpoint,backend}` is incremented for Prometheus scraping. This closes the previously hand-wavy "rate-limit violations are logged" line in the product.md Security NFR.

**Alternatives considered, rejected.**

- **Leave each DD with its own rate-limit paragraph.** That was the status quo. Reviewers couldn't diff the total posture; operators had no single page to hand to a compliance reviewer. Consolidation wins on both counts.
- **Emit both `X-RateLimit-*` and `RateLimit-*` headers for broad client compatibility.** CTRFHub's consumers (UI, first-party CI reporters, Slack webhook receiver) are all under our control. No legacy consumer exists to benefit from the non-standard header; emitting two header families doubles the surface a misconfigured reverse-proxy header filter can corrupt.
- **Require every rate-limit row to use `@fastify/rate-limit`'s default store.** Would force the password-reset + email-verification routes through a library path optimised for high-volume endpoints, when what those routes actually need is an explicit LRU with a hand-rolled enumeration-safety branch. The mixed-backend posture is intentional.
- **Put the response-shape contract in `architecture.md` instead of here.** Architecture.md describes the stack; DD-012 owns the resource-limits decision. The contract belongs with the decision. `architecture.md` gets a one-line cross-reference instead of a duplicated section.
- **Redis-backed shared counters on all rows now.** Overkill for MVP's single-node target. The Backend column notes that Redis is the scale-out path for library-backed rows when `EVENT_BUS=redis` is set; in-proc LRU rows stay per-process because their volume is too low for cross-node coordination to matter. A future multi-node deployment that hits a real problem with per-process LRU counters is the trigger; no schema change required.

**Schema impact.** None. `project_tokens.rate_limit_per_hour` already exists (§4 on project_tokens). No new columns, no migration, no index changes.

**Files touched.**

- `database-design.md` — this DD; DD-012 Layer 2 table rewritten with Key + Backend columns and the three missing rows; four new subsections added under Layer 2 (429 response contract, enumeration-safety rule, `keyGenerator` pattern, observability); DD-018's rate-limit paragraph shortened to a pointer; DD-019's rate-limiting-interaction subsection clarified to point at DD-012; DD-021, DD-022, DD-023 rate-limit sections replaced with cross-refs to DD-012's canonical rows.
- `architecture.md` — tech-stack row and artifact-serving section point at DD-012 for the numeric limit and response shape.
- `gap-review-solo-findings.md` — item J ticked off with this decision trail.

**See also.**

- DD-012 — the canonical Layer 2 table this DD consolidates into.
- DD-018 — webhook dispatcher; now sources its rate-limit row from DD-012.
- DD-019 — idempotency; replays count against DD-012's ingest row.
- DD-021, DD-022 — reference implementations of the enumeration-safety rule.
- DD-023 — project-delete row; sources from DD-012.
- DD-014, DD-028 — artifact serving; 300/min/user row sourced here, headers stay in architecture.md's artifact-route section.
- PL-010 — TOTP (deferred row in the table).
- PL-011 — admin invites (deferred row in the table).

---

### DD-030 — Viewport posture: desktop-only product, mobile-first authoring

**Decision:** CTRFHub is a desktop web application in MVP — design target 1280×800 CSS px and wider, no mobile QA, no mobile product story. But screen markup is authored **mobile-first**: base (unprefixed) Tailwind styles target narrow viewports, `md:` / `lg:` / `xl:` add desktop enhancements, Flowbite components keep their responsive defaults rather than being stripped down, and tables get an `overflow-x-auto` wrapper. The viewport meta tag pins mobile browsers to render the desktop layout at 1280 CSS px wide so a user opening the site on a phone sees the full desktop UI pinch-zoomable rather than a broken half-mobile intermediate. This is the posture most dev-tool web apps ship with in MVP (Datadog, Snyk, CircleCI, Buildkite, Sentry) — desktop workflow, phone-readable — and the mobile-first authoring keeps the cost of promoting to PL-019 ("desktop-primary, mobile-degraded-functional") down to QA commitment and polish rather than rewrite.

**Context — what silence meant, and why a posture decision is still required.** Nothing in the planning docs committed to a viewport target. Tailwind CSS 4 + Flowbite both ship responsive utilities by default, so the UI happens to render at 375 px by accident — navigation works, tables horizontal-scroll, buttons are clickable. But there was no spec to review mobile-regressions against, no test at any mobile viewport, and no answer to the operator question "can I triage from a phone?" Two failure modes were open: (1) the UI silently breaks on a narrow viewport in some future PR and nobody notices until a user complains; (2) UI reviewers pay ongoing tax enforcing a mobile story that the user base doesn't actually need, because nothing said "no, you don't have to." DD-030 closes both by declaring the commitment.

**The posture in one paragraph.** CTRFHub's markup contains exactly one viewport commitment: `<meta name="viewport" content="width=1280">`. Mobile Safari and Chrome render the desktop layout at 1280 CSS px wide and scale the rendered page to fit the phone's display. A user opening CTRFHub at 2 AM on their phone sees a readable, zoomable, fully functional desktop website — every run accessible, every failure expandable, every comment readable, every notification link followable — just tiny. Pinch-zoom works. This is the same experience a desktop-only web app gives on a phone today; nothing is broken, nothing is optimised. Developers who want to triage from a phone open the laptop instead.

**Two commitments held separately.** The product commitment and the authoring commitment are deliberately distinct, because conflating them is how teams end up paying mobile-design cost without getting a mobile product or — the inverse — paying rewrite cost later when a mobile product is requested:

- **Product commitment — desktop-only.** QA runs at 1280×800. No mobile flows are designed, no mobile stories are tested end-to-end, release notes never claim mobile parity. A user who opens CTRFHub on a phone is using it off-label; the experience is "readable desktop page at zoom," not "mobile app."
- **Authoring commitment — mobile-first.** The *way* markup and CSS are written assumes narrow viewports are the base case and desktop is progressive enhancement via `md:` / `lg:` / `xl:`. This is Tailwind's and Flowbite's default authoring style anyway, so we're choosing not to fight it. It costs nothing at authoring time and converts PL-019 promotion from a rewrite into a QA-and-polish exercise.

**What changes in the codebase.** Five concrete consequences:

1. **Tailwind responsive utilities are the authoring convention.** Base (unprefixed) styles target narrow viewports; `md:` / `lg:` / `xl:` prefixes add desktop enhancements. This matches Tailwind's documented mobile-first design and matches how Flowbite components ship. A screen that works at 1280 px with `md:` enhancements and degrades sensibly at 375 px is the target shape — even though we only QA the desktop case.

2. **Flowbite components render at their responsive defaults.** The Sidebar's drawer-collapse behaviour, Navbar's hamburger trigger, responsive table wrappers all remain in the component markup. We don't strip them out and we don't customise them to always-desktop. A component that collapses to a drawer below `md:` still collapses on a phone, even though we don't ship a product story around it — that's a feature of the authoring commitment, not a bug.

3. **Tables that exceed narrow viewports get an `overflow-x-auto` wrapper.** One authoring rule, applied consistently. The desktop-scale content scrolls horizontally on phones rather than overflowing the body or being truncated. Costs nothing; prevents the most common CSS drift when reviewing a component that looks fine at 1280.

4. **Playwright tests run a two-viewport matrix.** 1280×800 is primary — the full assertion suite runs there. 375×800 runs a narrow-viewport smoke test per screen with minimal assertions: page loads without a `console.error`, no unexpected horizontal overflow outside `.overflow-x-auto` containers, every link/button in the happy-path DOM is present. The narrow smoke is a regression guardrail against CSS drift (a `w-[1400px]` sneaking in) not a product commitment — failures block merge but they don't imply the screen has been *designed* for the narrow case.

5. **No mobile-specific product work.** No drawer-navigation story, no column-priority ladder for the Run Results table, no row-to-card transformation for lists, no 44×44 touch-target guardrail. Those are PL-019 work. The mobile-first authoring does not imply any of them; it only means the components we already use render acceptably narrow because they were written that way by their upstream authors.

**What survives from the accessibility axis.** WCAG 2.1 AA applies regardless of viewport posture, and specifically the 24×24 CSS px minimum interactive element target survives — but it's reframed as an accessibility concern (users with motor impairments, reduced mouse precision, hand tremor) not a mobile-touch concern. Flowbite's default button and link sizes already meet 24×24 (and often 44×44) so the commitment is a code-review guardrail against future tightening (`h-5 px-1` buttons, icon-only buttons with no padding), not a change to the component library. The Non-Functional Requirements Accessibility line in product.md remains unchanged.

**Alternatives considered, rejected.**

- **Desktop-primary, mobile-degraded-functional.** What I proposed first: committed drawer navigation, column-priority ladder for the Run Results table, horizontal-scroll rule for all other tables, touch-target guardrail, three-viewport Playwright smoke matrix. Rejected for MVP because the on-call-triage use case that justifies the design cost is speculative (no user has asked for it; no persona explicitly requires it); the ongoing UI-review tax is real and paid on every PR. **Recorded as PL-019** for promotion when the first concrete on-call user surfaces, a design review identifies a real user story we're leaving on the table, or a Business Edition customer asks during sales.
- **Strict desktop-only authoring (no mobile-first discipline).** Simpler version of the current decision: author every screen at 1280+ explicitly, strip responsive classes, render Flowbite components in desktop-always mode. Rejected because it makes PL-019 promotion a rewrite — every screen touched again, every component re-styled — instead of a QA and polish exercise. The mobile-first authoring discipline costs nothing at authoring time (Tailwind and Flowbite already work this way by default) and preserves the cheap promotion path.
- **Responsive-equal (fully mobile-first with committed mobile design).** Every screen designed mobile-first *with mobile as a committed product story* — full mobile QA, mobile-specific flows, feature parity promises. Realistically a week of design work per screen plus ongoing mobile QA cost. Appropriate for customer-facing or field-ops surfaces; inappropriate for a CI dashboard. Not proposed, noted here for completeness; the current decision is "mobile-first authoring, desktop-only product" which is strictly cheaper.
- **Omit the viewport meta tag entirely.** Mobile Safari defaults to a 980 CSS px wide "desktop" viewport without an explicit meta tag. Would render the page slightly more cramped than `width=1280` but the underlying commitment is identical. Chose `width=1280` because it pins the rendering explicitly, matches the design target from the first sentence of this DD, and makes the default visible in DOM inspection rather than relying on browser defaults that differ between Safari / Chrome / Firefox mobile.
- **User-agent detection + separate mobile templates.** A second Eta template tree for mobile viewports, route-level branching on UA. Explicitly rejected — doubles the maintenance burden, produces parallel codepaths that drift, and Flowbite is a responsive-utility library not a multi-template library. If mobile matters enough to warrant a separate template tree, the commitment being made is (B) or (C) not (A), and the maintenance cost is explicit not hidden.
- **Return `406 Not Acceptable` or a polite "open on desktop" page when UA looks mobile.** Rude. The actual UX contract is "it works on a phone, you'll pinch-zoom" and we should let users experience that rather than gatekeeping.

**Schema impact.** Zero. DD-030 is pure UI posture; no tables, no columns, no env vars. Nothing to migrate.

**Files touched.**

- `database-design.md` — this DD.
- `architecture.md` — new "Viewport posture — desktop-only product, mobile-first authoring" subsection at the end of the Frontend section, before the AI Features section; `architecture.md:91` ("Top bar: persistent search input on screens ≥ md breakpoint") rewritten to drop the breakpoint conditional (search is always visible under this posture).
- `product.md` — new "Viewport posture" subsection in Non-Functional Requirements, between Browser Support and Accessibility.
- `parking-lot.md` — PL-019 for promotion to mobile-degraded-functional, with scope shrunk to reflect that authoring is already mobile-first.
- `gap-review-solo-findings.md` — item K ticked off with this decision trail.
- `testing-strategy.md` — Playwright configuration needs a secondary 375×800 narrow-viewport smoke assertion (minimal: no `console.error`, no unexpected horizontal overflow) per screen. This is a regression guardrail, not a product commitment.

Deliberately not touched: `theme-design.md` (theme tokens are viewport-agnostic); per-screen entries in Community Screen Inventory (no mobile-specific screen variants exist, so nothing to strike through).

**See also.**

- PL-019 — promotion path to desktop-primary / mobile-degraded-functional.
- Product NFR Browser Support — latest two versions of Chrome / Firefox / Safari / Edge applies to desktop renders; mobile browsers inherit the commitment transitively because they render the desktop layout.
- Product NFR Accessibility — WCAG 2.1 AA applies regardless of viewport posture; the 24×24 minimum survives intact.
- DD-028 — iframe-sandboxed Playwright HTML reports render at their native sizing inside the iframe; the outer viewport commitment does not affect the inner iframe's behaviour.

---

## 11. CTRF Field Mapping

Reference for CI authors writing CTRF reporters (or custom adapters). Each CTRF field is either stored in a typed column, hashed into a derived column, routed into a child table, or retained as raw JSON.

CTRF spec reference: https://ctrf.io/docs/schema/overview. Mapping is as of CTRF 1.x; bump this section when CTRF publishes a new major version.

### Run-level fields — `results.tool`, `results.environment`, `results.summary`

| CTRF path | Target | Notes |
|---|---|---|
| `reportFormat` | — (validation only) | Must be `"CTRF"` or ingest returns 400 |
| `specVersion` | `test_runs.ctrf_spec_version` (VARCHAR(10)) | Stored for auditability; rejected if < 1.0.0 |
| `results.tool.name` | `test_runs.reporter` | Normalized lowercase (`playwright`, `cypress`, `pytest`, etc.) |
| `results.tool.version` | `test_runs.reporter_version` | Raw string |
| `results.environment.appName` | `test_runs.app_name` | |
| `results.environment.appVersion` | `test_runs.app_version` | |
| `results.environment.osPlatform` | `test_runs.os_platform` | |
| `results.environment.osRelease` | `test_runs.os_release` | |
| `results.environment.osVersion` | `test_runs.os_version` | |
| `results.environment.buildName` | `test_runs.build_name` | |
| `results.environment.buildNumber` | `test_runs.build_number` | |
| `results.environment.buildUrl` | `test_runs.build_url` | |
| `results.environment.repositoryName` | `test_runs.repository_name` | |
| `results.environment.repositoryUrl` | `test_runs.repository_url` | |
| `results.environment.commit` | `test_runs.commit_sha` | First 40 chars; indexed for search |
| `results.environment.branchName` | `test_runs.branch` | |
| `results.environment.testEnvironment` | `test_runs.environment` | e.g. `staging`, `prod` |
| `results.environment.extra` | `test_runs.env_extra` (JSONB) | Stored as-is; surfaced in the UI under "Environment > Custom fields" |
| `results.summary.start` | `test_runs.started_at` | Epoch ms → TIMESTAMPTZ |
| `results.summary.stop` | `test_runs.completed_at` | Epoch ms → TIMESTAMPTZ |
| `results.summary.tests` | `test_runs.total_tests` | Cross-checked against count of result rows; warn on mismatch |
| `results.summary.passed` / `failed` / `skipped` / `pending` | `test_runs.passed` / `failed` / `skipped` / `pending` | Cross-checked; ingest trusts the rollup from the reporter and re-verifies in §7 Option B on completion |
| `results.summary.other` | **See `other` status handling below** | Not stored as a dedicated counter; each `other` result is routed per the configured policy |
| `results.summary.extra` | `test_runs.summary_extra` (JSONB) | |
| `results.extra` | `test_runs.run_extra` (JSONB) | Catch-all for reporter-specific metadata |
| `milestone` (CTRFHub extension, not CTRF spec) | `test_runs.milestone_id` | Name/slug matched; auto-created if missing — see DD-002 |

### Per-test fields — `results.tests[]`

| CTRF path | Target | Notes |
|---|---|---|
| `name` | `test_results.test_name` | Truncated to 500 chars; longer names overflow into `test_results.name_extra` JSON field |
| `filePath` | `test_results.test_file` | |
| `suite` | `test_results.suite_path` | Slash-joined if CTRF emits an array |
| `status` | `test_results.status` | `passed \| failed \| skipped \| pending \| other` — see `other` handling below. CTRFHub adds `blocked` as a non-CTRF value written only by Business Edition / custom adapters (see §4.5). |
| `duration` | `test_results.duration_ms` | |
| `start` / `stop` | `test_results.started_at` / `completed_at` | Epoch ms; optional (CTRF often omits per-test timing) |
| `message` | `test_results.error_message` | |
| `trace` | `test_results.stack_trace` | |
| `line` | `test_results.error_line` (INT) | |
| `rawStatus` | `test_results.raw_status` (VARCHAR(50)) | Original framework status string preserved for forensic debugging |
| `tags` | `test_result_tags` (junction) | One row per tag; indexed for filter queries |
| `type` | `test_results.type` (VARCHAR(50)) | `unit \| integration \| e2e \| smoke \| other`; free-form but normalized |
| `retries` | `test_results.retry_count` | |
| `flaky` | `test_results.reporter_flaky` (BOOLEAN) | Reporter's own flakiness flag; separate from `flaky_score` (A8) |
| `browser`, `device` | `test_results.browser`, `test_results.device` | |
| `screenshot` (deprecated CTRF field — attachments preferred) | `test_artifacts` row with `artifact_type='screenshot'` | Legacy path; modern CTRF uses `attachments[]` |
| `attachments[]` | `test_artifacts` (one row per attachment) | See §4.6 and "Playwright artifact handling" |
| `steps[]` | `test_result_steps` (future — see §9 Future Considerations) | **MVP: retained inside `test_results.raw_ctrf` JSONB, not normalized.** Table lands when a user feature needs step-level querying. |
| `parameters` | `test_results.parameters` (JSONB) | |
| `extra` | `test_results.extra` (JSONB) | Catch-all for reporter-specific fields |

### Everything else

Any CTRF field not explicitly mapped above is retained under `test_runs.raw_ctrf` (JSONB, full payload) and `test_results.raw_extra` (JSONB, per-test extras). The raw columns are the **authoritative forensic source** — if the mapping loses fidelity, the raw JSON is always available for custom reporter authors to bounce against.

Raw columns are excluded from indexing and do not participate in search (see architecture.md → Global Search). Retention sweeps delete raw columns with the run.

### CTRF `other` status handling

`other` is a valid CTRF status per the spec ("a status that doesn't fit the passed/failed/skipped/pending buckets"). Stock CTRFHub treats `other` per the per-org `ctrf_other_policy` setting (`organizations.settings.ctrf_other_policy`):

| Policy value | Behavior |
|---|---|
| `skipped` (default) | `other` results are stored with `status='skipped'` and `raw_status='other'` preserved. Rollup counts them under Skipped. |
| `blocked` | `other` results are stored with `status='blocked'`. Rollup counts them under Blocked. Useful for teams whose pipelines use `other` to signal "couldn't run" upstream blocks. |
| `distinct` | `other` results are stored with `status='other'` (the ENUM includes `other`). A new counter `test_runs.other_count` and a distinct UI chip surface it. Cost: an additional ENUM value and UI treatment — opt-in. |

MVP ships `skipped` and `blocked` policies. `distinct` is a follow-up if user feedback requires it (the ENUM value and counter column can be added later as an additive migration without breaking existing rows). Selection is per-org in Org Settings → CTRF Ingest.

Writers emitting CTRF with `status='other'` for "block" semantics should set their org policy to `blocked` at onboarding.

### Versioning

When CTRF ships a major spec revision that renames or removes any of the fields in this table, CTRFHub adds a per-ingest translation layer keyed off `specVersion`. Adapters live in `server/src/services/ingest/ctrf-adapters/<version>.ts`. MVP ships a 1.x adapter only.