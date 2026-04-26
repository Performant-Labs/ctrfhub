# ReportPortal — Comparison vs CTRFHub MVP Spec

> **Phase 3 of the Comparator Review.** Source reviewed: `~/Projects/ReportingTools/report-portal/` (meta-repo at tag
> `reportportal/reportportal`, sub-repos `service-api`, `service-auto-analyzer`, `migrations`). Version strings in
> `docker-compose.yml`: API `5.15.1`, UI `5.15.2`, UAT `5.15.0`, Analyzer `5.15.1`, Jobs `5.15.0`.

---

## 1. What Was Reviewed

### Paths inspected

| Path | Purpose |
|---|---|
| `reportportal/docker-compose.yml` | Container topology, service dependencies, env-var schema |
| `reportportal/README.md` | Architecture overview, service list |
| `reportportal/ROADMAP.md` | Product direction and future capabilities |
| `migrations/migrations/` | Full Postgres schema (258 migration files) |
| `migrations/migrations/1_initialize_schema.up.sql` | Initial schema — all core tables and ENUMs |
| `service-api/src/main/java/com/epam/reportportal/base/ws/controller/` | All REST controllers |
| `service-api/src/main/java/com/epam/reportportal/auth/` | Auth subsystem (SAML, OAuth, LDAP) |
| `service-api/src/main/java/com/epam/reportportal/base/util/email/` | Email notification subsystem |
| `service-api/src/main/java/com/epam/reportportal/base/infrastructure/persistence/entity/widget/` | Widget types incl. `FlakyCasesTableContent` |
| `service-auto-analyzer/app/main.py` | Analyzer entry point, AMQP wiring |
| `service-auto-analyzer/app/service/auto_analyzer_service.py` | Core ML analysis pipeline |
| `service-auto-analyzer/app/ml/models/defect_type_model.py` | Per-project defect classification (RandomForest + TF-IDF) |
| `service-auto-analyzer/app/ml/boosting_featurizer.py` | Feature extraction (60+ features, XGBoost boosting layer) |
| `service-auto-analyzer/requirements.txt` | Python dependency list |

### Docs read

- ReportPortal public documentation (referenced from README)
- `ROADMAP.md` — product vision and planned capabilities

---

## 2. Feature Presence Matrix

All dimensions from the original §4 scope plus the 12 new dimensions added in Phase 1 and Phase 2 retrospectives.

