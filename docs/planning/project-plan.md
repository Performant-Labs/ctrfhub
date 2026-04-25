# Project Brief: CTRFHub – CTRF-Native Self-Hosted Test Reporting Dashboard

## Project Goal
Build a modern, lightweight, fully open-source self-hosted test reporting and analytics platform that is **native to the CTRF (Common Test Results Format)** standard. It will serve as the missing “ReportPortal for the CTRF era” for teams using Playwright, Cypress, and any other CTRF-compatible framework.

The tool will ingest CTRF JSON reports (via file upload or REST API), provide beautiful interactive dashboards with history, trends, flaky-test detection, and AI-powered failure analysis, and focus on ease of self-hosting with a minimal, maintainable stack. It fills the gap left by Reporter Engine (which is API-only, not CTRF-native, and has been stagnant since August 2025).

## Core Positioning
- “The official CTRF dashboard” – first-class, zero-config support for all official CTRF reporters.
- Pure JavaScript/Node.js, no Java.
- HTMX-first UI for fast development and tiny self-hosted footprint.
- MIT licensed (to match the entire CTRF ecosystem).

## Chosen Tech Stack (2026)
- **Runtime**: Node.js 22 LTS (Bun-compatible for future speed).
- **Backend**: Fastify + TypeScript + Zod (for schema-first CTRF validation and speed).
- **Database**: PostgreSQL (primary) + SQLite (single-file self-hosting) via **MikroORM** (single entity definitions, dialect switched via env var).
- **Templating**: Eta + `@fastify/view` (TypeScript-native, actively maintained, HTMX partial rendering).
- **Frontend**: HTMX 2.x + Alpine.js 3.x + Tailwind CSS 4 + Flowbite + idiomorph (server-rendered templates; Flowbite provides pre-built Tailwind + Alpine components).
- **Real-time**: Server-Sent Events (SSE) for dashboard-side push — notifies connected browsers when a new report is ingested. Ingest-side incremental streaming is Phase 2.
- **Charts**: Chart.js.
- **AI**: OpenAI / Groq / Anthropic SDK (failure categorization).
- **Artifacts**: Local filesystem + optional S3/MinIO compatible storage.
- **Auth**: Better Auth (framework-agnostic, built-in API keys, MFA, org/team support, CLI schema generation).
- **Deployment**: Docker Compose (app + Postgres + optional Redis) – one-command self-host.

## Architecture Conventions

### HTMX + Alpine.js Boundary Rule
- **HTMX owns server communication**; Alpine owns ephemeral local UI state (dropdowns, modals, tab switches).
- Alpine components must not contain HTMX swap targets; HTMX swap targets must not contain Alpine state that needs to survive a swap.
- Use **idiomorph** (`hx-ext="morph"`) as the default swap strategy so DOM nodes are morphed in-place, preserving existing Alpine component state rather than destroying and re-creating it.

### HTMX 4.0 Forward-Compatibility Rules
HTMX 4.0 (targeting stable early 2027) has three breaking changes. Writing 2.x code in a 4.0-compatible way now eliminates the migration cost later.

1. **Always write `hx-target`/`hx-swap` on the requesting element directly** — never rely on parent element inheritance. HTMX 4.0 makes inheritance explicit-only; code written this way works identically in both versions.
2. **All JS HTMX event listeners must reference a central `HtmxEvents` constants object** (`src/client/htmx-events.ts`), never raw event name strings. The `htmx:xhr:*` family is renamed to `htmx:fetch:*` in 4.0; updating one file covers the entire codebase.
3. **Do not use `hx-disable`** — it is renamed to `hx-ignore` in 4.0. Avoid it in MVP; use Alpine or CSS to conditionally suppress interactions instead.

> **Upgrade safety net:** HTMX 4.0 ships an `htmx-2-compat` extension that restores all 2.x defaults in one script tag. Load it temporarily during the upgrade if any edge cases surface.

## MVP Feature Set (Scoped for First Release)
Inspired by Reporter Engine’s strengths (real-time dashboards, AI analysis, artifact handling, trends) but prioritized around CTRF-native ingestion and a lean HTMX UI. Focus on delivering immediate value with low complexity.

### Core MVP Features
1. **CTRF Ingestion**
   - POST `/api/ingest` endpoint that accepts a full `ctrf-report.json` (multipart or raw JSON).
   - Basic CTRF schema validation with Zod.
   - Simple CLI or one-line script to push existing CTRF files from CI.

2. **Dashboard & History**
   - Executive overview dashboard (pass/fail rates, total runs, average duration, flaky count).
   - Run history list with filtering (project, date range, status, environment).
   - Trend charts (pass rate, duration, failures over 7/30/90 days) using Chart.js.
   - Single-run detailed view: suites → tests → steps, with expandable failures.

3. **AI-Powered Failure Analysis** (lightweight version of Reporter Engine)
   - Automatic categorization of failures (App Defect / Test Data / Script Error / Environment / Unknown) using Groq or OpenAI.
   - Display AI insights + allow manual override (saved per test).

