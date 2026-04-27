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
- Re-posting the same payload within 24 hours with the same `Idempotency-Key` header returns `200 OK` with the original `{ runId }` and `X-Idempotent-Replay: true`, not a duplicate run (see DD-019). POSTs without the header always create a new run. A token with `ingest:replace` permission can force overwrite via `?on_duplicate=replace`.

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

**Scope note — MVP is single-admin-per-org by default.** Multi-user self-service onboarding (email invitations, role promotion/demotion, pending-invite lifecycle) is deferred to Phase 2 (Community) / Business Edition where SSO is the primary multi-user onboarding path — see **PL-011** in `parking-lot.md`. In MVP, additional admins can be created via `node dist/cli bootstrap-admin --email --password --force` as an operator escape hatch. The Admin / Viewer role distinction below remains in the schema for forward compatibility but is effectively "Admin only" in practice until PL-011 promotes.

**User stories:**
- As a solo developer, I can log in to my self-hosted CTRFHub with email + password, so that the dashboard isn't exposed unauthenticated.
- As a CI engineer, I can use a project-scoped token that only has permission to ingest into its assigned project, so that a compromised token has limited blast radius.
- As an admin, I can create multiple projects (one per repo or team) and generate separate API tokens per project, so that each team's data is isolated.
- *(Phase 2 / Business Edition — PL-011)* As an admin, I can invite users by email and assign them admin or viewer roles, so that access is controlled without exposing the instance publicly.
- *(Phase 2 / Business Edition — PL-011)* As a viewer, I can log in and see dashboards and run history but cannot create projects, generate tokens, or delete data.

**Acceptance criteria:**
- Email + password login; no OAuth required for Community MVP.
- Admin / Viewer roles exist in the schema; the Viewer role cannot access project settings, token management, or delete actions when present. *(PL-011 is required before viewers can be created through the UI; MVP creates admins only, via `/setup` and CLI.)*
- API tokens shown in plaintext exactly once (on creation); subsequently only the last 4 characters are shown.
- Tokens can be revoked from the project settings page.
- Additional admin users can be created via `node dist/cli bootstrap-admin --email <email> --password <pw> --force` (the `--force` flag is required once a user already exists — see DD-020).

**Password reset acceptance criteria (see DD-021):**
- `/login` page shows a "Forgot password?" link when SMTP is configured. The link navigates to `/forgot-password`, which accepts an email address and always returns the same `200 OK` page ("If an account exists for that email, a reset link has been sent") — response time, status, and body are identical whether the email exists or not (enumeration-safe).
- Reset tokens are 32-byte opaque values stored in the Better Auth `verification` table with `identifier='password-reset'` and a TTL of 1 hour. Tokens are single-use; a used or expired token on `/reset-password?token=` shows a generic "link invalid or expired" page with a link back to `/forgot-password`.
- A successful password reset invalidates all existing sessions for the user, auto-logs in the reset device (new session), and sends a "your password was just changed" notification email to the account's email address.
- When SMTP is not configured (`SMTP_HOST` unset): the "Forgot password?" link is hidden on `/login`, and a subdued footer note on `/login` reads "Lost your password? Run `node dist/cli reset-admin-password` inside the container, or ask another admin to reset it for you." `/forgot-password` returns `404` in this mode (route not mounted).
- Admins (role `Admin` within a shared organization) can reset another user's password from `/admin/users` via a row action. The action generates a one-time reset link (1-hour TTL, same token semantics as self-serve), displays it in a modal with a Copy button, and does not send an email. The admin is expected to deliver the link out-of-band.
- CLI subcommand `node dist/cli reset-admin-password --email <email> --password <password>` sets a new password directly in the DB without requiring SMTP. Refuses to act on a non-admin user unless `--force` is passed. Intended for last-resort recovery when no admin can log in.
- Rate limits: 10 requests/minute per IP on `/forgot-password`, plus a per-email cap of 3 requests/hour to prevent one user being flooded with reset emails.

