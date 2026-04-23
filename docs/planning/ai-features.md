# CTRFHub — AI Feature Strategy

CTRFHub's AI layer is a genuine differentiator, not a checkbox. No CTRF-native tool has AI. The closest competitor (Reporter Engine) has failure categorization but is stagnant and not CTRF-native. This document defines every AI feature, its value, its data requirements, its tier, and its implementation shape.

**Design principle:** AI features must make a QA lead's morning check-in faster and more actionable. Every feature is evaluated against: *"Does this reduce the time from 'build broke' to 'I know what to fix'?"*

---

## Provider Strategy

### Community Edition — Bring Your Own Key (BYOK)

Users supply their own API key via env vars. CTRFHub is provider-agnostic:

| Env var | Value |
|---|---|
| `AI_PROVIDER` | `openai` \| `anthropic` \| `groq` |
| `AI_API_KEY` | Provider API key |
| `AI_MODEL` | Optional model override (e.g. `gpt-4o-mini`) |

### Privacy and consent

**AI features are OFF by default — even when `AI_PROVIDER` is configured.** The pipeline will not send a single request to a managed LLM provider until an org admin has explicitly acknowledged what gets sent and where. This matters because CTRF stack traces, error messages, and test names routinely contain PII (user emails in fixture data), proprietary source paths, and — in the `script_error` case — snippets of application or test code.

**Two-gate consent model:**

1. **Deployment gate (`AI_CLOUD_PIPELINE`).** `AI_CLOUD_PIPELINE=off` (the default when unset) disables all managed-provider calls unconditionally, even if `AI_PROVIDER` and `AI_API_KEY` are set. Self-hosters in regulated environments (GDPR, HIPAA, classified, air-gapped) set this once at the infrastructure layer and no org admin can override it. Set to `on` to allow per-org opt-in. A future value `AI_CLOUD_PIPELINE=local` will allow local-inference providers (Ollama, llama.cpp) — out of scope for MVP.
2. **Per-org gate (acknowledgement).** When `AI_CLOUD_PIPELINE=on`, the first time an org admin opens any AI-dependent screen they see a consent dialog listing exactly what data leaves the instance (`test_name`, `error_message`, first 500 chars of `stack_trace`, category metadata), which provider receives it (derived from `AI_PROVIDER`), and the provider's data-retention policy link. Acknowledgement is persisted as `organizations.ai_cloud_ack_at` + `ai_cloud_ack_by` (columns added in a follow-up migration). Categorization is blocked for that org's runs until ack is recorded.

**Kill switch:** the acknowledgement can be withdrawn from Org Settings → AI. Withdrawal clears `ai_cloud_ack_at`, halts in-flight AI pipeline rows (sweeper terminal-fails them on next tick), and hides AI columns/cards until re-acknowledged. Previously-written AI columns (`ai_category`, `ai_root_causes`, etc.) are retained — withdrawal is prospective, not a historical purge. A separate "Purge AI-derived data" action is available for the full wipe.

**Data residency:** the `deployment-architecture.md` deployment docs carry a data-residency note identifying which provider endpoints receive traffic per `AI_PROVIDER` value (OpenAI: `api.openai.com`, US; Anthropic: `api.anthropic.com`, US; Groq: `api.groq.com`, US). Self-hosters with EU-only requirements must use local inference (future `AI_CLOUD_PIPELINE=local`) or disable AI features.

**What is sent per stage:**

| Stage | Payload |
|---|---|
| A1 categorize | `test_name`, `error_message`, `stack_trace[:500]` per failed result (batched 20/call) |
| A2 correlate | All failed results in a run: `test_name`, `error_message`, `stack_trace[:500]` |
| A3 summarize | Aggregate metrics + A1 category distribution + A2 cluster labels — **no raw test names or error text** |
| A4 anomaly | Aggregate metrics only across the last 30 runs — **no individual test data** |

A3 and A4 are materially less sensitive than A1/A2. A future setting may allow "A3/A4 only" (summarization and trend analysis without sending raw failure text), but it is not in scope for MVP.

Default models (when `AI_MODEL` is not set):
- OpenAI: `gpt-4o-mini` (fast, cheap, good for categorization)
- Anthropic: `claude-haiku-4-5-20251001`
- Groq: `llama-3.3-70b-versatile`

