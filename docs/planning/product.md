# CTRFHub — Product Definition

## What Is CTRFHub?

CTRFHub is a self-hosted, open-source test reporting and analytics platform built natively for the [CTRF (Common Test Results Format)](https://ctrf.io/) standard. It gives software teams a persistent, searchable history of their test runs — with trend charts, flaky-test detection, and AI-powered failure analysis — without requiring SaaS subscriptions, Java runtimes, or custom report parsers per framework.

**The one-line pitch:** ReportPortal-level features, one `docker compose up`, under 500 MB RAM.

CTRFHub ships in two editions:

| | Community | Business |
|---|---|---|
| **License** | MIT (open source) | Commercial |
| **Price** | Free | Paid |
| **Deployment** | Self-hosted | Self-hosted or CTRFHub Cloud |
| **Auth** | Email/password, admin + viewer | + SSO/SAML/OIDC, custom roles |
| **AI analysis** | Bring-your-own API key | Managed (no key needed) |
| **Support** | Community / GitHub Issues | Priority SLA |

---

## Core Positioning

- **CTRF-native** — zero-config support for Playwright, Cypress, Vitest, Jest, and any other CTRF-compatible reporter.
- **Self-hosted** — test data never leaves your infrastructure.
- **Java-free** — pure Node.js; runs on a $5/month VPS.
- **AI-powered** — automatic failure categorization without manual tagging.

---

## User Personas

### Persona 1 — The CI/CD Engineer ("Alex")

> *"I need to push test results from our pipelines and trust the data is captured — I don't want to maintain a custom reporter per project."*

- Sets up and maintains CI/CD pipelines (GitHub Actions, GitLab CI, CircleCI).
- Primary interaction: configuring the CTRF reporter, generating API tokens, writing the `curl` or reporter plugin to push results.
- Success looks like: one token, one endpoint, reports flowing in without babysitting.
- Pain points: custom adapters per framework; SaaS tools that send test data off-network; Java-based tools that require dedicated ops.
- **Primary edition:** Community.

---

### Persona 2 — The QA Lead ("Priya")

> *"I need to see which tests are flaky, which failures repeat across runs, and whether we're getting better or worse — without digging through CI logs."*

- Reviews dashboards daily; not deeply involved in pipeline setup.
- Primary interaction: the web dashboard — trends, run history, test detail, AI failure categorization.
- Success looks like: a 30-second morning check to confirm the overnight suite passed; instant drill-down when it didn't.
- Pain points: CI logs are hard to search; no history in framework-generated HTML reports; manual failure categorization is time-consuming.
- **Primary edition:** Community (individual); Business (team/org with SSO).

---

### Persona 3 — The Solo Developer / Open Source Maintainer ("Sam")

> *"I want to track my test suite health but I'm not running a Kubernetes cluster. Give me one file and one command."*

- Self-hosting on a cheap VPS or a local machine; SQLite preferred over Postgres.
- Primary interaction: initial Docker setup, then occasional dashboard review.
- Success looks like: `docker compose up`, upload a report, see a dashboard. No configuration files beyond a single `.env`.
- Pain points: heavyweight tools (ReportPortal requires 4 GB+); SaaS tools have no free self-hosted tier; Allure has no persistent history server.
- **Primary edition:** Community.

---

### Persona 4 — The Engineering Manager / Team Lead ("Jordan") *(Business)*

> *"I need to see test health across 12 repos, enforce SSO for the whole org, and get a weekly report I can share with stakeholders."*

- Manages multiple teams and projects; concerned with org-level visibility and governance.
- Primary interaction: cross-project dashboards, user management, SSO configuration, PDF/export reports.
- Success looks like: single sign-on for the whole org, no separate credential management, summary reports that don't require log access.
- Pain points: per-project tooling creates silos; no audit trail for compliance; can't share test health with non-technical stakeholders.
- **Primary edition:** Business.

---

## Community Edition

The Community Edition is the open-source core of CTRFHub, licensed under MIT. It is the primary focus of the initial release.

### Community MVP Features

#### Feature 1 — CTRF Report Ingestion

**Goal:** Accept a valid CTRF JSON report from a CI pipeline or file upload and store it persistently.

**User stories:**
- As a CI pipeline, I can `POST /api/v1/projects/:slug/runs` with an `x-api-token` header and a CTRF JSON body, so that test results are captured automatically after every run.
- As a developer, I can upload a CTRF JSON file via the web UI, so that I can import historical reports without a CI setup.
- As a CI engineer, I can generate a project-scoped API token in the UI and use it in my pipeline, so that each project's data is isolated.

**Acceptance criteria:**
- `POST /api/v1/projects/:slug/runs` with a valid `x-api-token: <token>` header and valid CTRF JSON returns `201 { runId }`.
- Invalid CTRF JSON returns `422` with a human-readable Zod validation error.
- Missing or invalid token returns `401`.
- Ingest endpoint accepts both `application/json` (raw body) and `multipart/form-data` (CTRF JSON field plus optional artifact file parts — see Feature 4).
- File upload via the web UI produces the same stored record as a direct API call.

---

#### Feature 2 — Dashboard & Run History

**Goal:** Give teams an at-a-glance view of test suite health and a searchable run history.

**User stories:**
- As a QA lead, I can see an overview dashboard with total runs, pass rate, average duration, and flaky count for the last 7 days, so that I can assess health at a glance.
- As a QA lead, I can view a run history list filtered by project, date range, status (passed / failed / mixed), and environment, so that I can find specific runs quickly.
- As a QA lead, I can view trend charts (pass rate, total failures, duration) over 7 / 30 / 90-day windows, so that I can track improvement or regression over time.
- As a developer, I can open a single run and navigate from suites → tests → steps with expandable failure details, so that I can understand exactly what broke.

**Acceptance criteria:**
- Dashboard loads in < 1 second on a cold cache for up to 10,000 stored runs.
- Filters apply without a full page reload (HTMX partial swap).
- Trend charts render on the client using Chart.js with no additional API calls beyond the page data.
- Test detail view shows name, status, duration, error message, and stack trace (if present in CTRF).
- All list views are paginated (default 20 per page, configurable up to 100).

---

#### Feature 3 — AI-Powered Failure Analysis

**Goal:** Turn a wall of red test failures into 3–5 actionable insights in under 60 seconds. Three integrated AI features ship at launch; all require a user-supplied API key (bring-your-own). See `ai-features.md` for the full AI strategy including Phase 2 and Business Edition features.

**User stories:**

*A1 — Per-test failure categorization:*
- As a QA lead, I can see an AI-generated failure category (App Defect / Test Data / Script Error / Environment / Unknown) on each failed test, so that I can prioritize fixes without reading every stack trace.
- As a developer, I can override the AI category with a manual label; the original AI prediction is preserved so I can see where AI was wrong.

*A2 — Root cause correlation:*
- As a QA lead, when a run has 200 failures, I can see them grouped into root cause clusters ("Database timeout — 147 tests", "Null pointer in UserProfile — 41 tests"), so that I know I am dealing with 2 problems, not 200.

*A3 — Run narrative summary:*
- As a QA lead, I can read a 3–5 sentence plain English summary at the top of each run, so that I can decide whether to investigate in under 10 seconds without opening a single test.

**Acceptance criteria:**
- All AI features run asynchronously after ingest — the `201` response is never delayed.
- A1 (categorization) is complete within 30 seconds of ingest for runs with up to 500 failed tests.
- A2 (root cause clusters) and A3 (run narrative) are available within 60 seconds of ingest.
- Manual category override saves immediately via HTMX partial swap; original AI prediction preserved in `ai_category`; override in `ai_category_override`.
- If `AI_PROVIDER` env is not set: all AI columns and cards are hidden — no errors, no nagging.

---

#### Feature 4 — Artifact Management

**Goal:** Associate screenshots, videos, traces, and logs with individual test results.

**User stories:**
- As a CI engineer, I can include artifact files (screenshots, videos, traces) as additional file parts in the same multipart ingest `POST`, so that visual evidence of failures is captured alongside test results without a separate upload step.
- As a CI engineer, I can embed external video URLs (e.g. Loom, YouTube, Vimeo) in the CTRF JSON `attachments` field, so that long-form recordings are referenced without uploading large files to CTRFHub.
- As a QA lead, I can view and download artifacts directly from the test detail view, so that I can reproduce failures without re-running tests.

**Acceptance criteria:**
- Multipart `POST /api/v1/projects/:slug/runs` accepts a `ctrf` JSON field plus zero or more artifact file parts; file part names are matched to `attachment.path` values in the CTRF JSON.
- There is no separate `/api/artifact` endpoint — artifacts are always submitted with the run that owns them.
- External URL attachments (`attachment.path` starting with `http://` or `https://`) are stored by reference only; no file is uploaded to CTRFHub storage.
- Locally stored artifacts are served from `GET /api/files/*` with the correct `Content-Type`.
- S3-stored artifacts are returned as pre-signed URLs with a 1-hour expiry.
- Test detail view lists all associated artifacts with type icons (screenshot / video / trace / html_report / log).
- Per-file size limits enforced (returns `413`): images 10 MB, video 100 MB, zip files 200 MB, logs 5 MB. Per-run total configurable via `MAX_ARTIFACT_SIZE_PER_RUN` (default: 1 GB).

---

#### Feature 5 — Authentication & Multi-Project

**Goal:** Secure the instance and support multiple teams/repositories in one deployment.

**User stories:**
- As an admin, I can invite users by email and assign them admin or viewer roles, so that access is controlled without exposing the instance publicly.
- As a viewer, I can log in and see dashboards and run history but cannot create projects, generate tokens, or delete data.
- As an admin, I can create multiple projects (one per repo or team) and generate separate API tokens per project, so that each team's data is isolated.
- As a CI engineer, I can use a project-scoped token that only has permission to ingest into its assigned project, so that a compromised token has limited blast radius.

**Acceptance criteria:**
- Email + password login; no OAuth required for Community MVP.
- Invitation email sent when an admin adds a user (requires SMTP config; skipped gracefully if not configured, with a copyable invite link shown in the UI).
- Viewer role cannot access: project settings, token management, delete actions.
- API tokens shown in plaintext exactly once (on creation); subsequently only the last 4 characters are shown.
- Tokens can be revoked from the project settings page.

---

#### Feature 6 — CI / Reporter Integration

**Goal:** Make it trivially easy to send reports from the most common CI frameworks and tools.

**User stories:**
- As a Playwright user, I can add the CTRFHub reporter to my `playwright.config.ts` in under 5 minutes, so that reports are pushed automatically after every test run.
- As a Cypress user, I can add the CTRFHub reporter plugin in under 5 minutes.
- As any CI user, I can copy a ready-made GitHub Actions workflow snippet from the CTRFHub docs to push any CTRF JSON file.

**Acceptance criteria:**
- `@ctrfhub/playwright-reporter` npm package exists and is documented.
- `@ctrfhub/cypress-reporter` npm package exists and is documented.
- GitHub Actions example workflow included under `examples/github-actions/`.
- All three methods produce identical stored run records.

---

#### Feature 7 — Data Management

**Goal:** Keep the database and disk footprint bounded for long-running self-hosted instances.

**User stories:**
- As a self-hoster, I can configure a retention period so that old runs are automatically pruned and disk space doesn't grow unboundedly.
- As an admin, I can manually delete a specific run from the UI.

**Acceptance criteria:**
- `RETENTION_DAYS` env var controls the pruning window (default: 90 days).
- A background job runs nightly and deletes runs older than the threshold, along with their test records and artifacts.
- Manual run deletion from the UI shows a confirmation dialog and completes within 2 seconds for runs with up to 10,000 tests.
- Pruning job logs the number of runs and artifacts deleted to the application log.

---

### Community Phase 2

| Feature | Reason deferred |
|---|---|
| Incremental ingest streaming (push individual test results as they complete) | Requires persistent connection management |
| Real-time WebSocket live monitoring during test execution | Depends on incremental ingest |
| Basic flaky detection (multi-run correlation) | Needs run history depth to be meaningful |
| Slack / Teams / webhook notifications | Workable via CI-level notifications for now |
| Test comparison across branches / environments | Needs UX research |

---

### Community Screen Inventory (MVP)

| Screen | Route | Description |
|---|---|---|
| Login | `/login` | Email + password form |
| Dashboard | `/` | Overview stats, trend charts, recent runs |
| Run List | `/runs` | Filterable, paginated list of all runs |
| Run Detail | `/runs/:id` | Suite → test tree with expandable failures and artifacts |
| Project List | `/projects` | All projects (admin: manage; viewer: view) |
| Project Settings | `/projects/:id/settings` | Rename, API tokens, retention settings |
| Token Management | `/projects/:id/tokens` | Create, view (last 4 chars), revoke tokens |
| User Management | `/admin/users` | Invite, list, change role, deactivate (admin only) |
| Upload Report | `/upload` | Manual CTRF JSON file upload UI |

---

## Business Edition

The Business Edition is a commercially licensed superset of the Community Edition. It adds enterprise authentication, org-level governance, managed AI, and advanced analytics. All Community Edition features are included.

> **Licensing model:** Annual subscription per instance or per seat (TBD). Source-available under a Business Source License (BSL) or similar; reverts to MIT after a set period.

### Business Features

#### B1 — SSO / SAML / OIDC Authentication

- Single sign-on via SAML 2.0 or OIDC (Okta, Azure AD, Google Workspace, Keycloak).
- Just-in-time user provisioning on first SSO login.
- SCIM provisioning for automated user lifecycle management.
- Replaces email/password login (or runs alongside it, configurable).

**User stories:**
- As an engineering manager, I can configure SAML so that all team members log in with their company SSO credentials, so that I don't manage separate passwords for CTRFHub.
- As an IT admin, I can deprovision a user in our IdP and have their CTRFHub access revoked automatically via SCIM.

---

#### B2 — Full RBAC & Organization Management

- Custom roles beyond admin/viewer (e.g. project-owner, analyst, read-only).
- Organization-level hierarchy: org → teams → projects.
- Team-based access control: assign a team to a project, and all team members inherit access.
- Granular permissions: separate ingest, view, manage, and delete permissions.

**User stories:**
- As an engineering manager, I can create an "analyst" role that can view all projects and export data but cannot delete runs or manage tokens.
- As an admin, I can assign a team to a project so that onboarding new team members automatically grants them correct access.

---

#### B3 — Audit Log

- Immutable log of all administrative actions: user invitations, token creation/revocation, project deletion, role changes.
- Filterable by user, action type, and date range.
- Exportable as CSV for compliance reporting.

**User stories:**
- As a compliance officer, I can export an audit log of all token creation events in the last 90 days, so that I can demonstrate access control for a SOC 2 audit.

---

#### B4 — Managed AI (No BYOK Required)

- AI failure categorization powered by CTRFHub-managed models — no customer API key needed.
- Higher rate limits than the Community BYOK model.
- Advanced categorization with confidence scores and multi-label support.
- AI-generated failure summaries at the run level ("3 infrastructure failures, 2 assertion errors, 1 flaky test").

---

#### B5 — Advanced Flaky Test Detection

- Statistical flaky detection across run history (not just a single-run flag).
- Flakiness score (0–100) per test based on pass/fail alternation rate.
- Flaky test leaderboard: "Top 10 flakiest tests in the last 30 days."
- Automatic flaky suppression: option to exclude known-flaky tests from pass/fail gate calculations.

---

#### B6 — Executive Reports & Exports

- Scheduled PDF reports (weekly/monthly) delivered by email.
- CSV export of run history, test results, and flaky test data.
- Embeddable dashboard widgets (iframe or public link) for stakeholder sharing.

---

#### B7 — Notifications & Integrations

- Slack and Microsoft Teams webhooks: notify on run completion, failure threshold breach, or new flaky test detection.
- Webhook outbound events (generic HTTP POST) for custom integrations.
- Configurable per-project notification rules (e.g. "alert only if failure rate > 10%").

---

#### B8 — High Availability & Clustering

- Stateless app tier: multiple app containers behind a load balancer.
- Shared PostgreSQL (required; SQLite not supported in HA mode).
- Redis for session store and background job queue (replaces in-process nightly job).
- Helm chart for Kubernetes deployment.

---

### Business Screen Additions

| Screen | Route | Description |
|---|---|---|
| SSO Configuration | `/admin/sso` | SAML/OIDC setup, IdP metadata |
| Organization Settings | `/admin/org` | Org name, billing, SCIM token |
| Teams | `/admin/teams` | Create/manage teams, assign projects |
| Roles | `/admin/roles` | Custom role definitions and permissions |
| Audit Log | `/admin/audit` | Filterable event log with CSV export |
| Flaky Test Leaderboard | `/projects/:id/flaky` | Ranked flaky tests with scores |
| Report Scheduler | `/projects/:id/reports` | Configure and schedule PDF/CSV reports |
| Notification Rules | `/projects/:id/notifications` | Slack/Teams/webhook rule builder |

---

## Non-Functional Requirements

These apply to both editions unless noted.

### Performance
- Dashboard initial load: < 1 second for up to 10,000 stored runs (Community); < 1 second for up to 100,000 runs (Business).
- Run detail load: < 500 ms for runs with up to 5,000 tests.
- Memory footprint: < 500 MB RAM total on a single-container SQLite deployment (Community).
- Ingest endpoint: < 200 ms p99 for reports with up to 1,000 tests (excluding async AI categorization).

### Browser Support
Latest two versions of: Chrome, Firefox, Safari, Edge. No IE11.

### Accessibility
WCAG 2.1 Level AA for all dashboard and auth screens.

### Security
- API keys stored as bcrypt hashes; raw key shown only at creation time.
- All inter-service communication within the Docker network.
- TLS termination handled by the reverse proxy.
- `Authorization` header values never written to application logs.
- Business: SOC 2 Type II alignment (audit log, access control, encryption at rest).

### Reliability
- Community: single-instance, no HA requirement.
- Business: multi-instance HA via stateless app tier + Redis + PostgreSQL.
- Migrations transactional — a failed migration aborts startup cleanly.
- Graceful shutdown: in-flight requests complete before process exits.

### Observability
- Structured JSON logging via Pino.
- `LOG_LEVEL` env var controls verbosity (default: `info`).
- `/health` endpoint: `200 { status: "ok", db: "ok" }` for container health checks.

---

## Success Criteria

### Community MVP
1. A user can run `docker compose up`, upload a CTRF JSON from Playwright or Cypress, and see a dashboard with trends and AI insights — in under 10 minutes from a cold start.
2. The instance runs on a $5/month VPS (1 vCPU, 1 GB RAM) with PostgreSQL and remains responsive under 10 concurrent users.
3. The Playwright and Cypress reporters work with zero custom code beyond a one-line config addition.
4. The codebase passes TypeScript strict-mode checks and has > 70% test coverage on service-layer logic.
5. A new contributor can read `docs/planning/architecture.md` and run the dev environment within 30 minutes.

### Business Edition (first release)
1. SSO login works with Okta and Azure AD out of the box.
2. An org with 50 users, 20 projects, and 100,000 stored runs performs within the performance targets above.
3. Audit log captures 100% of administrative actions with no gaps.

---

## Competitive Landscape

| Tool | Model | CTRF-native | Self-hosted | Java-free | AI analysis | SSO |
|---|---|---|---|---|---|---|
| **CTRFHub Community** | Open source | ✅ | ✅ | ✅ | ✅ (BYOK) | ❌ |
| **CTRFHub Business** | Commercial | ✅ | ✅ | ✅ | ✅ (managed) | ✅ |
| Gaffer.sh | SaaS | ✅ | ❌ | ✅ | ❌ | — |
| Reporter Engine | Open source | ❌ | ✅ | ✅ | ✅ | ❌ |
| ReportPortal | Open source + EE | ❌ | ✅ | ❌ | ✅ | EE only |
| Allure Report | Open source | ❌ | ✅ | ❌ | ❌ | ❌ |
| Jenkins CTRF plugin | Open source | ✅ | ✅ | ❌ | ❌ | Via Jenkins |

CTRFHub is the only tool that is CTRF-native, self-hosted, Java-free, and AI-powered — in both editions. See `docs/planning/project-plan.md` for the full tool-by-tool breakdown.
