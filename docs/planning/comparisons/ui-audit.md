# UI Audit — Sorry Cypress, Allure 2, ReportPortal

**Method:** Source-code only. All findings derived from React components, Java plugin source, and REST controller surface. No live demo sites visited.  
**Audited:** 2026-04-26  
**Tiers used:** T1 (source/DOM structure) + T3 screenshots where already captured (RP login page).

---

## 1. Sorry Cypress

**Stack:** React 18 + Material UI (MUI) v5 + Apollo Client → GraphQL  
**Routing:** React Router v6 (`/projects`, `/:projectId/runs`, `/instance/:id`, `/instance/:id/test/:testId`)

### View 1 — Projects List (`/projects`)

**Source:** `src/project/projectsView.tsx`, `projectListItem.tsx`

Each project is a **Card** with:
- Colored avatar icon (user-configured `projectColor`, default `#3486E3`)
- Project ID as primary text
- Optional live badge: **"Tests are running"** chip (toggled by a global setting)
- Last completed run's stat chips: **Overall / Passed / Failed / Flaky / Skipped / Pending**
- Card background color reacts to last run status:
  - Empty: light blue `#dcf1fa`
  - Has failures: light red `#fae8ea`
  - Flaky (no failures): light purple `#f1e3fa`
  - All passing: light green `#e3f5e1`
- Border color matches the status (solid red, purple, green, blue)

**Toolbar (top):** "Show actions" toggle, "Compact view" toggle, "Auto Refresh" toggle, free-text search ("Enter run build id").

**What it tells a user at a glance:** Which of their projects is currently broken, flaky, or healthy. Color-coded at the card level — no need to open a project to know something is wrong.

---

### View 2 — Runs Feed (`/:projectId/runs`)

**Source:** `src/run/runsView.tsx`, `runsFeed/`, `runSummary/`

- List of runs, each showing: build ID (`ciBuildId`), status badge, pass/fail/flaky/skipped counts, duration, commit metadata, branch name
- **Cursor-based pagination** (no page numbers)
- Toolbar: "Show actions" (reveals delete button per run), "Compact view", "Auto Refresh", search by build ID
- Each run row is a link into the run detail view

**What's absent:** No date-range filter, no status filter, no trend view. The only filter is a text search on build ID.

---

### View 3 — Run Detail (`/run/:runId`)

**Source:** `src/run/runDetails/`, `runSummary/`, `runSpecs/`

- Run-level stats bar: total tests, passed, failed, flaky, skipped, pending, duration, wall-clock start time
- Commit info: SHA, message, branch, author
- **Spec list**: each spec file shown as a row with its own pass/fail/flaky counts and status badge
- Each spec is a link into the instance/spec detail view
- "Reset instance" action (re-queues a claimed spec for parallel re-run — specific to orchestration model)
- Run timeout chip if timed out via `inactivityTimeoutSeconds`

---

### View 4 — Instance/Spec Detail (`/instance/:instanceId`)

**Source:** `src/instance/instanceDetails.tsx`

This is the most sophisticated view in the codebase. Two-panel layout:

**Left panel — Navigation tree (collapsible):**
- Tree structure mirrors test suite nesting: `describe` blocks become folders, `it` blocks are leaves
- Each leaf shows: status icon (colored), test name, duration (clickable — seeks video to that timestamp)
- Flaky tests get a pink `Flaky` icon badge
- First item is "Recorded video" if a video exists
- Panel is collapsible (left-arrow toggle) to give more space to the detail panel

**Right panel — Test detail or video player:**
- If a **test is selected**: `TestDetailsView` (see View 5)
- If **"Recorded video" is selected**: `Player` component with seek-to-timestamp support

---

### View 5 — Test Item Detail (within instance panel)

**Source:** `src/testItem/details/`

- Test title (full path)
- Status (passed/failed/pending/skipped)
- Duration
- Attempts list (if retries): each attempt shows state and `displayError`
- **Error display:** `displayError` rendered as formatted text, code frame (file + line number highlighted)
- Screenshots: inline gallery per attempt
- No AI categorization, no defect type UI, no severity field

---

### View 6 — CI Build View (`/ci-build/:ciBuildId`)