**Email verification acceptance criteria (see DD-022):**
- Every user has a `users.emailVerified` boolean; nothing in the Community MVP is gated on its value — it is a signal, not a gate. Business Edition may add an org-level "require verification for writes" toggle post-MVP.
- A bootstrap admin created via the `/setup` wizard (Feature 0) is written with `emailVerified=false`. On every page load while unverified and while `SMTP_HOST` is set, a non-dismissible top-bar banner reads *"Verify your email to enable password reset — [Send verification email]"*.
- A user created via admin invite (invite-token acceptance flow — **deferred to PL-011**) will be written with `emailVerified=true` in the same transaction that consumes the invite and sets the password. No separate verification email is sent — the invite-link click proves email receipt. In MVP, the only user-creation surfaces are the `/setup` wizard and the CLI `bootstrap-admin` command; both create admins with `emailVerified=false` (the banner-nudge path).
- Clicking "Send verification email" (from the banner or from the `/admin/users` row action) calls `POST /api/v1/account/verify-email/send`, which creates a Better Auth `verification` row with `identifier='email-verification'`, `expiresAt=now+24h`, and emails the user a link to `/verify-email?token=<32-byte-hex>`. Response is always `200 OK` (enumeration-safe).
- Visiting `/verify-email?token=...` with a valid, unexpired, unconsumed token atomically sets `users.emailVerified=true`, deletes the `verification` row, and redirects to `/` with a flash toast "Email verified." Expired or consumed tokens render a generic "link invalid or expired" page — no distinction between the two cases.
- When SMTP is not configured (`SMTP_HOST` unset): the top-bar banner is hidden for all users, `POST /api/v1/account/verify-email/send` is unmounted (returns `404`), and the `/admin/users` resend row action is not rendered. `GET /verify-email?token=...` remains mounted so that links mailed during a past SMTP-configured period still work.
- `/admin/users` shows an "Email verified" column (green dot for true, grey dot for false) and a row-action "Resend verification email" that uses the same endpoint as the self-serve banner. Admin-triggered resends share the per-user 3/hour rate limit.
- Rate limits: 3 requests/hour per user and 10 requests/minute per IP on `POST /api/v1/account/verify-email/send`.

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

#### Feature 0 — First-Boot Setup Wizard

**Goal:** Take a fresh `docker compose up` instance (empty DB, no users) to a working single-admin-single-org-single-project state in one guided flow, without requiring the operator to hand-configure env vars or run CLI commands.

**User stories:**
- As a solo developer, I can bring up a fresh CTRFHub container, open it in my browser, and be walked through creating my admin account, organization, and first project — without reading the docs first.
- As an ops engineer deploying via Kubernetes or Terraform, I can set `CTRFHUB_INITIAL_ADMIN_*` env vars in my deployment manifest and have the instance come up already set up — no interactive wizard step.
- As an operator who has lost the only admin password and cannot configure SMTP for a reset, I can run a CLI command inside the container to create a new admin without wiping the DB.

**Flow (primary path — web wizard):**

Four steps matching the Gaffer reference design (dark theme, accent green, horizontal progress indicator). Each step commits immediately so a browser crash mid-flow can be resumed from the furthest-advanced point. The wizard is the default — users hitting any other route on a fresh instance are `302`'d to `/setup`.

1. **Create your admin account** — email, password (min 12 chars, strength indicator), display name. On submit: row inserted into Better Auth `users` table with `emailVerified=false` (see DD-022 — admin is nudged to verify via a top-bar banner after wizard completion, not forced to verify inside the wizard since SMTP may not yet be configured); the wizard's subsequent steps are authenticated as this user.
2. **Create your organization** — name (e.g. "Performant Labs"), slug (URL-safe, auto-generated from name, editable before first save). On submit: row in `organizations`, plus `organization_members` row binding the admin as `role='Admin'`.
3. **Create your first project** — name (e.g. "Nightly Hermes Tests"), description (optional), slug. On submit: row in `projects`, plus an auto-generated project token shown on the next step.
4. **Set up your CI/CD** — framework dropdown (Playwright / Cypress / Jest / Vitest / Other), upload token displayed once in a "Save this token now" warning banner with a Copy button, integration-example tabs (GitHub Actions / GitLab CI / CircleCI / Jenkins / curl) showing copy-paste snippets pre-filled with the token and ingest URL. "Complete Setup" lands the user on the dashboard's "Waiting for your first test report" empty state.

**Alternative paths:**

