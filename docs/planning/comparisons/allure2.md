# Allure 2 — Feature Comparison vs CTRFHub

**Reviewed:** 2026-04-26
**Source:** `~/Projects/ReportingTools/allure2/` (commit at time of clone)
**CTRFHub baseline:** `docs/planning/product.md`, `architecture.md`, `ai-features.md`, `database-design.md`, `parking-lot.md`

---

## 1. What Was Reviewed

| Module | Path | Purpose |
|---|---|---|
| `allure-plugin-api` | `allure-plugin-api/src/main/java/io/qameta/allure/` | Core entity model (TestResult, Status, Label, Attachment, Step, StageResult), plugin interfaces (Reader, Extension, Aggregator2), tree data structures |
| `allure-generator` | `allure-generator/src/main/java/io/qameta/allure/` | Report generator — reads result files, runs aggregator plugins, produces static HTML report. Includes built-in plugins: categories, history, severity, retry, trends, duration, timeline, suites, summary, mail, executor, InfluxDB/Prometheus export |
| `allure-commandline` | `allure-commandline/src/` | CLI wrapper — `allure generate` / `allure serve` / `allure open` |
| `plugins/` | `plugins/` | 10 external plugins: `behaviors`, `packages`, `junit-xml`, `xunit-xml`, `trx`, `xctest`, `jira`, `xray`, `screen-diff`, `custom-logo` |
| `allure-jira-commons` | `allure-jira-commons/src/` | Shared Jira HTTP client used by jira-plugin and xray-plugin |

---

## 2. Feature Presence Matrix