**Source:** `src/ciBuild/`

Groups multiple parallel runs that share a `ciBuildId`. Shows aggregate stats across all runs in the build. This is the only cross-run view in Sorry Cypress.

---

### View 7 — Project Settings (`/:projectId/edit`)

**Source:** `src/project/projectEditView.tsx`, `hooksEditor.tsx`

- Edit project name / color
- **Hooks editor**: add/edit notification hooks
  - Hook types: Slack, GitHub, Bitbucket, MS Teams, Google Chat, Generic Webhook
  - Per hook: event filter (RUN_START, RUN_FINISH, RUN_TIMEOUT, INSTANCE_START, INSTANCE_FINISH)
  - Slack: result filter (all/failed-only), branch filter
  - GitHub/Bitbucket: commit status API integration

---

### SC — What the UI tells us about the product

- **Primary audience is the CI engineer**, not the QA analyst. The run list, build grouping, and spec-level navigation are all CI-pipeline concepts.
- **Zero analytical depth** beyond the raw pass/fail/flaky counts. No trends, no grouping by error type, no AI.
- **Notification hooks are the most polished feature** — 7 hook types, fine-grained event and result filtering.
- **The video player with seek-to-test-timestamp** is genuinely useful for debugging visual E2E failures.

---

## 2. Allure 2

**Stack:** Java 8+ generator + webpack React SPA (static output)  
**Rendering:** One-shot CLI generation → self-contained HTML/JS bundle. No server required after generation.

### Navigation structure

Left sidebar with named sections — each is a separate "view" within the SPA:

| Sidebar item | Plugin | What it shows |
|---|---|---|
| **Overview** | `SummaryPlugin` | Launch-level stats widget, history trend, category chart, severity chart, feature/story breakdown |
| **Suites** | `SuitesPlugin` | Tree of test suites → test cases |
| **Graphs** | `StatusChartPlugin`, `DurationTrendPlugin` | Pie chart of status distribution; scatter plot of test durations |
| **Timeline** | `TimelinePlugin` | Tests plotted on a wall-clock timeline, grouped by host/thread |
| **Behaviors** | `BehaviorsPlugin` (external) | Epic → Feature → Story hierarchy, driven by label annotations |
| **Packages** | `PackagesPlugin` (external) | Java/Python package namespace tree |
| **Categories** | `CategoriesPlugin` | Rule-matched defect categories: "Product defects", "Test defects", custom |

---

### View 1 — Overview (Dashboard)

**Source:** `SummaryPlugin.java`, `HistoryTrendPlugin.java`, `CategoriesPlugin.java`, `SeverityPlugin.java`

Widgets displayed:
1. **Summary widget**: total tests, pass/fail/broken/skip/unknown counts, duration
2. **History trend**: bar chart of last N builds — pass (green), fail (red), broken (orange), skip (grey) stacked bars
3. **Category chart**: donut or bar chart of how failures split across user-defined categories
4. **Severity chart**: donut of test distribution by BLOCKER/CRITICAL/NORMAL/MINOR/TRIVIAL
5. **Executor info**: CI build name, URL, build number (from `executor.json`)
6. **Launch name and timestamp**

**Key insight:** The overview is **entirely plugin-contributed** — each widget is a separate plugin writing JSON data. The UI reads `widgets/` JSON files. This means the overview is extensible without touching core.

---

### View 2 — Suites Tree

**Source:** `SuitesPlugin.java`

- 3-level tree: Suite → Sub-suite → Test Case
- Each test case row: status icon, name, duration, flaky badge (if retried with mixed results)
- Click a test → slide-in detail panel on the right

**Test detail panel:**
- Status badge (passed/failed/broken/skipped/unknown)
- Duration + start time
- **Before stages** (setup): each step with status, duration, nested sub-steps, per-step attachments
- **Test stage** (body): same structure — nested steps, attachments
- **After stages** (teardown): same
- **Parameters**: key/value pairs passed to the test
- **Links**: custom links annotated in test code (e.g., issue tracker links, TMS links)
- **Labels**: all 19 label types visible (owner, severity, epic, feature, story, etc.)
- **History**: last N runs of this specific test — each with status and timestamp
- **Retries tab**: if the test was retried, shows all attempt results
- **Attachments**: screenshots, logs, videos, traces — MIME-typed, inline viewer for images/text