If no provider is configured: all AI features are silently disabled; UI hides AI columns and cards entirely — no errors, no "configure AI" nagging on every page.

### Business Edition — Managed AI

CTRFHub provides managed AI with no customer API key required:
- Higher rate limits than BYOK
- Model upgrades without customer action
- Confidence scores exposed in the API
- Advanced features that require persistent embeddings storage (Feature 5, 9)

---

## Feature Inventory

---

### Feature A1 — Per-Test Failure Categorization

**Tier:** Community MVP  
**Status:** Schema designed (DD-016); async trigger designed  
**Value:** Replaces manual triage. Each failed test gets a machine-assigned category that a QA lead can confirm or override in one click.

**Categories:**

| Category | Meaning |
|---|---|
| `app_defect` | Code regression — the test caught a real bug |
| `test_data` | Bad seed data, missing fixtures, stale mocks |
| `script_error` | Test itself is broken (wrong selector, bad assertion) |
| `environment` | Infrastructure failure (network, DB down, timeout) |
| `unknown` | Model cannot determine with confidence |

**Input per result:** test name, error message, stack trace (first 500 chars)  
**Batch size:** 20 results per API call  
**Cap:** 500 failed results per run  
**Schema:** `ai_category`, `ai_category_override`, `ai_category_model`, `ai_category_at` on `test_results` (see DD-016)  
**Trigger:** EventBus `run.ingested` event after `201` response  
**UI:** Category chip on each test row in Run Detail; Manual badge vs AI badge; Pending chip while processing

---

### Feature A2 — Root Cause Correlation

**Tier:** Community MVP  
**Status:** Planned — not yet designed  
**Value:** A run with 200 failures is not 200 separate problems. A2 groups failures by apparent root cause, collapsing a wall of red into 3–5 actionable clusters. This is the single feature most likely to make a QA lead's morning materially faster.

**Example output:**
```
Root Cause Cluster 1 (147 tests): "Database connection timeout"
  → Environment issue; likely CI infrastructure, not a code bug
  → Affected tests: checkout_flow, payment_process, ...

Root Cause Cluster 2 (41 tests): "Null pointer in UserProfile.render()"
  → App defect; commit a3f9b2 introduced a regression
  → Affected tests: user_dashboard, settings_page, ...

Root Cause Cluster 3 (12 tests): "Missing test fixture: users.seed.sql"
  → Test data issue; not related to the other clusters
```

**Input:** All failed results for a run (names, error messages, stack traces)  
**Prompt strategy:** Single LLM call with all failures; ask for JSON cluster output  
**Trigger:** After A1 categorization completes (`run.ai_categorized` event)  
**Schema:**

```sql
-- JSONB on test_runs — one row per run, not per result
ALTER TABLE test_runs
  ADD COLUMN ai_root_causes JSONB,        -- array of cluster objects
  ADD COLUMN ai_root_causes_at TIMESTAMPTZ;
```

```json
{
  "clusters": [
    {
      "label": "Database connection timeout",
      "category": "environment",
      "confidence": 0.94,
      "result_ids": [1842, 1843, 1844, ...],
      "explanation": "All 147 failures share the same stack root: java.sql.SQLException..."
    }
  ]
}
```

**UI:** Run Detail header shows cluster summary cards above the test table. Each card is expandable. Tests in the table are grouped/tagged by cluster.

**Limitation:** Accuracy degrades for runs with > 10 distinct root causes or very long stack traces. Cap clusters at 10.

---

### Feature A3 — Run Narrative Summary

**Tier:** Community MVP  
**Status:** Planned — not yet designed  
**Value:** A 3–5 sentence plain English summary of what a run means. A QA lead reads this in 10 seconds and decides whether to investigate or move on — without opening a single test.

**Example output:**
> *"The overnight suite on `main` (staging) completed with a 73% pass rate — down 14% from the previous run. Two root causes account for all failures: a database timeout affecting 147 tests (infrastructure, not a code regression) and a null pointer exception in UserProfile.render() affecting 41 tests (likely introduced in commit a3f9b2). The remaining 12 failures are a known test data issue. Action recommended: investigate the UserProfile regression; the infrastructure failures are likely self-resolving."*