| Dimension | CTRFHub MVP | Allure 2 | Notes |
|---|---|---|---|
| **Execution model** | Post-execution ingest server (live, persistent) | Static report generator (CLI, one-shot) | Allure reads result files from disk, processes them through plugin pipeline, and outputs a static HTML/JS site. No server process, no persistent storage, no API. Fundamentally different execution model. |
| **Framework support** | Any (via CTRF adapters) | ✅ Extremely broad — 11+ languages | Allure's format is documented; adapters exist for Java (JUnit, TestNG, Cucumber), Python (pytest, behave), JavaScript (Mocha, Jest, Playwright, Cypress), Ruby, Go, C#, Scala, Kotlin, PHP, Swift (XCTest). Built-in readers also handle JUnit XML, xUnit XML, TRX (Visual Studio), and XCTest formats. This is Allure's strongest dimension. |
| **Ingest API** | REST (JSON + multipart) | N/A — reads local filesystem | No HTTP API. Allure reads result directories from the local filesystem. This means it only works as a CI post-step or local CLI tool, never as a live dashboard. |
| **Data model — status taxonomy** | `passed / failed / skipped / pending / other` | `passed / failed / broken / skipped / unknown` | **Key difference:** Allure splits "failure" into `failed` (product defect — assertion error) and `broken` (test infrastructure defect — exception/error). This is a richer taxonomy than CTRF's single `failed` status. `unknown` maps loosely to CTRF's `other`. |
| **Data model — test structure** | `project → run → result` (flat) | `TestResult` with `beforeStages → testStage → afterStages`, each containing `Steps → Attachments` | Allure's model is significantly deeper. A TestResult contains execution stages (setup / test body / teardown), each with nested steps and per-step attachments. This allows fine-grained visibility into *where* in the test lifecycle something failed. CTRFHub's model is flat — a result has a status, message, and trace, but no step hierarchy. |
| **Data model — labeling** | Tags (CTRF field) | ✅ Rich label system — 19 built-in label types | `LabelName` enum: `OWNER`, `SEVERITY`, `ISSUE`, `TAG`, `TEST_TYPE`, `PARENT_SUITE`, `SUITE`, `SUB_SUITE`, `PACKAGE`, `EPIC`, `FEATURE`, `STORY`, `TEST_CLASS`, `TEST_METHOD`, `HOST`, `THREAD`, `LANGUAGE`, `FRAMEWORK`, `RESULT_FORMAT`. Labels drive multiple report views (suites, behaviors, packages, timeline). |
| **Defect taxonomy** | AI-generated (A1 pipeline) | ✅ Rule-based categories via `categories.json` | Allure's `CategoriesPlugin` matches test results against user-defined rules using regex on `statusMessage` and `statusTrace`, filtered by status and flaky flag. Default categories: "Product defects" (FAILED) and "Test defects" (BROKEN). Users can define custom categories. This is **deterministic, user-configured** — no AI, no learning. |
| **Flaky detection** | Planned (AI-assisted, cross-run) | ✅ History-based, algorithmic | `HistoryPlugin.isFlaky()`: a test is flaky if its current status is FAILED/BROKEN AND within the last 5 historical runs, there exists a PASSED result *before* a FAILED result. This requires the `history/` directory to be preserved between runs. Also flags `newFailed`, `newBroken`, `newPassed` status transitions. Sophisticated for a static tool. |
| **History / trends** | Planned (run-over-run trends) | ✅ Multi-plugin trend system | `HistoryTrendPlugin` (pass/fail/broken/skip counts over last 20 builds), `DurationTrendPlugin` (total/max/avg duration), `RetryTrendPlugin` (retry counts). History data stored as JSON in `history/` directory and carried forward between report generations. Requires CI integration to copy `history/` from the previous report. |
| **Severity classification** | Not planned | ✅ 5-level severity | `BLOCKER`, `CRITICAL`, `NORMAL` (default), `MINOR`, `TRIVIAL`. Set via `@Severity` annotation in test code or as a label. Drives a severity-based view in the report. |
| **BDD / behavior view** | Not planned | ✅ Epic → Feature → Story hierarchy | `BehaviorsPlugin` groups tests by `EPIC`, `FEATURE`, `STORY` labels into a tree view. Tests annotated with `@Epic("...")`, `@Feature("...")`, `@Story("...")` in the test code appear in this hierarchy. Includes CSV export of behaviors. |
| **AI / categorization** | A1–A4 pipeline (LLM-based) | **Absent** | Confirmed zero AI features. Grep for `openai|anthropic|llm|classify|categoriz|machine.learning` returned only false positives (`TreeClassifier` is a tree data structure interface, not ML). Categories are strictly rule-based regex matching. |
| **Plugin system** | Not planned (monolithic) | ✅ Mature plugin architecture | `Extension` → `Reader` (reads input formats), `Aggregator2` (processes results), `Context` (provides services to plugins). Plugins loaded via `DefaultPluginLoader`. Each plugin can contribute: JSON data files, widget data, CSV export data, metric data. Very clean separation of concerns. |
| **Data storage** | PostgreSQL + SQLite (persistent, queryable) | Filesystem only (ephemeral) | Allure outputs static files. No database, no persistent storage. Each report generation is independent — history requires manual `history/` directory management. This is a fundamental limitation: data is not queryable, not searchable, not aggregatable after generation. |
| **Search** | Planned (PostgreSQL FTS) | In-browser filtering only | The generated report has client-side filtering by status, severity, and text search in the browser. No server-side search. |
| **Real-time updates** | Planned (SSE) | N/A | Static report — no real-time capability. |
| **Notifications** | Planned (webhook-based) | Partial — `MailPlugin` generates an email-ready HTML fragment | `MailPlugin` uses Freemarker to render `mail.html.ftl` into an HTML file suitable for email. But it doesn't *send* email — it just generates the file. No Slack, no webhooks, no active notifications. |
| **Auth** | Session-based (Better Auth) | N/A | Static HTML files — no authentication. Anyone who can access the directory can view the report. |
| **Attachment handling** | Local filesystem (MVP) | ✅ Rich — per-step attachments with MIME type detection | Attachments (screenshots, logs, traces, videos) are first-class in Allure. Each `StageResult` and `Step` can have `List<Attachment>`. Attachments have `uid`, `name`, `source` (file path), `type` (MIME), `size`. The `MagicBytesContentTypeDetector` auto-detects content type. Attachments are copied into the report output directory. |
| **Screenshot comparison / visual regression** | Not planned | ✅ `screen-diff-plugin` | Supports expected/actual/diff image comparison in the report UI. No Java source — it's a UI-only plugin (JS/CSS). |
| **Export** | Planned (CSV/JSON) | ✅ Multiple export formats | CSV export for categories and behaviors. InfluxDB line-protocol export (`influxDbData.txt`). Prometheus metrics export (`prometheusData.txt`). These are generated as files alongside the report — not API endpoints. |
| **Metrics / observability** | Planned (health endpoint) | Prometheus + InfluxDB metric files | `PrometheusExportPlugin` writes `launch_status`, `launch_time`, `launch_problems`, `launch_retries` in Prometheus format. `InfluxDbExportPlugin` writes equivalent in InfluxDB line protocol. These can be scraped/imported by monitoring systems. |
| **Deployment complexity** | Single container (Node.js + SQLite) | Zero deployment — CLI tool | Allure is a Java CLI (`allure generate`). Install via Homebrew, Scoop, or download. No server to run, no database. Trade-off: zero operational overhead, but also zero persistence. |
| **Technology stack** | Node.js, Fastify, HTMX, MikroORM | Java 8+ (Gradle), Jackson, Freemarker, Webpack (report UI) | JVM-based generator, JS/CSS report output. |
| **Jira integration** | Not planned | ✅ `jira-plugin` + `xray-plugin` | `JiraExportPlugin` pushes test results to Jira Cloud. `XrayTestRunExportPlugin` exports to Xray test management. Both require API credentials. These are *export-on-generation* — not live sync. |
| **CI build grouping** | Not planned | Partial — `ExecutorPlugin` tracks executor/build info | `ExecutorPlugin` reads `executor.json` (CI build name, URL, build order). This links the report to its CI context but doesn't group multiple reports. |
| **Retention / cleanup** | Planned (TTL-based) | N/A | Static files — retention is filesystem-level. Delete old report directories manually or via CI retention policies. |