- **Env-var seed** (for headless deploys): if `CTRFHUB_INITIAL_ADMIN_EMAIL`, `CTRFHUB_INITIAL_ADMIN_PASSWORD`, and `CTRFHUB_INITIAL_ORG_NAME` are set at boot **and** the `users` table is empty, the migration routine creates user + org in a single transaction. Optional: `CTRFHUB_INITIAL_PROJECT_NAME` creates a first project too. The wizard is never shown; `/setup` returns `410 Gone` from the first request. A warning is logged telling the operator to unset `CTRFHUB_INITIAL_ADMIN_PASSWORD` after boot.
- **CLI recovery**: `node dist/cli bootstrap-admin --email ... --password ...` creates a new admin user. Refuses if any user already exists unless `--force` is passed. Used when the instance is up but login is impossible (lost password, no SMTP).

**Acceptance criteria:**
- A fresh `docker compose up` followed by opening the host URL in a browser lands on `/setup` step 1 within 30 seconds.
- All non-`/setup`, non-`/health`, non-static routes return `302 → /setup` while `users` is empty.
- Once the admin user exists, `/setup` returns `410 Gone` forever — no re-bootstrap possible via HTTP. (Implementation: `SELECT COUNT(*) FROM users > 0` gates the route; no dedicated "setup complete" flag needed in MVP.)
- Setting `CTRFHUB_INITIAL_ADMIN_EMAIL` + `CTRFHUB_INITIAL_ADMIN_PASSWORD` + `CTRFHUB_INITIAL_ORG_NAME` in the compose file causes the instance to boot already set up; the wizard is never shown.
- After a completed wizard, the dashboard shows the Gaffer-style "Waiting for your first test report" empty state with a Quick start block pointing at project settings and a `curl` snippet.
- The wizard is abandonment-safe: refreshing or closing the browser in step 3 does not leave partial state — the admin + org from earlier steps exist and the user can log in and resume from the project step via a "Finish setup" nudge on the dashboard.

**Security note.** While the `users` table is empty, `/setup` is reachable unauthenticated — anyone with network access can be the first admin. The self-hosting README directs operators to bring the instance up on localhost or a private network for the initial session. Operators who must expose the instance publicly before first login can set `CTRFHUB_SETUP_TOKEN=<value>` — `/setup` then requires `?token=<value>`. Off by default (adding a token gate to the default path is friction for the 99% case of laptop-first bring-up).

See DD-020 in `database-design.md` for the full state machine (route gating, wizard step commits, env-seed precedence, CLI recovery) and the reason for picking a guided wizard over a first-login-is-admin shortcut.

---

#### Feature 7 — Data Management

**Goal:** Keep the database and disk footprint bounded for long-running self-hosted instances, give admins a clean "delete this project" escape hatch, and let users export run data in the same CTRF-native format it arrived in.

**User stories:**
- As a self-hoster, I can configure a retention period so that old runs are automatically pruned and disk space doesn't grow unboundedly.
- As an admin, I can manually delete a specific run from the UI.
- As an admin, I can delete an entire project along with all its runs, test results, and artifacts, so that decommissioned projects don't clutter the dashboard or consume disk space forever.
- As any authenticated user with read access to a run, I can export the run as CTRF JSON or as a ZIP archive with artifacts, so that I can share it, archive it, or re-ingest it into another CTRFHub instance.

**Acceptance criteria:**
- `RETENTION_DAYS` env var controls the pruning window (default: 90 days).
- A background job runs nightly and deletes runs older than the threshold, along with their test records and artifacts.
- Manual run deletion from the UI shows a confirmation dialog and completes within 2 seconds for runs with up to 10,000 tests.
- Pruning job logs the number of runs and artifacts deleted to the application log.

**Project-delete acceptance criteria (see DD-023):**
- `/projects/:id/settings` has a "Danger zone" section with a **Delete project** button visible only to Admins in the project's org.
- Clicking it opens a confirmation modal that shows the project name, a live blast-radius summary (*"847 runs, 52,103 tests, 14.2 GB of artifacts"*), and a text input requiring the user to type the project slug exactly (case-sensitive) before the Confirm button enables.
- Confirming triggers `DELETE /api/v1/projects/:slug?acknowledge=true`. Server-side: FK cascades delete `test_runs`, `test_results`, `test_result_tags`, `test_result_comments`, `test_result_artifacts`, `ai_pipeline_log`, `ingest_idempotency_keys`, `project_tokens`, `project_webhooks`, `webhook_deliveries`, `project_slug_aliases`, and Business-Edition `milestones`/`test_plan_entries` in a single transaction. After commit, artifact files (local FS or S3) are unlinked; failures log `event=artifact.unlink_failed` but do not fail the request.
- Delete is hard — no soft-delete / recovery window (MVP accepts that self-hosted operators take their own backups).
- Rate-limited to 5 requests/hour per admin.