| Dimension | ReportPortal Status | Notes |
|---|:---:|---|
| **Ingest API** | ✅ Present | REST API via `service-api`; async via RabbitMQ; `LaunchAsyncController`, `TestItemAsyncController`, `LogAsyncController` for high-throughput ingest |
| **Data model** | ✅ Present | Deep Postgres schema: `launch → test_item (ltree) → log`, `issue`, `issue_type`, `pattern_template`, `statistics`, `ticket`, `attachment` |
| **UI / dashboard** | ✅ Present | React SPA (`service-ui`); dashboards, widgets, filters; shared entity model for per-project and cross-project views |
| **Search** | ✅ Present | OpenSearch (`opensearch:9200`) integration for log full-text search via analyzer; API-level filter DSL (`FilterTarget`, `FilterCondition`) with 12 filter operators |
| **AI / categorization** | ✅ Present | Full ML auto-analyzer (Python, traditional ML — not LLM); see §3.1c |
| **Auth** | ✅ Present | Full stack: sessions, API keys, SAML 2.0 (`SamlServiceProviderConfiguration`), LDAP/AD, OAuth 2.0 (`oauth_registration` table), GitHub SSO (`SsoEndpoint`) |
| **Real-time** | ⚠️ Partial | No WebSocket or SSE found in source; RabbitMQ is used for internal async messaging (ingest, analysis jobs); UI likely polls for live status |
| **Notifications** | ✅ Present | Email (`EmailService`, `UserDeletionNotificationStrategy`, `sender_case` + `recipients` tables); Slack via plugin ecosystem (not in source, plugin-based) |
| **Self-hosting** | ✅ Present | Full Docker Compose stack; `docker compose -p reportportal up` is the documented path |
| **Operational** | ✅ Present | `service-jobs`: cron-based retention (launch, log, attachment, storage), `RetentionPolicyEnum`, `OrganizationRetentionPolicyHandler`; Spring Boot Actuator for health; plugin hot-reload |
| **Framework support breadth** | ✅ Present | Proprietary `agent-*` and `client-*` adapter ecosystem: Java (JUnit, TestNG, Cucumber), Python (pytest, Robot), JavaScript (Jasmine, Mocha, WebdriverIO), .NET, Go, Ruby — 15+ officially supported |
| **Execution model** | ✅ Present | Live ingest server (not post-hoc); agents stream results in real time during test execution; `launch → start/finish` lifecycle |
| **Attachment/artifact storage** | ✅ Present | Filesystem by default (`DATASTORE_TYPE=filesystem`); S3 and MinIO alternatives via env-var; `attachment` table with `file_id`, `thumbnail_id`, `content_type` |
| **Flaky detection mechanism** | ✅ Present | Dedicated widget: `FlakyCasesTableContent`, `FlakyCasesTableContentLoader`; uses retry/rerun history from `has_retries`, `rerun` columns on `launch`; history-based statistical detection |
| **CI build grouping** | ✅ Present | `launch` table has `rerun BOOLEAN` and `launch_number`; `unique_id` on `test_item` enables cross-launch identity; `launch.mode` = DEFAULT / DEBUG; pattern analysis links items across launches |
| **Deployment dependency count** | ❌ Heavy | **9 services** in default compose: `gateway` (Traefik), `postgres`, `rabbitmq`, `opensearch`, `migrations`, `index`, `ui`, `api` (UAT = `uat`), `jobs`, `analyzer` — minimum viable is 7 (excluding analyzer + opensearch but losing ML) |
| **Status taxonomy depth** | ✅ Present | Rich `STATUS_ENUM`: `CANCELLED`, `FAILED`, `INTERRUPTED`, `IN_PROGRESS`, `PASSED`, `RESETED`, `SKIPPED`, `STOPPED` — 8 states vs CTRFHub's 5 |
| **Execution step hierarchy** | ✅ Present | `TEST_ITEM_TYPE_ENUM`: `STEP`, `SUITE`, `STORY`, `SCENARIO`, `TEST`, `BEFORE_CLASS/METHOD/SUITE/GROUPS`, `AFTER_CLASS/METHOD/SUITE/GROUPS` — 15 item types; LTREE path for nesting; per-step attachments via `log.attachment_id` |
| **Export to monitoring systems** | ⚠️ Partial | Spring Boot Actuator exposed (health, metrics); no Prometheus scrape endpoint found in source (possible plugin or external integration — not shipped by default) |
| **Issue tracker integration** | ✅ Present | `BugTrackingSystemController` (`/v1/bts`); official plugins: `plugin-bts-jira`, `plugin-bts-rally`, `plugin-saucelabs`; `ticket` table with `bts_url`, `bts_project`, `ticket_id` |
| **Rule-based vs AI categorization** | ✅ Present (ML) | `pattern_template` table for regex/string pattern rules; separate ML auto-analyzer for AI-assisted categorization. Three-way: rules + ML + (no LLM yet) |
| **Complementary vs competitive** | Competitive | RP is a direct live-ingest competitor to CTRFHub; no complementary positioning like Allure (static artifact) |

---

## 3. Sub-phase Details

### 3.1a — Architecture & Deployment

**Container topology (docker-compose.yml):**

```
gateway (Traefik v2.11)    ← public entry point, ports 8080/443
postgres (bitnami PG 17)   ← all metadata, test results
rabbitmq (bitnami 4.1)     ← internal AMQP bus (ingest queues, analyzer queues)
opensearch (2.19)          ← log full-text indexing for auto-analyzer
migrations                 ← Flyway-style init container, exits on success
index (service-index)      ← routing / health check aggregator
ui (service-ui)            ← React SPA served as static assets
api (service-api)          ← Java/Spring Boot; REST + AMQP consumer
uat (service-authorization)← Java/Spring Boot; auth/session/token service
jobs (service-jobs)        ← Java/Spring Boot; cron scheduler (cleanup, retention)
analyzer (service-auto-analyzer) ← Python/Flask; ML analysis via AMQP
```

**Total mandatory services: 9** (10 containers if you count the migration init container).  
**Minimum viable (no ML):** 7 (drop `analyzer` + `opensearch`).  
**Memory allocation:** API requires `-Xmx1g`; OpenSearch needs `-Xmx512m`; baseline RAM > 3 GB.

**Execution model:** Live ingest server. Agents push results during test execution using the proprietary client/agent SDK. The model is fundamentally different from CTRFHub (which receives completed CTRF JSON reports post-hoc).