---

## 3. Code-vs-Docs Reconciliation

| Claim (README/docs) | Source verification | Verdict |
|---|---|---|
| "flexible multi-language test report tool" | Confirmed — `Allure2Plugin` (native format), `Allure1Plugin` (legacy), `JunitXmlPlugin`, `XunitXmlPlugin`, `TrxPlugin`, `XcTestPlugin` all implement `Reader`. Ecosystem adapters cover 11+ languages. | ✅ Accurate |
| "detailed representation of what has been tested" | Confirmed — step hierarchy, attachments, before/after stages, parameters, labels, links, history, retries | ✅ Accurate |
| "extract maximum from everyday execution of tests" | Confirmed — trend plugins, flaky detection, severity, categories, behaviors, timeline, duration analysis | ✅ Accurate |
| Implied: can serve as a live dashboard | **Not true** — `allure serve` starts a temporary Jetty server for viewing only; no persistence, no multi-user access, no API | ❌ `allure serve` is a convenience command, not a production dashboard |

---

## 4. Notable Design Choices Worth Comparing

### 4.1 The Failed vs Broken Distinction

Allure's 5-status model (`passed / failed / broken / skipped / unknown`) makes a critical distinction CTRFHub doesn't: **test failures** (assertion errors → "Product defects") vs **test infrastructure errors** (exceptions, timeouts → "Test defects"). This distinction is extremely valuable for triage — it tells you whether the *product* is broken or the *test* is broken.

**Relevance to CTRFHub:** CTRF's standard uses a single `failed` status. CTRFHub's AI categorization pipeline (A1) could potentially distinguish between product defects and test defects by analyzing error messages and stack traces — achieving the same separation dynamically rather than requiring it in the test runner.

### 4.2 Rule-Based Categories — The Non-AI Alternative

Allure's `categories.json` lets users define custom defect categories using regex rules:

```json
[
  {
    "name": "API timeout errors",
    "matchedStatuses": ["broken"],
    "messageRegex": ".*timeout.*",
    "traceRegex": ".*HttpClient.*"
  }
]
```

This is deterministic, zero-cost, requires no external API, and works offline. But it requires manual rule authoring and doesn't adapt to new failure patterns.

**Relevance to CTRFHub:** CTRFHub's A1 LLM-based categorization is more powerful (no rule authoring needed, adapts to novel failures) but has costs (API calls, privacy concerns, latency). A hybrid approach — LLM categorization with the ability to pin/override via user-defined rules — would combine the best of both. Worth noting for `gaps.md`.

### 4.3 Step Hierarchy — Deep Execution Visibility

Allure's test model supports arbitrarily nested steps within stages. A single test result can show:
```
Setup:
  → Step: Open browser
  → Step: Navigate to /login
Test:
  → Step: Enter credentials
    → Attachment: screenshot.png
  → Step: Click submit
  → Step: Verify dashboard loads (FAILED)
    → Attachment: failure-screenshot.png
Teardown:
  → Step: Close browser
```

