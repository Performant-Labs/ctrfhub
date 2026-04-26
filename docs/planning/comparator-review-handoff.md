# Comparator Review — Hand-off Doc

**Status:** scoping complete in a prior session; this doc starts the work in a fresh Cowork session.
**Author of scoping:** Argos (Opus 4.7), 2026-04-26.
**Reason for hand-off:** Cowork has a UI bug where additional workspace folders can't be added once the session has started. The comparator clones must be mounted *before* the next Cowork session begins.

This doc is a one-shot working note for the next session, not a spec. Once the comparator review is complete and synthesised into `comparator-gap-review.md` (see § 5 below), this hand-off file can be deleted.

---

## 1. What we're doing and why

The goal is a feature-gap check: confirm that CTRFHub's MVP (as defined in `docs/planning/product.md` and the dependency-ordered backlog in `docs/planning/tasks.md`) isn't missing something important that comparable open-source test-reporting tools take as table-stakes.

**Depth of review André asked for:** a little deeper than surface-level — *verify the comparables' documented features against their actual code*, not just trust the marketing/docs pages. So we need local clones we can grep, not just web fetches.

**What this is NOT:** a recommendation to copy features from comparables. The CTRFHub MVP is deliberately scoped (see `docs/planning/parking-lot.md` for things explicitly deferred). The review's output is *findings*, routed through `docs/planning/gaps.md` per the standing rule — never unilateral spec changes.

---

## 2. Pre-flight checklist (do these BEFORE starting the new Cowork session)

### 2.1 Clone the comparables

Target location: `~/Projects/` as siblings of `ctrfhub`. Use the directory names below — the new session expects them. Use `--depth 1` everywhere; we don't need history for a feature-gap review and these are big Java repos.