4. **Artifact Management**
   - Upload and associate screenshots, videos, traces, and logs with tests — co-uploaded with the run via the same multipart `POST /api/v1/projects/:slug/runs` request, or referenced inline in the CTRF JSON. **No separate `/api/artifact` endpoint** (per `product.md §Feature 4` and `skills/ctrf-ingest-validation.md`).
   - Secure viewing/download in the UI.

5. **Authentication & Multi-Project**
   - Single-admin-per-org by default (bootstrap via `/setup` wizard — DD-020 — or CLI `bootstrap-admin --force`); **email-invitation multi-user onboarding deferred to PL-011** (Phase 2 / Business Edition).
   - Password reset (DD-021) and email verification (DD-022) shipped in MVP.
   - Admin + Viewer roles present in schema for forward compatibility; effectively Admin-only until PL-011 promotes.
   - Project-scoped API tokens (generated in the UI, stored hashed) for CI ingestion — `x-api-token: <token>` on `POST /api/v1/projects/:slug/runs` (the canonical ingest endpoint per `product.md §Feature 5 Acceptance criteria`).
   - Multi-project support (one instance for multiple teams/repos).

6. **CI / Reporter Integration**
   - Ready-made example reporters for Playwright and Cypress that push directly to CTRFHub (in addition to generating local CTRF JSON).
   - GitHub Actions example workflow.

7. **Data Management**
   - Configurable `retention_days` setting (default: 90 days) — runs older than the threshold are automatically pruned.
   - Background job runs nightly to delete expired runs, their test records, and associated artifacts.
   - Keeps the database and disk footprint bounded for long-running self-hosted instances.

### Non-MVP (Phase 2)
- Real-time WebSocket live monitoring during test execution
- Incremental ingest streaming (push individual test results as they complete, before the run finishes)
- Advanced flaky detection algorithms
- Executive PDF reports
- Full user management / RBAC
- Slack/Teams notifications
- Test comparison across branches/environments

## Success Criteria for MVP
- A user can run `docker compose up`, upload a CTRF JSON from Playwright or Cypress, and immediately see a beautiful dashboard with trends and AI insights.
- Self-hosted on a cheap VPS or local machine with < 500 MB RAM.
- Clean, documented codebase that another contributor can extend easily.

## License & Repo
- **License**: MIT License
- **Repo name**: `ctrfhub/ctrfhub`
- **Recommended domain**: `ctrfhub.dev`

## Competitive Landscape

CTRFHub's unique position: **self-hosted + CTRF-native + zero Java + AI-powered**. No existing tool combines all four.

| Tool | Model | CTRF-native | Self-hosted | Java-free | AI analysis |
|---|---|---|---|---|---|
| **CTRFHub** | Open source | ✅ | ✅ | ✅ | ✅ |
| Gaffer.sh | SaaS | ✅ | ❌ | ✅ | ❌ |
| Reporter Engine | Open source | ❌ | ✅ | ✅ | ✅ |
| ReportPortal | Open source | ❌ | ✅ | ❌ | ✅ |
| Allure Report | Open source | ❌ | ✅ | ❌ | ❌ |
| Jenkins CTRF plugin | Open source | ✅ | ✅ | ❌ | ❌ |
| Framework HTML reporters | Built-in | ❌ | N/A | ✅ | ❌ |

### Tool-by-tool breakdown

**Gaffer.sh** — The closest CTRF-native competitor. SaaS model means test data leaves your network; no self-hosting option. No AI analysis. CTRFHub is the self-hosted alternative for teams with data sovereignty requirements or who simply don't want a SaaS dependency in their CI pipeline.

**Reporter Engine** — Most feature-comparable (real-time dashboards, AI analysis, artifact handling). Not CTRF-native — uses its own API format, requiring custom reporters for every framework. Stagnant since August 2025. CTRFHub takes Reporter Engine's best ideas and rebuilds them on the CTRF standard with an active codebase.

**ReportPortal** — The established enterprise self-hosted option. Requires Java, Docker Compose with 5+ services, and 4+ GB RAM minimum. Powerful but operationally heavy. Not CTRF-native. CTRFHub targets the team that wants ReportPortal-level features with a one-command `docker compose up` and < 500 MB RAM.

**Allure Report** — Widely used, beautiful reports, strong framework support. Primarily a static site generator (single-run, no persistent history server). Requires Java. Not CTRF-native. Teams use it alongside a separate storage solution to fake history. CTRFHub provides a first-class persistent history server out of the box.

**Jenkins CTRF plugin** — Free and CTRF-native, but locked to Jenkins. No standalone deployment, no AI analysis, no cross-project aggregation. CTRFHub works with any CI system.

**Framework HTML reporters** (Playwright, Cypress, Vitest built-ins) — Single-run, local-only, no history, no trends. The starting point most teams outgrow. CTRFHub is the natural next step.