**Deployment comparison:**
| Tool | Containers | External Services |
|---|:---:|---|
| CTRFHub | 1 | None (SQLite) or 1 (Postgres) |
| Sorry Cypress | 4 | MongoDB |
| Allure 2 | 0 | None (CLI) |
| ReportPortal | 9–10 | Postgres + RabbitMQ + OpenSearch |

### 3.1b — Ingest API & Data Model

**REST controllers found:**

| Controller | Route |
|---|---|
| `LaunchController` | `POST /v1/{projectKey}/launch` |
| `LaunchAsyncController` | Async launch ingest (AMQP) |
| `TestItemController` | `/v1/{projectKey}/item` |
| `TestItemAsyncController` | Async item ingest |
| `LogController` | `/v1/{projectKey}/log` |
| `LogAsyncController` | Async log ingest |
| `IntegrationController` | `/v1/integration` |
| `BugTrackingSystemController` | `/v1/bts` |
| `ProjectController` | `/v1/project` |
| `UserController` | `/v1/users` |
| `WidgetController` | `/v1/{projectKey}/widget` |
| `DashboardController` | `/v1/{projectKey}/dashboard` |
| `UserFilterController` | `/v1/{projectKey}/filter` |
| `ActivityController` | `/v1/{projectKey}/activity` |
| `PluginController` | `/v1/plugin` |
| `FileStorageController` | `/v1/data` |

**Data hierarchy:** `organization → project → launch → test_item (LTREE) → log`

**Schema highlights:**
- `STATUS_ENUM`: 8 statuses (`CANCELLED`, `FAILED`, `INTERRUPTED`, `IN_PROGRESS`, `PASSED`, `RESETED`, `SKIPPED`, `STOPPED`)
- `TEST_ITEM_TYPE_ENUM`: 15 types (STEP, SUITE, STORY, SCENARIO, TEST, BEFORE/AFTER + CLASS/METHOD/SUITE/GROUPS/TEST)
- `ISSUE_GROUP_ENUM`: `PRODUCT_BUG`, `AUTOMATION_BUG`, `SYSTEM_ISSUE`, `TO_INVESTIGATE`, `NO_DEFECT` — 5-group defect taxonomy
- `issue_type`: user-extensible subtypes per group with `locator`, `issue_name`, `abbreviation`, `hex_color`
- `pattern_template`: regex/string patterns for rule-based auto-categorization
- `launch.rerun`: boolean flag; `launch.has_retries` tracks retry history
- `test_item.path`: LTREE — enables fast ancestor/descendant queries for nested suites/steps
- `test_item.unique_id`: cross-launch identity for the same test case
- `statistics` + `statistics_field`: denormalized pass/fail/skip counters per launch and item
- `ticket`: BTS link (`bts_url`, `bts_project`, `ticket_id`, `url`) — linked from `issue_ticket`
- `attachment`: `file_id` + optional `thumbnail_id` + `content_type` — stored in filesystem/S3/MinIO

**CI build grouping:** `launch.number` + `launch.rerun` flag + `test_item.unique_id` enable grouping of re-run launches from the same CI pipeline. No explicit `ciBuildId` concept like Sorry Cypress, but functional equivalent via `launch.name` + `number` uniqueness constraint + rerun flag.

**Framework support:** 15+ official `agent-*` adapters (Java, Python, JS, .NET, Go, Ruby). Each is a proprietary listener that speaks the RP ingest protocol — not CTRF. Adapters must be updated when the RP API changes.

### 3.1c — AI / Auto-Analyzer

**Technology:** Python 3, Flask, scikit-learn 1.5, XGBoost 1.7, NLTK 3.9, gensim 4.3. **No LLMs. No OpenAI/Anthropic/Groq.** Traditional ML only.

**Architecture:** Standalone Python microservice (`service-auto-analyzer`). Receives analysis tasks via RabbitMQ (AMQP exchange `analyzer-default`, virtual host `analyzer`). Results are written back via AMQP to `service-api`.

**Pipeline (from `auto_analyzer_service.py`):**