**Per-run export acceptance criteria (see DD-023):**
- `GET /api/v1/runs/:id/export.json` returns an `application/json` response containing the original CTRF payload (preserved as ingested) plus a `ctrfhub` metadata envelope carrying AI categorizations, manual overrides, comments, and artifact URLs. The export is round-trippable — it can be re-ingested into another CTRFHub instance.
- `GET /api/v1/runs/:id/export.zip` streams a `.zip` containing `manifest.json`, the JSON export, and every linked artifact file (S3-backed artifacts are fetched server-side and streamed into the archive for self-containment).
- Both endpoints respect project-level read authorization and are exposed as **Export as JSON** / **Export as ZIP** buttons on the run detail page.
- Filenames follow `run-<runId>-<YYYYMMDD>.{json|zip}` via `Content-Disposition: attachment`.
- Covered by the general authenticated-API rate limit — no dedicated per-export cap.

**Out of scope in MVP (deferred):**
- Org delete is deferred to "drop the Docker volume" (MVP is single-org-per-instance — see PL-011 scope reduction).
- User account delete is deferred to PL-011 alongside the invite flow.
- CLI bulk export (per-project or instance-wide tarball) is deferred to PL-012; MVP operators use `pg_dump` / SQLite file copy for disaster recovery.
- Orphaned-artifact reconciliation (nightly sweeper that catches post-delete unlink failures) is deferred to PL-013; MVP uses cascade-only cleanup with `artifact.unlink_failed` logs as the detection signal.

---

### Community Phase 2

| Feature | Reason deferred |
|---|---|
| Incremental ingest streaming (push individual test results as they complete) | Requires persistent connection management |
| Real-time WebSocket live monitoring during test execution | Depends on incremental ingest |
| Basic flaky detection (multi-run correlation) | Needs run history depth to be meaningful |
| Slack / Teams / Discord / email / PagerDuty native adapters | Generic signed HTTP webhook ships in MVP (DD-018); native adapters, ChatOps, digest mode, and per-user DM preferences captured in PL-009 |
| Test comparison across branches / environments | Needs UX research |

---

### Community Screen Inventory (MVP)

| Screen | Route | Description |
|---|---|---|
| Setup Wizard | `/setup` | First-boot only. 4-step wizard: admin account → organization → first project → CI/CD setup. Returns 410 Gone once `users` is non-empty. See Feature 0. |
| Login | `/login` | Email + password form |
| Dashboard | `/` | Overview stats, trend charts, recent runs |
| Run List | `/runs` | Filterable, paginated list of all runs |
| Run Detail | `/runs/:id` | Suite → test tree with expandable failures and artifacts |
| Project List | `/projects` | All projects (admin: manage; viewer: view) |
| Project Settings | `/projects/:id/settings` | Rename, API tokens, retention settings |
| Token Management | `/projects/:id/tokens` | Create, view (last 4 chars), revoke tokens |
| Integrations | `/projects/:id/integrations` | Add/remove outbound webhooks; inline last-5 delivery log per webhook (DD-018) |
| User Management | `/admin/users` | **MVP:** list admins, view active sessions per user, trigger password reset (admin-initiated from DD-021), trigger email-verification resend (DD-022). **Invite / change-role / deactivate deferred to PL-011** — when promoted, this screen gains the "Invite user" button and the "Pending invites" section. |
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

### Viewport posture
CTRFHub is a desktop application. Design target is 1280×800 CSS px and wider. The viewport meta tag pins the rendered width so mobile browsers show the desktop layout at zoom (Datadog / Snyk / CircleCI posture). Mobile and tablet users can view any run, drill into any failure, and follow any notification link; they'll pinch-zoom. No drawer navigation, no column-priority hiding, no mobile-specific UI work in MVP. Screen markup is authored mobile-first (Tailwind responsive utilities as the authoring convention, Flowbite components at their responsive defaults, tables in `overflow-x-auto` wrappers) so promotion to mobile-degraded-functional becomes a QA-and-polish effort rather than a rewrite — but the product commitment and the QA target remain desktop-only. WCAG 2.1 AA accessibility minimums still apply (24×24 CSS px interactive elements). See DD-030 for the decision record; promotion to mobile-degraded-functional is tracked in PL-019.