**Input:** Run metadata (pass/fail/skip counts, environment, branch, commit), A2 root cause clusters, A1 category distribution, comparison to previous run (pass rate delta)  
**Trigger:** After A2 completes (`run.ai_correlated` event)  
**Schema:**

```sql
ALTER TABLE test_runs
  ADD COLUMN ai_summary TEXT,
  ADD COLUMN ai_summary_at TIMESTAMPTZ;
```

**UI:** Shown at the top of the Run Detail page as a highlighted card. Collapsible. Regenerate button (re-runs with same data). Dashboard run list shows first sentence as subtitle.

**Token cost:** ~500 input tokens + ~150 output tokens per run. Roughly $0.001 per run at gpt-4o-mini pricing — negligible.

---

### Feature A4 — Trend Anomaly Detection

**Tier:** Community Phase 2 (requires run history depth)  
**Status:** Planned — not yet designed  
**Value:** Proactive alerts when something unusual is happening, before a human notices. "Your pass rate dropped 18% in the last 3 runs — this is statistically unusual for this project."

**Anomaly types:**

| Type | Signal |
|---|---|
| Pass rate drop | > 2σ below 30-day mean |
| Duration spike | p90 duration > 150% of 30-day p90 |
| New failure pattern | Test that has never failed before failing in 3+ consecutive runs |
| Flaky rate increase | Test alternating pass/fail more than baseline |
| Category shift | Environment failures suddenly dominating (CI infrastructure problem) |

**Input:** Last 30 runs for the project (aggregate metrics only — no individual test data)  
**Trigger:** After each run is ingested and summarized  
**Schema:**

```sql
CREATE TABLE ai_anomalies (
  id            BIGINT PRIMARY KEY,
  test_run_id   BIGINT NOT NULL REFERENCES test_runs(id),
  anomaly_type  VARCHAR(50) NOT NULL,
  severity      ENUM('info', 'warning', 'critical') NOT NULL,
  description   TEXT NOT NULL,         -- plain English explanation
  data          JSONB,                 -- supporting data (delta values, affected tests)
  acknowledged  BOOLEAN NOT NULL DEFAULT FALSE,
  acknowledged_by BIGINT REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**UI:** Dashboard shows anomaly banner when unacknowledged anomalies exist. Run list annotates affected runs with anomaly icon. Dedicated Anomalies tab in project settings (history + acknowledge).

**Data requirement:** Minimum 7 prior runs for the project to establish a baseline. Feature silently inactive below this threshold.

---

### Feature A5 — Fix Suggestions

**Tier:** Community Phase 2  
**Status:** Planned — not yet designed  
**Value:** For a failed test, AI suggests what to look at or what kind of fix is likely. Not a code generator — a pointer.

**Example output for a test categorized as `script_error`:**
> *"This looks like a selector timing issue. The element is found but not yet interactive when the assertion runs. Consider: (1) adding an explicit wait for element visibility, (2) using `page.waitForSelector()` before interacting, or (3) checking whether a recent UI change moved the element."*

**Input:** Test name, error message, stack trace, category (from A1), framework (playwright/cypress/etc from `test_runs.reporter`)  
**Trigger:** On-demand (user clicks "Suggest Fix" button on a result) — not automatic to avoid API spend  
**Schema:** `ai_fix_suggestion TEXT` on `test_results`; fetched lazily, cached once generated  
**UI:** "Suggest Fix" button on each failed test row. Appears inline below the stack trace.

---

### Feature A6 — Cross-Run Failure Memory

**Tier:** Community Phase 2 / Business Edition  
**Status:** Planned — not yet designed  
**Value:** "This exact error occurred 3 runs ago. It was categorized as a test data issue and resolved by re-seeding the database." Connects the current failure to historical context from the same project.

**Implementation options:**
- **Simple (Community):** Exact-match on `error_message` hash across the project's last 90 runs
- **Advanced (Business):** Semantic embeddings of error messages; fuzzy similarity across all runs

**Schema (simple path):**
```sql
ALTER TABLE test_results
  ADD COLUMN error_hash VARCHAR(64);  -- SHA-256 of normalized error_message

CREATE INDEX idx_test_results_error_hash ON test_results(error_hash)
  WHERE error_hash IS NOT NULL;