1. **Log indexing** (`index` AMQP queue): test logs are indexed into OpenSearch per-project index
2. **Auto-analysis** (`analyze` queue): for each failed test item, the analyzer:
   - Extracts error message fields (message, stacktrace, detected_message, found_exceptions, URLs, status codes)
   - Queries OpenSearch for similar historical logs using MLT (More Like This) queries with per-field boost weights
   - Runs `BoostingFeaturizer` (60+ hand-engineered features: score, similarity %, issue type distribution, test case hash, launch identity, temporal decay, etc.)
   - Runs `AutoAnalysisPredictor` (XGBoost model) trained on human issue triage decisions
   - Outputs: `issueType` → one of the 5 `ISSUE_GROUP_ENUM` values + subtype
3. **Defect type model** (`DefectTypeModel`): per-project `RandomForestClassifier` + `TfidfVectorizer` trained on historical issue data — refines predictions for `ab` / `pb` / `si` subtypes
4. **Cluster analysis** (`cluster` queue): groups similar failures for bulk categorization
5. **Suggest** (`suggest` queue): suggests issue types for human review (lower confidence threshold)
6. **Pattern analysis** (`suggest_patterns` queue): regex/string pattern matching against `pattern_template` table

**What it is NOT:**
- Not LLM-based — no prompts, no token costs, no provider abstraction
- Not privacy-gated — the analyzer has unconditional access to all log data
- Not zero-config — requires OpenSearch, RabbitMQ, and a trained model corpus to be useful

**Flaky detection:** `FlakyCasesTableContent` widget + `FlakyCasesTableContentLoader` in `service-api`. Uses retry counter from `has_retries` / `rerun` columns + historical pass/fail oscillation across launches. Rule-based (not ML). CTRFHub currently has no flaky detection.

**Privacy story:** None. All test logs are indexed unconditionally into OpenSearch. No consent gate, no opt-out, no data minimization. This is architecturally baked in — the ML cannot function without log indexing.

**Cost story:** No external API costs. All ML is local. The trade-off: results are only as good as the historical training data; cold-start projects see no benefit.

### 3.1d — Auth, Search, UI, Real-time, Notifications, Operational

**Auth:**
- `service-authorization` (separate Java/Spring Boot service, `uat`)
- Supports: username/password, API keys (`api_key` table, `68_api_key_last_used_at` migration), SAML 2.0 (`Saml2AuthenticationConfiguration`), LDAP (`ldap_config` table), Active Directory (`active_directory_config`), OAuth 2.0 (`oauth_registration`), GitHub SSO (`SsoEndpoint`)
- Project-level RBAC: `PROJECT_ROLE_ENUM` — `OPERATOR`, `CUSTOMER`, `MEMBER`, `PROJECT_MANAGER`
- Organization-level grouping added in recent migrations (199+): `organization_tables`, `migrate_org_roles`, groups with per-org slugs

**Search:**
- API-level filter DSL: `FilterTarget`, `FilterCondition` with 12 operators (`EQUALS`, `NOT_EQUALS`, `CONTAINS`, `EXISTS`, `IN`, `HAS`, `GREATER_THAN`, `GREATER_THAN_OR_EQUALS`, `LOWER_THAN`, `LOWER_THAN_OR_EQUALS`, `BETWEEN`, `ANY`)
- Log full-text search via OpenSearch (trigram index also present: `log_message gin_trgm_ops`)
- Shareable filters (`filter`, `filter_condition`, `filter_sort`) stored in DB and linked to widgets/dashboards

**Real-time:**
- No WebSocket or SSE found in service-api source
- RabbitMQ is used for inter-service async (not client-facing)
- UI likely polls the API for launch status updates; no push mechanism confirmed from source

**Notifications:**
- Email: `EmailService`, rule-based via `sender_case` + `recipients` + `launch_attribute_rules` + `launch_names` tables; configurable per-project notification rules
- Slack: plugin-based (not in this source repo); official ecosystem plugin
- No webhook outbound integration confirmed in source

**Issue tracker integration:**
- `BugTrackingSystemController` (`/v1/bts`) — full API for BTS operations
- Official plugins: `plugin-bts-jira`, `plugin-bts-rally`, `plugin-saucelabs`
- `ticket` table stores BTS tickets linked from `issue_ticket` (many-to-many issue → ticket)
- This is a first-class feature, not an afterthought

**Attachment/artifact storage:**
- `attachment` table: `file_id`, `thumbnail_id`, `content_type`, `project_id`, `launch_id`, `item_id`
- Storage backend: filesystem (default), S3, MinIO — configured via `DATASTORE_TYPE` env var
- `FileStorageController` (`/v1/data`) handles binary retrieval

