# Comparator Review — Execution Plan

**Goal:** Produce one comparison document per comparable tool (vs CTRFHub's MVP spec), plus one synthesis document that pulls the most important findings into a thorough comparison table.

**Deliverables:**

| Phase | Output file | Description |
|---|---|---|
| 1 | `sorry-cypress.md` | Sorry Cypress comparison — the simplest comparable, sets the floor |
| 2 | `allure2.md` | Allure 2 comparison — static report generator, data model & categorization focus |
| 3 | `reportportal.md` | ReportPortal comparison — the direct enterprise competitor, deepest dive |
| 4 | `synthesis.md` | Cross-tool comparison table + gap findings + recommendations |

**Constraints:**
- No edits to existing `docs/planning/` files — new files in `docs/planning/comparisons/` only.
- Code-vs-docs verification: don't trust READMEs alone — grep the source to confirm claims.
- Findings that should route into `gaps.md` are proposed, not applied directly.

---

## Phase 1 — Sorry Cypress

**Why first:** Sorry Cypress is the simplest comparable — a lean Node.js dashboard for a single framework (Cypress). It sets the *minimum bar*: if Sorry Cypress has a feature, CTRFHub should at least have a position on it.

### 1.1 Review scope

| Dimension (from handoff §4) | Source in sorry-cypress repo | How to verify |
|---|---|---|
| **Ingest API** | `packages/director/` — look for route definitions, API schema | grep for route handlers, request schemas |
| **Data model** | `packages/common/` + MongoDB schemas in `director` | grep for schema/model definitions |
| **UI / dashboard** | `packages/dashboard/` — React app | scan component tree for chart types, filters, views |
| **Search** | grep across `packages/` for search endpoints | verify what fields are searchable |
| **AI / categorization** | Likely absent — confirm | grep for AI, categoriz, classify, ML |
| **Auth** | grep for auth, login, token, session | check docs + director source |
| **Real-time** | grep for SSE, WebSocket, polling, subscription | check director + dashboard wiring |
| **Notifications** | grep for webhook, slack, notify, email | check for outbound integrations |
| **Self-hosting** | `docker-compose.*.yml` files, README | count containers, check resource requirements |
| **Operational** | grep for retention, export, prune, health, metrics | check for maintenance features |

### 1.2 Output

`docs/planning/comparisons/sorry-cypress.md` with:
1. What was reviewed (paths inspected, docs read)
2. Feature presence matrix (present / partial / absent / N/A) across all §4 dimensions
3. Code-vs-docs reconciliation (features README claims but code doesn't deliver, or vice versa)
4. Notable design choices worth comparing against CTRFHub's approach

### 1.3 Checkpoint

**Pause** after completing `sorry-cypress.md`. Review with André before Phase 2.

Purpose: Sorry Cypress is the fastest review (~30 min). After completing it, we'll have a proven template and may want to adjust the depth or dimensions for the heavier comparables.

### 1.4 Phase 1 retrospective — dimensions added

Completing Sorry Cypress surfaced 6 comparison dimensions that weren't in the original scope tables. These are now added to the Phase 2 and Phase 3 scope tables below:

| New dimension | Why it matters | Discovered from |
|---|---|---|
| **Framework support breadth** | The single biggest differentiator — SC is Cypress-only, CTRFHub is any-framework via CTRF | SC's entire ingest API is Cypress wire protocol |
| **Execution model** | Orchestrator vs post-hoc reporter vs static generator — determines which features are N/A vs comparable | SC orchestrates runs; CTRFHub receives completed reports |
| **Attachment/artifact storage** | SC has 6 cloud storage drivers — a significant operational feature CTRFHub lacks | `director/src/screenshots/` — pluggable driver pattern |
| **Flaky detection mechanism** | Distinct from AI — some tools detect flakiness via rules or retries, not ML | SC tracks `flaky` count from Cypress retry data |
| **CI build grouping** | Grouping related runs from the same pipeline is a feature CTRFHub doesn't have | SC's `ciBuildId` concept |
| **Deployment dependency count** | More specific than "self-hosting" — the number of required containers/services is very revealing | SC requires 4 containers + MongoDB |

---

## Phase 2 — Allure 2

**Why second:** Allure 2 is a static report generator, not a dashboard — its value to this review is the *data model* (defect taxonomy, category definitions, history correlation) and the *report UX* (what information is displayed, how failures are categorized visually). These are directly comparable to CTRFHub's AI categorization (A1) and Run Detail page.

### 2.1 Review scope

| Dimension | Source in allure2 repo | How to verify |
|---|---|---|
| **Execution model** | Allure is a static report generator — confirm no server mode | check for HTTP/server code |
| **Framework support breadth** | Allure has adaptors for many frameworks — catalog which ones | check `allure-*` modules, docs |
| **Data model** | `allure-generator/src/main/java/io/qameta/allure/` — look for entity/model classes | grep for Category, Defect, TestResult, Status |
| **Defect taxonomy** | categories.json, defect classification logic | grep for defect, category, flaky, broken |
| **Flaky detection mechanism** | How does Allure detect/flag flaky tests? | grep for flaky, retry, rerun, unstable |
| **Report structure** | `allure-generator/` — the report generation pipeline | trace what sections/pages the generator produces |
| **History correlation** | grep for history, trend, retry, rerun | check how Allure links results across runs |
| **Plugin system** | `allure-plugin-api/` + `plugins/` | catalog what's pluggable |
| **UI/dashboard** | Built into the static report — HTML/JS output | look at generated report structure |
| **Search** | Likely in-browser search only | verify |
| **AI / categorization** | Likely absent — Allure uses rule-based categories | confirm rule-based vs ML |
| **Attachment/artifact storage** | How does Allure handle screenshots, logs, custom attachments? | grep for attachment, screenshot |
| **Auth / self-hosting** | Static report = no auth, no hosting | confirm there's no server mode |
| **Deployment dependency count** | Likely zero (static HTML) — confirm | check for required services |

### 2.2 Output

`docs/planning/comparisons/allure2.md` with the same structure as Phase 1 output.

### 2.3 Checkpoint

**Pause** after completing `allure2.md`. Review with André before Phase 3 (the big one).

---

## Phase 3 — ReportPortal

**Why last:** ReportPortal is the direct enterprise competitor and the deepest dive. It's a multi-repo Java/Spring system with its own ML auto-analyzer. This phase will take the longest.

### 3.1 Sub-phases

ReportPortal is big enough to break into sub-phases internally:

#### 3.1a — Architecture & deployment overview (~15 min)
- `reportportal/` meta-repo: `docker-compose.yml`, docs, architecture diagrams
- Count containers, map service topology, identify external dependencies (Postgres, Elasticsearch, RabbitMQ, MinIO)
- **Deployment dependency count** — compare to CTRFHub's single-container story and SC's 4-container stack
- **Execution model** — live ingest server vs post-hoc reporter? How do results arrive?

#### 3.1b — Ingest API & data model (~30 min)
- `service-api/src/main/java/` — look for REST controllers, DTOs, entity models
- **Framework support breadth** — which frameworks/languages have RP client agents?
- Map the `launch → suite → test → log/attachment` hierarchy vs CTRFHub's `run → result` model
- Check idempotency, auth on ingest, rate limiting, payload size limits
- **CI build grouping** — does RP have a concept for grouping launches from the same pipeline?
- `migrations/` — scan Postgres schema for table structure and compare to CTRFHub's `database-design.md`

#### 3.1c — AI / auto-analyzer (~20 min)
- `service-auto-analyzer/app/` — Python ML service
- Identify: what models does it use? How does it categorize? Is it LLM-based or traditional ML?
- **Flaky detection mechanism** — how does RP flag flaky tests? ML-based or rule-based?
- Compare to CTRFHub's A1–A4 pipeline design
- Check privacy/consent story, provider model, cost transparency

#### 3.1d — Auth, search, UI, real-time, notifications, operational features (~20 min)
- These are mostly service-api features — grep for the relevant patterns
- Auth: SSO, RBAC, project-level permissions
- Search: Elasticsearch integration
- Real-time: WebSocket/SSE
- Notifications: email, Slack integrations
- **Attachment/artifact storage** — how does RP store screenshots, logs, videos?
- Operational: retention, export, health, metrics

### 3.2 Output

`docs/planning/comparisons/reportportal.md` with the same structure as Phases 1–2.

### 3.3 Checkpoint

**Pause** after completing `reportportal.md`. Review with André before synthesis.

---

## Phase 4 — Synthesis

### 4.1 Inputs

- All three per-comparable documents
- CTRFHub spec: `product.md`, `architecture.md`, `ai-features.md`, `database-design.md`, `parking-lot.md`, `gaps.md`

### 4.2 Output

`docs/planning/comparisons/synthesis.md` containing:

#### Section 1: Master comparison table

A comprehensive comparison matrix with CTRFHub + 3 comparables across all dimensions (original §4 + 6 new dimensions from Phase 1 retro). Format:

| Dimension | CTRFHub MVP | Sorry Cypress | Allure 2 | ReportPortal |
|---|---|---|---|---|
| Execution model | Post-hoc ingest server | Run orchestrator | Static report generator | … |
| Framework support | Any (via CTRF) | Cypress only | … | … |
| Ingest API shape | REST (JSON + multipart) | … | N/A | … |
| Auth model | Session + API token | None | N/A | … |
| Flaky detection | Planned (AI-assisted) | Retry counter | … | … |
| Attachment storage | Local filesystem | 6 cloud backends | … | … |
| CI build grouping | Not yet | ciBuildId | … | … |
| Deployment deps | 1 container (Node+SQLite) | 4 containers + MongoDB | 0 (static HTML) | … |
| … | … | … | … | … |

#### Section 2: Findings that should route into `gaps.md`

Features comparables have that CTRFHub MVP lacks AND appear important. Each with:
- Which comparable(s) have it
- One-line rationale for why it matters
- Suggested priority (MVP-blocking vs Phase 2 vs parking lot)

#### Section 3: Findings explicitly out-of-scope

Features comparables have that CTRFHub deliberately doesn't, with a pointer to where in `parking-lot.md`, `product.md`, or a DD it's already declared out-of-scope.

#### Section 4: Open questions

Ambiguities in CTRFHub's spec surfaced by comparable behavior.

#### Section 5: Recommended next steps

0–3 new MVP stories, 0–N entries for `gaps.md`, 0–N entries for `parking-lot.md`.

### 4.3 Final checkpoint

Review synthesis with André. Route any approved findings into `gaps.md` / `tasks.md` / `parking-lot.md` via normal spec-change process.

---

## Web-only comparables (bonus, optional)

The handoff doc lists three closed-source tools for web-only review:

| Tool | Focus area |
|---|---|
| Currents.dev | CI-integration breadth, config UX |
| BuildPulse | Flake detection benchmarking |
| Datadog CI Visibility | Maximum feature set reference |

These can be done as a Phase 5 addendum to the synthesis if time permits, using `read_url_content` against their public docs. Not blocking on the core deliverables.

---

## Time estimates

| Phase | Estimated effort |
|---|---|
| Phase 1 (Sorry Cypress) | ~30 min |
| Phase 2 (Allure 2) | ~45 min |
| Phase 3 (ReportPortal) | ~90 min |
| Phase 4 (Synthesis) | ~45 min |
| **Total** | **~3.5 hours** |

Each phase ends with a checkpoint so we can adjust depth, dimensions, or approach as we go.