```

**UI:** On the failed test detail, a "Seen before" section shows matching historical failures with their resolution (if the comment field was used).

---

### Feature A7 — Natural Language Query ("Ask the data")

**Tier:** Business Edition  
**Status:** Planned — not yet designed  
**Value:** Any team member can ask questions in plain English without knowing SQL or filter syntax.

**Examples:**
- *"Which tests have been failing for more than 2 weeks?"*
- *"What's our most common failure category this sprint?"*
- *"Show me all runs that failed in the staging environment last month"*
- *"Which tests are slowest on average?"*

**Implementation:** LLM with function calling / tool use. The model is given the schema and a safe set of allowed query functions. It emits structured query parameters, not raw SQL.

```typescript
// Tool definitions given to the model
const tools = [
  {
    name: 'query_runs',
    description: 'Filter and aggregate test runs',
    parameters: {
      project_slug: 'string?',
      environment: 'string?',
      status: 'string?',
      date_from: 'ISO8601?',
      date_to: 'ISO8601?',
      group_by: 'day|week|month?',
    }
  },
  {
    name: 'query_results',
    description: 'Search test results across runs',
    parameters: {
      status: 'string?',
      ai_category: 'string?',
      test_name_contains: 'string?',
      min_failure_count: 'number?',
      date_from: 'ISO8601?',
    }
  }
];
```

No raw SQL is ever generated or executed. The model selects and parameterizes safe tools only.

**UI:** Search bar on Dashboard. Results are rendered as a table + plain English explanation of what was found.

---

### Feature A8 — Flaky Test Prediction

**Tier:** Community Phase 2  
**Status:** Planned — not yet designed  
**Value:** Identifies tests likely to become reliably flaky before they are obviously flaky — based on subtle patterns (increasing duration variance, occasional single-retry failures, intermittent skips).

**Input:** Per-test history across last 30+ runs: pass/fail/skip per run, duration variance, retry count  
**Algorithm:** Initially rule-based (pass rate between 70–95% + high duration variance = flaky candidate); AI enhancement adds pattern explanation  
**Schema:** `flaky_score FLOAT` on `test_results` — updated by nightly worker  
**UI:** "Flaky risk" indicator on test rows; dedicated Flaky Tests view in project

---

### Feature A9 — Commit Impact Analysis

**Tier:** Business Edition (requires git integration)  
**Status:** Planned — not yet designed  
**Value:** "The 23 failures in this run are all in components touched by commit `a3f9b2`. Here is the diff." Connects test failures directly to code changes.

**Requires:** GitHub/GitLab app integration (Business Edition), `commit_sha` field on `test_runs`  
**Input:** Failing test files + commit diff from git provider API  
**Output:** Which changed files are associated with which failing tests

---

## Implementation Architecture (Shared)

All AI features share a common pipeline:

```
Ingest → EventBus → AiPipeline → DB update → SSE → UI refresh

AiPipeline stages (in order):
  1. A1 — Per-test categorization   (run.ingested)
  2. A2 — Root cause correlation    (run.ai_categorized)
  3. A3 — Run narrative summary     (run.ai_correlated)
  4. A4 — Anomaly detection         (run.ai_summarized)