**Key insight:** This is the deepest test-result detail of any tool audited. Setup/teardown step visibility at the per-step attachment level is unique.

---

### View 3 — Graphs

**Source:** `StatusChartPlugin.java`, `DurationTrendPlugin.java`, `RetryTrendPlugin.java`

- **Status chart**: pie/donut of pass/fail/broken/skip/unknown for the current build
- **Duration trend**: line chart of total/max/min/average duration over last N builds
- **Retry trend**: bar chart of retry count per build
- **Severity chart**: bar chart of test count by severity level

---

### View 4 — Timeline

**Source:** `TimelinePlugin.java`

- Horizontal swimlane chart: rows = hosts/threads, columns = wall-clock time
- Each test plotted as a colored bar at its actual execution time
- Shows parallelism: how many threads were running simultaneously
- Color = test status
- Click bar → test detail panel

---

### View 5 — Behaviors (BDD view)

**Source:** `BehaviorsPlugin` (external plugin)

- Tree: Epic → Feature → Story → Test Case
- Tests are bucketed by `@Epic`, `@Feature`, `@Story` annotations in test code
- Includes CSV export of the behavior-to-test mapping
- Tests without behavior labels appear under "No feature"

---

### View 6 — Categories (Defect Classification)

**Source:** `CategoriesPlugin.java`

- List of user-defined category rules (from `categories.json`)
- Each category shows matched tests, grouped by category name
- Default categories: "Product defects" (FAILED status), "Test defects" (BROKEN status)
- User rules: match on `messageRegex`, `traceRegex`, `matchedStatuses`, `flaky` flag
- Tests not matching any rule → "Uncategorized"
- Each category is expandable → shows matched test names

---

### Allure — What the UI tells us about the product

- **Primary audience is the QA analyst** — the behaviors, categories, severity, and history views are all analytical. The developer view (suites + step hierarchy + attachments) is equally deep.
- **The setup/teardown step hierarchy is the killer feature** — no other tool in this audit shows where in the test lifecycle a failure occurred with per-step attachments.
- **The static generation model is visible in the UX**: there's no "Refresh" button, no live updates, no way to query or filter across reports. Each report is a snapshot.
- **Categories are the closest thing to AI triage** — but they require manual rule authorship and are regex-based. No learning.
- **History requires CI cooperation** — the history trend works only if the CI pipeline copies `history/` forward. A broken CI cache wipes the trend.

---

## 3. ReportPortal

**Source:** `service-api` REST controllers, `service-auto-analyzer`, `docker-compose.yml`  
**Note:** No live UI visit. UI structure inferred from REST API surface + auto-analyzer pipeline code. Login page screenshot captured (T3) but no authenticated views.

### Navigation model (inferred from API controllers)

| Controller | Path prefix | What it implies in the UI |
|---|---|---|
| `LaunchController` | `/v2/{project}/launch` | **Launch list view** — the primary list of test runs per project |
| `TestItemController` | `/v2/{project}/item` | **Test item detail** — nested items within a launch |
| `LogController` | `/v2/{project}/log` | **Log viewer** — per-test-item log entries with level, timestamp, attachment |
| `DashboardController` | `/v1/{project}/dashboard` | **Dashboard** — user-configurable widget canvas, multiple dashboards per project |
| `WidgetController` | `/v1/{project}/widget` | **Widget library** — individual widgets added to dashboards |
| `FilterController` | `/v1/{project}/filter` | **Saved filters** — named queries used to populate widgets and launch lists |
| `BugTrackingSystemController` | `/v1/bts` | **BTS integration UI** — Jira/Rally ticket creation from within a test item |
| `IntegrationController` | `/v1/integration` | **Integrations page** — plugin configuration for Slack, email, BTS |
| `ActivityController` | `/v1/{project}/activity` | **Activity/audit log** — who changed what and when |
| `UserController` | `/v1/user` | **User management** — invite, RBAC role assignment |
| `ProjectController` | `/v1/project` | **Project settings** — per-project configuration |
| `PluginController` | `/v1/plugin` | **Plugin management** — hot-load/unload JAR plugins |
| `DemoDataController` | `/v1/demo/{project}` | **Demo data generator** — populate a project with synthetic data |
| `TmsController` family | `/v1/{project}/tms/…` | **Test Management System** — test cases, milestones, test plans, datasets |