**Export to monitoring systems:**
- Spring Boot Actuator is included (confirmed via `ActuatorControllerTest`)
- No dedicated Prometheus scrape endpoint found in source
- No Grafana plugin shipped; community integrations may exist but not in this repo

**Operational:**
- `service-jobs`: cron scheduler for cleanup (attachments, logs, launches), storage recalculation, expired user cleanup, event retention
- `RetentionPolicyEnum`, `RetentionPolicyAttributeHandler`, `OrganizationRetentionPolicyHandler` — per-launch and per-org retention policies
- `shedlock_table` migration — distributed job locking
- Plugin system: hot-loadable JARs (`PluginController`, `PluginPublicController`); `plugin_type` table; cron-based plugin reload

---

## 4. Code-vs-Docs Reconciliation

| Claim | Verified? | Notes |
|---|:---:|---|
| "Multi-language support" (README) | ✅ | 15+ agent adapters documented; architecture is ingest-server so agents exist for all major languages |
| "ML auto-analysis" (README/roadmap) | ✅ | Full Python ML pipeline confirmed: XGBoost + RandomForest + TF-IDF; `scikit-learn`, `xgboost` in requirements |
| "Jira / Rally BTS integration" (README) | ✅ | `BugTrackingSystemController`, `ticket` table, `plugin-bts-jira` confirmed |
| "MinIO for attachments" (README) | ✅ | `DATASTORE_TYPE=minio` is an explicit option in both API and analyzer compose config |
| "Real-time streaming" (implied by agent architecture) | ⚠️ | Ingest is real-time (agents stream during test runs); UI display updates are not confirmed real-time (no WS/SSE found) |
| "Prometheus export" (comparison reviews) | ❌ | Not found in source; only Spring Actuator is present; external community integrations may exist |
| "LLM-based AI" | ❌ | The analyzer is entirely traditional ML (scikit-learn, XGBoost, gensim). No LLM dependencies. |
| "Quality Gates" (ROADMAP) | 🔮 Planned | Explicitly in ROADMAP but not in this codebase; `COM_TA_REPORTPORTAL_JOB_INTERRUPT_BROKEN_LAUNCHES_CRON` suggests in-flight launch interruption exists |

---

## 5. Notable Design Choices

### 1. Proprietary ingest protocol, not CTRF
Every `agent-*` adapter speaks the RP proprietary HTTP protocol. A team switching from one test framework must install, configure, and maintain a RP-specific adapter. CTRF solves this at the format level — one JSON schema works for all frameworks. RP's approach creates N adapter maintenance burdens; CTRF's approach creates zero per-framework burden after the initial adapter.

### 2. ML pipeline with no LLM exposure
The auto-analyzer is a self-contained, locally-trained ML system. Benefits: no API costs, no data leaves the instance, works air-gapped. Drawbacks: requires a corpus of human-triaged failures to be useful (cold-start problem), cannot understand novel failure patterns outside training data, and cannot be improved by prompting — it must be retrained. CTRFHub's LLM approach works from day one on any codebase.

### 3. Complexity as a feature and a liability
RP's depth (15 item types, 8 statuses, 5 defect groups, extensible subtypes, shareable dashboards, BTS integration, per-org retention, hot-loadable plugins) is genuinely impressive. But every dimension of depth is a vector for configuration complexity. The `docker-compose.yml` alone spans 667 lines with 13+ environment variable namespaces. Teams evaluating tooling spend hours on RP setup vs. minutes on CTRFHub.

### 4. LTREE for nested test hierarchy
Using PostgreSQL's LTREE extension for `test_item.path` is clever — it enables fast ancestor/descendant queries without recursive CTEs. CTRFHub's current model is flat (`run → result`); RP's deep nesting is both a feature (suite/step granularity) and a schema commitment that is hard to retrofit.

### 5. Plugin architecture
RP's hot-loadable Java plugin system (JARs stored in DB, reloaded on cron) is powerful but fragile. Plugin versioning, API compatibility, and classloader isolation are non-trivial. CTRFHub's event-bus architecture is simpler but currently less extensible for external consumers.

### 6. RabbitMQ as the ingest bus
RP chose AMQP (RabbitMQ) as the backbone for high-throughput ingest and inter-service communication. This enables horizontal scaling of the API tier but adds operational complexity and a hard service dependency. CTRFHub's in-process event bus scales vertically and has zero external dependencies.