This level of detail is valuable for debugging complex E2E tests.

**Relevance to CTRFHub:** CTRF reports contain `message` and `trace` fields but no step hierarchy. Adding step-level detail would require CTRF spec changes. This is likely out of scope for CTRFHub MVP, but the value is clear — worth flagging for the parking lot.

### 4.4 History as a File-System Protocol

Allure's history system is clever but fragile: the `history/` directory from the previous report must be copied into the next report's input directory. This creates a chain of reports, each carrying forward up to 20 data points per test. CI pipelines must be configured to preserve and restore this directory.

**Relevance to CTRFHub:** CTRFHub's persistent database model inherently solves this — history is just a query across runs. Allure users who want trends must maintain a fragile file-copying protocol in CI. CTRFHub gives them trends for free, which is a strong selling point.

### 4.5 Plugin Architecture Is the Gold Standard

Allure's plugin system is the best-designed component in any tool reviewed so far:
- **Reader** plugins parse input formats (Allure native, JUnit XML, xUnit XML, TRX, XCTest)
- **Aggregator2** plugins process results (categories, severity, history, retries, trends)
- **Context** plugins provide shared services (Jackson, Freemarker, RandomUid, Markdown)
- Plugins can contribute JSON data, widget data, CSV export, and Prometheus/InfluxDB metrics

Each plugin is self-contained: it declares what it reads, what it writes, and what services it needs.

**Relevance to CTRFHub:** CTRFHub is monolithic by design (simpler for a solo-maintainer MVP). But if CTRFHub ever needs extensibility (custom report views, custom export formats, additional input parsers), Allure's plugin architecture is the reference design. The `Reader` → `Aggregator` → `ReportStorage` pipeline is clean and well-separated.

### 4.6 Export to Monitoring Systems

Allure uniquely supports Prometheus and InfluxDB metric export. This means CI pipelines can push test metrics into existing observability stacks — grafana dashboards showing test pass rates over time, alerting on test quality regressions, etc.

**Relevance to CTRFHub:** CTRFHub's planned metrics endpoint could be enhanced to emit Prometheus-compatible metrics. Worth noting for the parking lot.

---

## 5. Proposed Findings for Routing

### For `gaps.md` (potential additions)

| Finding | Priority | Rationale |
|---|---|---|
| **Hybrid categorization: LLM + user-defined rules** | Phase 2 | Allure's rule-based `categories.json` approach is deterministic and free. CTRFHub's LLM approach is more powerful but costly. A hybrid — LLM by default, user rules as overrides — gives teams the best of both worlds. |
| **Failed vs Broken distinction** | Phase 2 | Allure's separation of "product defect" from "test defect" is high-value for triage. CTRFHub's AI could infer this, but exposing it as a first-class concept in the UI would improve debugging workflows. |
| **Prometheus / InfluxDB metric export** | Parking lot | Allure exports test metrics to monitoring systems. CTRFHub could expose a `/metrics` endpoint for Prometheus scraping. Useful for teams with existing observability infrastructure. |

### Already covered in `parking-lot.md` or planned

| Finding | Reference |
|---|---|
| Export functionality (CSV/JSON) | `parking-lot.md` — export listed |
| Historical trends | Already in CTRFHub MVP scope (run-over-run trends) |
| Severity classification | Not in scope but could be a label-based feature |

### Explicitly out of scope for CTRFHub

| Feature | Why N/A |
|---|---|
| Static report generation | CTRFHub is a live dashboard server, not a CLI tool |
| Plugin architecture | CTRFHub is intentionally monolithic for MVP simplicity |
| Step hierarchy in results | Would require CTRF spec changes; out of CTRFHub's control |
| JUnit XML / xUnit XML / TRX parsing | CTRF is the chosen format; adapters handle conversion |
| Jira integration | Enterprise feature, not MVP scope |
| Screen diff / visual regression | Not in CTRFHub's scope |

---

## 6. Market Position — Where CTRFHub Fills the Gap

### 6.1 Why Allure 2 users might switch to CTRFHub

Allure 2 is a beloved tool among QA engineers — its reports are beautiful and information-dense. But it has a fundamental architectural limitation: **it's a static report generator, not a live system**. The moment any of the following conditions apply, Allure stops being adequate:

1. **Persistent, queryable data.** Allure generates a snapshot — once the HTML is created, the data is frozen. You can't query historical results, search across runs, or build custom dashboards. CTRFHub stores all results in a persistent SQL database, making every run queryable and every test traceable across its entire lifecycle.

2. **Team collaboration.** Allure reports are files served from a directory. There's no login, no shared state, no ability to annotate failures or assign ownership. CTRFHub's session-based auth and project-scoped views give teams a shared workspace for test result triage.

3. **Real-time visibility.** Allure reports are generated after a CI pipeline completes. There's no way to see results as they arrive. CTRFHub's live ingest API and planned SSE updates give teams instant visibility into test runs as they execute.

4. **Fragile history.** Allure's trend system requires CI pipelines to copy a `history/` directory between report generations. If the CI cache is lost, history is lost. CTRFHub's database-backed history is permanent and automatic — no CI configuration required.

5. **AI-powered failure analysis.** Allure's categories are static regex rules that someone must author and maintain. CTRFHub's A1–A4 pipeline automatically categorizes failures, groups related errors, and generates human-readable narratives — no rule authoring needed, and it adapts to novel failure patterns.

6. **Deployment simplicity for dashboard use.** If a team wants a persistent, web-accessible test dashboard (not just a CI artifact), Allure requires setting up a web server, configuring CI to publish reports, and managing report retention. CTRFHub is a single container that serves a live dashboard out of the box.

### 6.2 Why Allure 2 users might NOT switch

1. **Report UX maturity.** Allure reports are *gorgeous*. The step hierarchy, attachment viewer, timeline, severity chart, and behaviors tree are polished over years of development. CTRFHub's HTMX-based views are functional but can't yet match Allure's visual depth.

2. **Framework integration depth.** Allure's adapter ecosystem covers 11+ languages with deep framework integration (annotations, step decorators, attachment APIs). CTRF adapters exist for major frameworks but don't offer the same instrumentation depth — no step hierarchy, no before/after stages, no parameterized test support.

3. **The broken vs failed distinction.** Teams that rely on Allure's separation of "product defect" (assertion failure) from "test defect" (infrastructure error) would lose this in CTRF's single `failed` status. CTRFHub's AI could infer the distinction, but it's not guaranteed.

4. **Rule-based categories are free.** Allure's `categories.json` is deterministic, offline, and costs nothing. CTRFHub's LLM categorization requires an API key, has latency, and costs money per request. Teams with strict cost constraints or privacy requirements may prefer Allure's approach.

5. **No vendor lock-in.** Allure generates self-contained HTML. The report works without any server, any network, any service dependency. CTRFHub requires running a server process. If CTRFHub's server goes down, the dashboard is inaccessible. Allure reports are durable files.

6. **Established ecosystem integrations.** Allure has Jira, Xray, Prometheus, InfluxDB, and CI executor integrations. CTRFHub's integration story is post-MVP. Teams that depend on pushing test results to Jira or Grafana would lose those capabilities.

7. **Complementary, not competitive.** Many teams could use both: Allure for per-build CI reports (attached to pipeline artifacts) and CTRFHub for cross-run dashboarding and AI analysis. They're not mutually exclusive — they serve different needs.

---

## 7. Summary Assessment

Allure 2 is the **gold standard for static test reporting**. Its data model (status taxonomy, step hierarchy, label system), plugin architecture, and report UX are best-in-class. It's the most mature and widely adopted tool in this review.

However, its static nature is both its greatest strength and its greatest limitation:
- **No persistence** — each report is ephemeral; data isn't queryable after generation
- **No live API** — can't build integrations or real-time dashboards
- **No auth** — reports are static files, no access control
- **Fragile history** — depends on CI pipeline configuration to carry forward the `history/` directory
- **No AI** — categories are powerful but require manual regex rule authoring

CTRFHub's key advantages over Allure are:
- **Persistent, queryable data store** — SQL vs ephemeral files
- **AI-driven categorization** — automatic vs manual regex rules
- **Live dashboard** — real-time vs post-build snapshots
- **Team features** — auth, shared views, API access

The main features CTRFHub should learn from Allure:
1. **The failed/broken distinction** — surfacing this in CTRFHub's AI categorization output would add significant triage value
2. **Rule-based category overrides** — a hybrid LLM + user-rules approach
3. **Prometheus metric export** — enabling teams to integrate test metrics into existing observability
4. **The plugin architecture** — as a reference for future extensibility