**Important:** ReportPortal is a multi-repo system. The `reportportal/reportportal` repo is the docker-compose meta-repo with deployment YAML and docs — almost no source code. The actual application lives in separate repos (confirmed via the meta-repo's own README, § "Repositories structure"). Clone the curated subset below, not the whole org.

```bash
cd ~/Projects

# ReportPortal — multi-repo. Curated subset:
git clone --depth 1 https://github.com/reportportal/reportportal.git
git clone --depth 1 https://github.com/reportportal/service-api.git              reportportal-service-api
git clone --depth 1 https://github.com/reportportal/service-auto-analyzer.git    reportportal-service-auto-analyzer
git clone --depth 1 https://github.com/reportportal/migrations.git               reportportal-migrations

# Sorry Cypress — single repo
git clone --depth 1 https://github.com/sorry-cypress/sorry-cypress.git

# Allure 2 — single repo
git clone --depth 1 https://github.com/allure-framework/allure2.git
```

What each ReportPortal repo gives us:

- `reportportal/reportportal` — deployment topology, `docker-compose.yml`, official architecture diagram. Read for the high-level picture.
- `reportportal/service-api` — Java/Spring backend. Ingest API, business logic, JOOQ DAOs. Where the bulk of the "verify docs against code" deliverable lands.
- `reportportal/service-auto-analyzer` — Python ML failure-categorization service. Direct comparable to CTRFHub's AI pipeline (A1 categorize). High-value for `ai-features.md` comparison.
- `reportportal/migrations` — Postgres schema migrations. Direct comparable to `database-design.md`.

ReportPortal repos deliberately *not* cloned (don't reach for them):

- `service-ui` — React frontend. We're HTMX-server-rendered; UI-stack comparison is low signal for the gap-check.
- `service-authorization`, `service-jobs`, `service-index` — only relevant if a specific axis (auth, retention, health) needs deep code-level comparison; otherwise web-only is enough.
- `agent-*`, `client-*`, `logger-*` — per-framework reporter adapters. Backend gap-check doesn't depend on these.
- `plugin-bts-jira`, `plugin-bts-rally`, `plugin-saucelabs` — bug-tracker integrations. Out of MVP scope on our side.

(Optional, if you want code-level comparison too — otherwise the next session covers these via WebFetch:)

```bash
# git clone --depth 1 https://github.com/currents-dev/cypress-cloud.git
# git clone --depth 1 https://github.com/buildpulse/buildpulse-action.git
```

### 2.2 Mount them as Cowork workspace folders

In Cowork's folder picker, add each cloned directory as a workspace folder *before* opening the new session:

- `~/Projects/ctrfhub` (already mounted)
- `~/Projects/reportportal`
- `~/Projects/reportportal-service-api`
- `~/Projects/reportportal-service-auto-analyzer`
- `~/Projects/reportportal-migrations`
- `~/Projects/sorry-cypress`
- `~/Projects/allure2`

Verify the mount in the new session by asking it to `ls` each path. If a mount is missing, the UI bug forces another session restart — do not proceed without all seven visible.

### 2.3 (Optional) Tugboat / CI continuity

If `story/CI-003` is mid-flight when you start the new session, add a brief note to the next session prompt so it doesn't accidentally edit that story's working tree. The current uncommitted files on `story/CI-003` (as of this writing) are:

- `docs/planning/data-flow.md` — the document you asked me to draft earlier in this session
- `docs/planning/comparator-review-handoff.md` — this file
- `docs/planning/_write_probe.txt` — leftover diagnostic artifact, safe to delete

You may want to move all three off `story/CI-003` first. The host-side moves were sketched at the end of the data-flow follow-up.

---

## 3. Starter prompt for the new session

Paste this into the fresh Cowork session as the first message. It's self-contained — it references CLAUDE.md (auto-loaded) and this hand-off doc.

```
I want to do a feature-gap review of CTRFHub's MVP against three open-source
comparables that have been cloned into ~/Projects/ alongside ctrfhub.
ReportPortal is multi-repo, so it shows up as four mounts:

- ~/Projects/reportportal                          (meta-repo: deployment yaml + docs)
- ~/Projects/reportportal-service-api              (Java backend — primary code-dive)
- ~/Projects/reportportal-service-auto-analyzer    (Python ML categorization)
- ~/Projects/reportportal-migrations               (Postgres schema)
- ~/Projects/sorry-cypress
- ~/Projects/allure2

Please:

1. Read /Users/andreangelantoni/Projects/ctrfhub/docs/planning/comparator-review-handoff.md
   — that's the hand-off from the prior scoping session. It explains the goal,
   the review dimensions, the output format, and the constraints.

2. Read CLAUDE.md (auto-loaded), product.md, architecture.md, and tasks.md
   so you have CTRFHub's MVP scope in mind.

3. Propose a plan and the order you'd tackle the three comparables in,
   then wait for me to confirm before starting the actual review.

Do not edit anything in docs/planning/ besides creating the new files
specified in the hand-off doc's § 5. Do not modify gaps.md unilaterally —
flag findings, I'll route them.
```

---

## 4. Review dimensions

For each comparable, the next session should assess these axes against CTRFHub's MVP. The questions are framed so the answer is either "they have feature X, we don't, and it looks important" or "they have feature X, we don't, and it's correctly out-of-scope per parking-lot." Either answer is useful — the failure mode to avoid is "they have X, we don't, and we never noticed."

### 4.1 Ingest API
- API shape: REST? GraphQL? Custom? gRPC?
- Auth: API keys? OAuth? JWT? Header convention?
- Multipart vs. JSON for runs + artifacts
- Idempotency / duplicate-detection
- Multi-framework support: native CTRF? Per-framework adapters? Custom format?
- Rate limiting and abuse controls
- Async vs sync ingest (does the response wait for indexing/analysis?)

### 4.2 Data model
- Run/suite/test/step hierarchy depth
- Failure taxonomy / defect types
- Test history correlation across runs
- Artifact storage abstraction (local FS / S3 / blob)
- Multi-tenancy primitives (organization / project / team)
- Schema migration story

### 4.3 UI / dashboard
- Default landing screen (run list? dashboard? project list?)
- Trend chart vocabulary (pass rate, duration, flake rate, MTTR)
- Filter granularity (project / branch / env / commit / author / tag)
- Drill-down depth (run → suite → test → step → artifact)
- Compare-runs view
- Heatmap / matrix views
- Comment / annotation / triage workflow

### 4.4 Search
- Scope (runs only? tests? errors? comments?)
- Backend (DB FTS? Elasticsearch? Meilisearch? Algolia?)
- Query syntax (free text? structured? both?)
- Cross-org guards

### 4.5 AI / categorization
- Failure auto-categorization
- Root-cause clustering
- Run-level summaries
- Anomaly detection
- Provider model (BYOK / managed / both)
- Privacy / consent gating
- Determinism / reproducibility of results
- Cost transparency

### 4.6 Auth and access control
- Session auth (cookies? JWT?)
- API tokens (per-user? per-project? scoped?)
- SSO (SAML? OIDC?)
- Role model (org-level? project-level? per-resource?)
- Bootstrap / first-run flow
- Password reset / MFA

### 4.7 Real-time updates
- Live dashboard refresh on new runs (SSE? WebSocket? polling?)
- Cross-tab settings sync
- Connection capacity / fan-out limits
- Reconnect semantics

### 4.8 Notifications
- Webhooks (outbound)
- Email / Slack / Teams / PagerDuty integrations
- Per-user vs. per-channel preferences
- Quiet hours / dedup / batching

### 4.9 Self-hosting story
- Single-binary vs. multi-container
- Database options (Postgres-only? SQLite? MySQL?)
- Object storage requirement
- Reverse proxy story
- Backup / restore docs
- Upgrade / migration story
- Resource floor (smallest viable VPS)
- Documentation completeness

### 4.10 Operational features
- Retention / pruning
- Data export
- Audit logging
- Health endpoints / metrics / Prometheus
- Graceful shutdown
- Multi-replica / HA story

### 4.11 Manual testing (CTRFHub Business Edition territory)
- Test case management
- Test plans / cycles / runs
- Custom fields
- Manual-vs-automated reconciliation

---

## 5. Output format

The next session should produce these files. **Create new files only — do not modify existing files in `docs/planning/`** (the spec rule from CLAUDE.md).

### 5.1 Per-comparable findings

One file per comparable, capturing what was reviewed and what was found:

- `docs/planning/comparator-reportportal.md`
- `docs/planning/comparator-sorry-cypress.md`
- `docs/planning/comparator-allure2.md`

Each file should include:

1. **What was reviewed** — repo SHA reviewed, paths inspected, docs URLs read.
2. **Feature presence matrix** keyed off § 4 dimensions: present / partial / absent / N/A.
3. **Code-vs-docs reconciliation** — features the marketing/docs claim but the code doesn't actually deliver, or vice versa. This is the "little deeper than surface-level" deliverable André specifically asked for.
4. **Notable design choices** worth comparing against — particularly schema patterns, API contracts, and async-pipeline architecture.

### 5.2 Synthesis

One overarching synthesis doc:

- `docs/planning/comparator-gap-review.md`

Sections:

1. **Findings that should route into `gaps.md`** — features comparables have that CTRFHub MVP lacks AND the review thinks are important. For each finding: cite at least one comparable that has it, and a one-line rationale for why it's important rather than parking-lot material. Do not edit `gaps.md`; just propose the entries.
2. **Findings explicitly out-of-scope** — features comparables have that we deliberately don't, with a pointer to where in `parking-lot.md`, `product.md`, or a DD-* it's already declared out-of-scope. This is the "it's fine that we don't have X" pile.
3. **Open questions** — anything where the comparable's behavior surfaces an ambiguity in CTRFHub's spec (e.g., "ReportPortal does X; our spec doesn't say which way we go").
4. **Recommended next steps** — typically: 0–3 new MVP stories to add to `tasks.md`, 0–N entries for `gaps.md`, 0–N entries for `parking-lot.md`. Argos (or André) routes the actual edits.

---

## 6. Inherited constraints (from CLAUDE.md and prior memory)

The next session should already pick these up from CLAUDE.md and the persistent memory store, but call-outs:

- `docs/planning/*` is the **authoritative spec**. Do not modify existing files. Create new files freely.
- Sandbox virtiofs leaves stale `.git/index.lock` after writes from inside Cowork. If the next session needs to do any git operations, route them through the **claude-bridge** (`~/Projects/ctrfhub/.claude-bridge/req-*.sh`) — see `claude_bridge.md` memory entry.
- The Write tool can silently fail on large files (~20KB+). After every substantial write to `docs/planning/`, verify with a sandbox `ls -la` of the same path before declaring success — see `cowork_write_tool_silent_failure.md` memory entry.
- Branch state matters: another agent (Daedalus or Talos) may be on `story/CI-003` or another story branch. Don't `git checkout`, don't commit, don't push — leave branch operations to André.
- Flag gaps in `docs/planning/gaps.md` proposals only; don't edit `gaps.md` directly.
- Defer to the existing comparator-review prep in this doc — don't re-scope the project list unless André says to.

---

## 7. References

- `docs/planning/product.md` — MVP feature requirements
- `docs/planning/tasks.md` — dependency-ordered backlog with story-level test-tier declarations
- `docs/planning/parking-lot.md` — features explicitly deferred from MVP (feed for §5.2 part 2)
- `docs/planning/architecture.md` — stack and conventions
- `docs/planning/data-flow.md` — request lifecycles end-to-end (drafted in the same prior session as this doc)
- `docs/planning/database-design.md` — entity model and DD-* design decisions
- `docs/planning/ai-features.md` — AI pipeline definition
- CLAUDE.md — project context and forbidden-pattern list

---

## 8. Comparable URLs (full)

| Project | URL | Why on the list |
|---|---|---|
| ReportPortal | https://github.com/reportportal/reportportal | Direct competitor; CTRFHub literally pitches itself as "the ReportPortal for the CTRF era." Heavyweight enterprise feature set. Java/Postgres/Elasticsearch/RabbitMQ. |
| Sorry Cypress | https://github.com/sorry-cypress/sorry-cypress | Lean open-source dashboard. Single framework (Cypress), Node + MongoDB. Sets a *minimum* MVP bar — if Sorry Cypress doesn't have a feature, it's probably not table-stakes. |
| Allure 2 | https://github.com/allure-framework/allure2 | Allure pioneered failure-categorization UX. Allure 2 itself is a static report generator, not a dashboard, so its data model is what's interesting — particularly defect taxonomy and history correlation. |
| (Web-only) Currents.dev | https://currents.dev/docs | Closed-source but detailed public docs; useful for CI-integration breadth (frameworks supported, config UX). |
| (Web-only) BuildPulse | https://buildpulse.io/docs | Closed-source; specifically focused on flake detection, useful for benchmarking that one axis. |
| (Web-only) Datadog CI Visibility | https://docs.datadoghq.com/continuous_integration/ | Reference vendor; the maximum feature set we should know exists, even though we're not aiming there. |