---

### View 1 — Login page (T3 screenshot captured)

- Two-panel layout: **left** = marketing/live Twitter feed + blog excerpt cards; **right** = auth form
- Auth options: **GitHub SSO** (prominent green button) OR username/password form
- "Forgot password?" link
- Left panel shows live product news — SSO moving to paid tier, new Organizations feature, MCP Server blog post
- "Login with GitHub" is visually dominant — GitHub SSO is the expected entry point for SaaS users

---

### View 2 — Dashboard (widget canvas)

**Inferred from:** `DashboardController`, `WidgetController`

- **Per-project**, **multiple dashboards** possible (create/delete/share)
- Dashboards contain a **drag-and-drop widget grid**
- Widget types (from widget table in `database-design.md` and controller): passing rate chart, launch statistics chart, test cases growth trend, investigated percentage, most failed test cases, flaky test cases, duration, unique bugs chart, cumulative trend, percent of investigations
- Each widget is backed by a **saved filter** (named query on launch attributes: name, tags, status, date range)
- Dashboards are shareable: `GET /v1/{project}/dashboard/{id}` returns a config snapshot

**Key insight:** The dashboard is a full BI-style widget canvas. Users build custom views from a library of chart widgets, each driven by saved filters. No other tool in this audit has this.

---

### View 3 — Launch List

**Inferred from:** `LaunchController` endpoints

- Paginated table of launches per project
- Columns (inferred from data model): launch name, number, status, start time, duration, pass/fail/skip counts, defect breakdown (product bug / automation bug / system issue / no defect / to investigate)
- **Saved filters**: filter launches by name, tags, attributes, date range, status. Filters are named and reused across widgets.
- **Auto-analyze button**: triggers the ML auto-analyzer to re-analyze all launches matching the filter
- **Merge launches**: combine multiple launches into one (for parallel CI runs)
- **Debug mode**: toggle between "All launches" and "Debug" (developer launches not shown to QA team)

---

### View 4 — Launch Detail (test item tree)

**Inferred from:** `TestItemController`, LTREE schema

- **Hierarchical tree** of test items: Suite → Test → Step (LTREE-based, arbitrary depth)
- Each item: status badge, defect type badge, duration, tags
- **Defect type column** is the key differentiator: every failed item shows its defect classification — `PRODUCT_BUG`, `AUTOMATION_BUG`, `SYSTEM_ISSUE`, `NO_DEFECT`, `TO_INVESTIGATE`
- Items not yet analyzed show "To Investigate" badge
- **Pattern analysis button**: runs ML analyzer on this launch's failures
- Filter bar: filter items by status, defect type, issue type

---

### View 5 — Test Item Detail (log viewer + defect triage)

**Inferred from:** `LogController`, `TestItemController`, auto-analyzer pipeline

- **Log entries**: structured log messages with level (ERROR/WARN/INFO/DEBUG/TRACE), timestamp, and attachments
- Attachments: screenshots, binary blobs — inline viewer
- **Defect type dropdown**: assign PRODUCT_BUG / AUTOMATION_BUG / SYSTEM_ISSUE / NO_DEFECT / TO_INVESTIGATE to this item
- **Issue link**: attach a Jira/BTS ticket to the failure; or create a new ticket directly from the UI
- **Auto-analyzer suggestion** (if trained): shows the ML-suggested defect type with confidence, with "Apply" button
- **Mark as ignore**: exclude from statistics
- **Retry history**: shows previous executions of the same test case across launches

---

### View 6 — Widgets (chart library)

**Inferred from:** `WidgetController`, widget type enum in schema

Widget types available for dashboards:
- **Passing rate** (donut) — % pass across selected launches
- **Launch statistics** (stacked bar per launch) — pass/fail/skip per launch over time
- **Test cases growth** — total test count trend
- **Investigation percentage** — % of failures with assigned defect type (vs "To Investigate")
- **Most failed test cases** — ranked table of flakiest/most-failing tests
- **Flaky test cases** — tests that flip between pass and fail
- **Duration** — launch duration trend
- **Unique bugs** — distinct Jira tickets linked across launches
- **Cumulative trend** — aggregate pass/fail over time