```

Each stage fires the next event on completion. Any stage can fail independently without blocking subsequent stages. Failures are logged; the run is still usable without AI data.

```typescript
// AiPipelineService
eventBus.subscribe('ai', 'run.ingested',     categorizeRun);
eventBus.subscribe('ai', 'run.ai_categorized', correlateRootCauses);
eventBus.subscribe('ai', 'run.ai_correlated',  generateSummary);
eventBus.subscribe('ai', 'run.ai_summarized',  detectAnomalies);
```

**Error handling:** Each stage catches exceptions, logs them, and publishes the next event anyway (with `partial: true` flag if data is incomplete). A run with a failed A2 stage still gets a best-effort A3 summary using only A1 data.

**Retry:** Failed API calls retry up to 3 times with exponential backoff (1s, 4s, 16s). After 3 attempts, the row is marked `failed` in `ai_pipeline_log` and the next stage is still published (with `partial: true`).

### Durability and restart recovery (A1–A4)

The EventBus is fire-and-forget (in-memory MVP; Redis Pub/Sub at scale). On its own, a worker crash mid-stage would leave the run in an indefinite "analyzing" state with no resume path. The `ai_pipeline_log` table is therefore the **source of truth for pipeline scheduling**: the EventBus signals "consider scheduling", but workers reserve and commit work against rows in that table.

See [DD-017 — AI pipeline stages A2–A4 are table-driven with reserve-execute-commit semantics](database-design.md#dd-017--ai-pipeline-stages-a2a4-are-table-driven-with-reserve-execute-commit-semantics-so-crashes-never-lose-a-job) for the full schema and row-lifecycle walkthrough. The short version:

- Each stage handler upserts a row in `ai_pipeline_log` using `INSERT … ON CONFLICT(test_run_id, stage) DO NOTHING`, then atomically reserves it (`UPDATE … SET status='running', worker_id=…, heartbeat_at=NOW(), attempt=attempt+1 WHERE status='pending' AND attempt<3`).
- While executing, the worker heartbeats `heartbeat_at` every 15s.
- On success: `status='done'`, `completed_at=NOW()`, `tokens_used=:n`, then publish the next event (e.g. `run.ai_categorized`).
- On transient failure and `attempt < 3`: release the row (`status='pending'`) so the sweeper re-enqueues after backoff.
- On terminal failure (`attempt = 3`): `status='failed'`; the next stage is still triggered with degraded input.

**Recovery on boot** — before the worker subscribes to EventBus:
1. Release rows whose owning worker crashed: `UPDATE ai_pipeline_log SET status='pending', worker_id=NULL, heartbeat_at=NULL WHERE status='running' AND (heartbeat_at IS NULL OR heartbeat_at < NOW() - INTERVAL '2 minutes')`.
2. For every `pending` row attached to a run created in the last 24h, publish the event that triggers that stage. The normal handler then reserves and executes.

**Stuck-stage sweeper** — every 60 seconds:
- Same crashed-worker reclaim query as (1) above.
- Any `pending` row with `attempt >= 3` is terminal-failed so the run can unstick and downstream stages can run with `partial: true`.

**Idempotency guard** — before each stage calls the LLM, it checks whether the stage's primary output is already persisted (e.g. `correlate` checks `test_runs.ai_root_causes_at IS NOT NULL`). If so, the stage marks the `ai_pipeline_log` row `done` and publishes the next event without re-calling the LLM. This closes the narrow window where a crash lands between "primary write committed" and "ai_pipeline_log row marked done" — a normal recovery event would otherwise pay for the LLM call twice.

**Graceful shutdown (SIGTERM):**
- Stop reserving new rows.
- Finish any row already past the LLM-returned / primary-write-committed boundary (fast path to `done` + next event).
- Release the rest: `status='pending', worker_id=NULL, heartbeat_at=NULL`.

The `ai_pipeline_log` table also powers the System Status page — admins can see AI pipeline health and token consumption.

---

## Phased Rollout Plan

| Phase | Features | Requirement |
|---|---|---|
| **MVP (launch)** | A1 Categorization, A2 Root Cause Correlation, A3 Run Narrative | BYOK key configured |
| **Phase 2** | A4 Anomaly Detection, A5 Fix Suggestions, A6 Failure Memory (simple), A8 Flaky Prediction | 7+ runs of history |
| **Business Edition** | A6 Failure Memory (semantic/embeddings), A7 Natural Language Query, A9 Commit Impact | Git integration |

---

## What Competitors Don't Have

| Feature | CTRFHub | Gaffer | Reporter Engine | ReportPortal |
|---|---|---|---|---|
| Per-test categorization | ✅ MVP | ❌ | ✅ (stagnant) | ✅ |
| Root cause correlation | ✅ MVP | ❌ | ❌ | ❌ |
| Run narrative summary | ✅ MVP | ❌ | ❌ | ❌ |
| Anomaly detection | ✅ Phase 2 | ❌ | ❌ | partial |
| Natural language query | ✅ Business | ❌ | ❌ | ❌ |
| CTRF-native | ✅ | ✅ | ❌ | ❌ |
| Self-hosted | ✅ | ❌ | ✅ | ✅ |

---

*Last updated: 2026-04-22*