### Accessibility
WCAG 2.1 Level AA for all dashboard and auth screens.

### Security
- API keys stored as bcrypt hashes; raw key shown only at creation time.
- All inter-service communication within the Docker network.
- TLS termination handled by the reverse proxy.
- `Authorization` header values never written to application logs.
- **User-uploaded artifacts are treated as adversarial content (DD-028).** Playwright HTML reports and `text/html` attachments render in an opaque-origin iframe sandbox (no `allow-same-origin`) so report scripts cannot read session cookies or call CTRFHub APIs as the logged-in user. Active content types (HTML, SVG, XML, PDF) download by default rather than rendering inline. Every uploaded file is magic-bytes-validated against its claimed `Content-Type` at ingest. Operators wanting GitHub-grade cookie-jar isolation can serve artifacts from a separate origin via `ARTIFACT_PUBLIC_URL`.
- Business: SOC 2 Type II alignment (audit log, access control, encryption at rest).

### Reliability
- Community: single-instance, no HA requirement.
- Business: multi-instance HA via stateless app tier + Redis + PostgreSQL.
- Migrations transactional — a failed migration aborts startup cleanly.
- Graceful shutdown: in-flight requests complete before process exits.

### Observability
- Structured JSON logging via Pino to stdout.
- `LOG_LEVEL` env var controls verbosity (default: `info`).
- `/health` endpoint returns:
  ```json
  {
    "status": "ok",
    "bootState": "ready",
    "db": "ok",
    "startedAt": "2026-04-22T04:12:33.000Z",
    "uptimeSec": 12847,
    "version": "0.8.2",
    "commit": "a3f0c9d"
  }
  ```
  Status codes follow the DD established in the migration-race resolution (`503` during `booting`/`migrating`, `200` only when `bootState=ready` and all downstream checks pass). `startedAt` / `uptimeSec` / `version` / `commit` are zero-cost additions useful for operator sanity-checking and debugging. `bootState` is surfaced for external health monitors that want more than "up/down."
- `Authorization` header values and API-token payloads never written to application logs.
- Additional observability surface (Prometheus `/metrics`, request-ID correlation, Sentry integration, full log-redaction deny-list, slow-query logging, shipped Grafana dashboards) deferred to **PL-014** — MVP ships the log-to-stdout + enriched-`/health` baseline; operators who need more bring their own stack.

### Timezone Handling

Full contract in DD-025. Product-facing summary:

- **Storage and on-wire format is UTC.** Every timestamp is stored as `TIMESTAMPTZ` (Postgres) or ISO 8601 UTC TEXT (SQLite) and serialized with explicit `Z` (`"2026-04-22T14:23:00.481Z"`) in every API response, webhook payload, export file, log line, and CLI message.
- **Display timezone resolves user → org → env → UTC.** `users.settings.timezone` (IANA) wins, falling back to `organizations.settings.default_timezone`, then to the instance `DEFAULT_TIMEZONE` env var, then to `UTC`. Only IANA zone identifiers accepted (`America/Los_Angeles`, never `PST`).
- **Surfaces split by audience.** Dashboard, run detail, charts, and personal emails render in the viewer's TZ. Retention cron cutoffs and System Status timestamps render in the org's TZ (operational coherence for admins). Exports, webhook payloads, API JSON, CLI output, and logs are UTC (machine-readable, locale-free).
- **"Last 7 / 30 / 90 days" filters resolve in user TZ** — `[start-of-day-in-user-TZ − N days, now]`. Chart X-axis buckets land on user-TZ midnight, so a Singapore viewer and a Berlin viewer looking at the same org see different buckets for the same runs (correct — "yesterday" is different for each of them).
- **Browser TZ is detected at `/setup` Step 2** and pre-fills `default_timezone`. New users get a one-shot dismissable banner on first dashboard load if the browser TZ differs from the effective TZ.
- **Luxon is the single rendering library** — MIT-licensed, actively maintained, DST-correct, relative-time (`3 hours ago`) built in.

### Backup & Recovery

Data preservation is operator-managed; CTRFHub ships a runbook rather than a bespoke backup CLI. Full contract in DD-026; operator steps in `docs/ops/backup-and-restore.md`. Product-facing commitments:

- **Standard tools, not a bespoke CLI.** Operators run `pg_dump`, `sqlite3 .backup`, and `tar`/`rsync` — tools already in their toolkit. A first-class `ctrfhub backup` CLI is deferred to PL-016 until the lack of one demonstrably pains operators.
- **Three documented recipes.** Postgres + local artifacts (stop-service + `pg_dump -F c` + `tar`), Postgres + S3 (`pg_dump` only — S3 handles artifact durability per Mattermost's validated posture), SQLite (stop-service + `sqlite3 .backup` + `tar`). Each is 6–10 shell lines with full commands.
- **Seven-step restore runbook.** Stop service → restore DB → restore artifacts → version-compatibility check → start → `/health` verification → smoke test. Order is specified (DB before artifacts) so operators who skip steps fail loudly instead of corrupting silently.
- **Downgrade via the newer binary running the rollback.** Taken from Mattermost: to downgrade vB → vA, run `ctrfhub migrate:down --to <vA>` with the **newer** binary, then swap in the older binary. MikroORM's up/down migration pairs make this work.
- **Startup version guardrail.** App refuses to start when database schema version exceeds what the binary expects. Prevents the silent-data-loss failure mode where an older binary ignores columns it doesn't recognize. Mattermost documents this verbally; CTRFHub enforces at boot.
- **Encryption is operator responsibility.** Backups are plaintext; operators encrypt with `gpg`/`age`/SSE-KMS per their security posture. CTRFHub documents exactly what's in a dump (user PII, stack traces, webhook URLs, hashed tokens, raw CTRF JSON) so operators can make informed choices.

### API Compatibility

CTRFHub's HTTP API is the contract CI pipelines depend on. The rules are documented in DD-024; the product-facing summary:

- **URL prefix `/api/v1/` is a stability commitment.** Existing fields keep their names, types, and semantics; request validation stays backward-compatible; status codes and auth requirements on existing endpoints do not change.
- **Additive changes** (new fields on responses, new optional request fields, new endpoints, new query parameters with safe defaults) ship in minor releases at any time.
- **Breaking changes** require a v2. When v2 ships, `/api/v1/*` keeps serving for at least **6 months**, carrying `Deprecation: true` + `Sunset: <date>` headers on every response during the overlap. After sunset, v1 endpoints return `410 Gone` with a pointer to the migration guide — not `404`, which is ambiguous with "you typoed the slug".
- **Deprecated endpoint hits are logged and surfaced on the admin dashboard** so operators can see which CI pipelines still need migration before the sunset date.
- **Webhook payload shapes are versioned separately** from the URL API (`"version": "1"` in the payload; pinned per webhook in `project_webhooks.payload_version`). Chat-ops integrations and CI pipelines have different change-tolerance profiles — the envelope version decouples them.
- **HTMX-only partial endpoints live under `/hx/*`, not `/api/v1/*`.** They are internal to the server-rendered dashboard and can change freely between releases. Callers that think they need to hit `/hx/*` programmatically should ask for an `/api/v1/*` equivalent instead; a `/hx/*` response without the `HX-Request: true` header may return `400`.
- **OpenAPI spec** is deferred to PL-015. Minor risk of accidental breaks slipping past code review until then — acceptable at MVP scale with zero external users.

**Complete `/api/v1/` surface (Community MVP):**

| Method | Endpoint | Auth | Story |
|---|---|---|---|
| `POST` | `/api/v1/projects/:slug/runs` | `x-api-token` (project-scoped) | CTRF-002 ✅ |
| `GET` | `/api/v1/projects` | session or `x-api-token` (org-level read) | API-001 |
| `GET` | `/api/v1/projects/:slug` | session or `x-api-token` | API-001 |
| `GET` | `/api/v1/projects/:slug/runs` | session or `x-api-token` (project-scoped) | API-001 |
| `GET` | `/api/v1/projects/:slug/stats` | session or `x-api-token` (project-scoped) | API-001 |
| `GET` | `/api/v1/runs/:id` | session or `x-api-token` (project-scoped) | API-001 |
| `GET` | `/api/v1/runs/:id/export.json` | session or `x-api-token` | DATA-001 |
| `GET` | `/api/v1/runs/:id/export.zip` | session or `x-api-token` | DATA-001 |
| `GET` | `/api/v1/search` | session | SRCH-001 |
| `DELETE` | `/api/v1/projects/:slug` | session (admin) | SET-001 |
| `DELETE` | `/api/v1/runs/:id` | session (admin) | DATA-001 |

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