---

### View 7 — Integrations & Plugins

**Inferred from:** `IntegrationController`, `PluginController`

- **Jira / Rally BTS**: configure per-project or global; create tickets from test items; pull linked ticket status
- **Email**: rule-based `sender_case` notifications
- **Slack**: plugin-based (via hot-loaded JAR)
- **Plugin management page**: list, enable/disable, upload new JAR plugins

---

### View 8 — Test Management System (TMS)

**Inferred from:** `TmsController` family (`TestCaseController`, `TmsTestPlanController`, `TmsMilestoneController`, `TmsTestFolderController`)

This is a **full test case management system** embedded within RP — recently added feature (visible in the source but not in the public documentation):
- Test cases with manual + automated results linked
- Test plans and milestones
- Folder hierarchy for test case organization
- Manual launch execution tracking

**Key insight:** RP is evolving from a reporting tool toward a full test management platform. The TMS controllers are a major surface area that no other comparable tool has.

---

### RP — What the UI tells us about the product

- **Primary audience is the QA lead / test manager** — the defect classification workflow, investigation percentage widget, and TMS are management-level features.
- **The defect triage workflow is the core UX loop**: log in → see launches → see "To Investigate" count → click in → assign defect type → reduce "To Investigate" to zero. The entire product is organized around this workflow.
- **Dashboards are the differentiator for management reporting** — configurable widget canvases shared across team members.
- **The auto-analyzer is invisible to new users** — it's a background process. Users don't see it working until they've triaged enough historical failures to train it.
- **Log entries are first-class** — the log viewer with structured levels and per-entry attachments is the deepest log-oriented view of any tool audited.

---

## Cross-tool comparison — What each UI prioritizes

| Priority | Sorry Cypress | Allure 2 | ReportPortal |
|---|---|---|---|
| **Primary mental model** | CI build / spec run | Test suite report | Investigation workflow |
| **Primary user** | CI/DevOps engineer | QA engineer / developer | QA lead / test manager |
| **Entry-point view** | Project list (color-coded health) | Overview dashboard (stats widgets) | Dashboard (custom widget canvas) |
| **Deepest view** | Test + video player + code frame | Test + setup/teardown steps + per-step attachments | Test item log viewer + defect triage + BTS ticket |
| **Standout feature** | Video seek-to-test-timestamp | Step hierarchy with per-step attachments | Defect type classification + investigation % widget |
| **Analytical depth** | None (raw counts only) | Per-build + trend history (N builds) | Cross-launch trends, widget dashboards, flaky ranking |
| **AI / categorization surface** | None | User-defined regex rules (Categories view) | ML-suggested defect type on each test item |
| **Missing** | Any analysis beyond raw counts | Persistence, live updates, cross-report queries | Lightweight onboarding, day-0 AI value |

---

## Implications for CTRFHub UI design

### Things CTRFHub should do better than all three:

1. **Instant AI insight at the run level** — not buried in per-item detail (like RP) or absent (SC, Allure). Surface AI-categorized failure groups on the run detail view itself.
2. **No cold-start dashboard** — unlike Allure's history-requires-CI-coordination and RP's to-investigate-requires-training, CTRFHub's LLM works on the first run. The dashboard should reward this with visible insights immediately.
3. **Simpler navigation** — SC's 4-view depth and Allure's 7-sidebar-sections are both manageable. RP's 8+ view types require onboarding. CTRFHub should be navigable by a developer who's never seen it before.

### Things to adopt from each tool:

| From SC | From Allure | From RP |
|---|---|---|
| Color-coded project cards (health at a glance) | Before/teardown step visibility (if CTRF adds step data) | Investigation % concept (how many failures have been triaged) |
| Video timestamp seek (if attachments include video) | History trend widget on overview | Defect type classification as a first-class concept |
| Compact/expanded run list toggle | Behaviors/BDD grouping (if labels are added) | Saved filter concept for cross-run queries |