---

## 6. Market Position

### The gap CTRFHub fills over ReportPortal

| Category | ReportPortal | CTRFHub |
|---|---|---|
| **Time to first value** | Hours (9-service stack, adapter installation) | Seconds (1 container + CTRF JSON POST) |
| **Deployment complexity** | 9 containers, 3GB+ RAM, Postgres + RabbitMQ + OpenSearch | 1 container, SQLite default, zero external services |
| **Framework agnosticism** | Proprietary adapters per framework | Universal CTRF format, framework-neutral |
| **AI approach** | Traditional ML (no LLM, requires training corpus) | LLM-native with provider choice + consent gates |
| **Privacy-first AI** | None (unconditional log indexing) | Opt-in per-project consent gate |
| **Contributor accessibility** | Java ecosystem + Python | TypeScript/Node.js (larger contributor pool) |
| **Operational burden** | Retention cron, plugin management, 9-service health | Single-process, minimal ops |

### Reasons users would switch from RP to CTRFHub

1. **Complexity fatigue** — RP's 9-service stack is substantial ops overhead for small-to-medium teams
2. **Framework lock-in** — teams adopting a new framework must find/write a new RP adapter; CTRF is framework-neutral
3. **AI that works on day one** — RP's ML requires a critical mass of human-triaged failures before it produces useful results; CTRFHub's LLM works immediately
4. **Cost-predictable AI** — RP has no token costs but requires significant infrastructure; CTRFHub's cost model is transparent per-run
5. **Simpler deployment story** — CI/CD-native teams want `docker run` not `docker compose up` with 13 env-var namespaces

### Reasons users would NOT switch (RP's durable advantages)

1. **Deep BTS integration** — Jira/Rally ticket linking is a first-class workflow in RP; no equivalent in CTRFHub MVP
2. **Live ingest during test execution** — RP shows real-time progress; CTRFHub sees only completed reports
3. **Multi-language adapters** — RP's 15+ adapters are production-tested at Fortune 100 scale
4. **Defect taxonomy richness** — RP's 5-group × N-subtype system with custom hex colors is mature; CTRFHub has a simpler categorization model
5. **Organizational scale** — multi-project, multi-org, RBAC, SAML/LDAP SSO are enterprise table-stakes that CTRFHub MVP does not yet cover
6. **Historical ML** — teams with years of RP data benefit from a trained model that understands their specific failure patterns; switching means losing that corpus
7. **Widget/dashboard ecosystem** — RP's dashboards, shared filters, and widget library are feature-complete after years of development

### Complementary vs competitive

RP is **strictly competitive** with CTRFHub in the live-dashboard/analytics space. There is no natural complementary positioning (unlike Allure, which could serve as a CI artifact alongside CTRFHub as a live dashboard). A team running RP has no reason to also run CTRFHub.

---

## 7. Proposed Gaps for `gaps.md`

The following features RP has that CTRFHub MVP lacks and that appear meaningful for enterprise adoption:

| Feature | Which comparable(s) | Priority | Rationale |
|---|---|:---:|---|
| **BTS ticket linking** | RP (primary), SC (absent) | Phase 2 | Enterprise teams expect to link failures to Jira issues; RP's `ticket` table + plugin BTS is the gold standard |
| **Flaky detection** | RP, SC (both have it) | Phase 2 | Detecting oscillating tests is a core triage workflow; RP uses history, SC uses retry count |
| **Per-project retention policies** | RP | Phase 2 | `RetentionPolicyEnum` + org-level retention settings; needed before CTRFHub can be used as a long-term store |
| **Defect subtype taxonomy** | RP | Phase 2 | RP's 5-group × N-subtype system is broadly adopted; CTRFHub's AI categories should map to this or a compatible taxonomy |
| **SAML / SSO auth** | RP | Phase 2 | Enterprise requirement; missing from CTRFHub MVP |
| **Nested test item hierarchy** | RP, Allure | Parking lot | LTREE suite/step nesting is powerful but not in CTRFHub's flat `run → result` model; complex schema change |
| **Live ingest (streaming during execution)** | RP | Parking lot | Architecturally different from CTRF's post-hoc model; would require a streaming ingest protocol alongside CTRF |

---

*Document produced by Talos (Feature-implementer / Assessor) — Phase 3 of the Comparator Review.*  
*Ready for checkpoint review with André before Phase 4 (synthesis).*
