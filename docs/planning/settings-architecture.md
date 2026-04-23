# CTRFHub — Settings Architecture

Organized by **scope**: Personal → Organization → Project.
Settings are accessed from a unified settings area (gear icon in sidebar), same pattern as Testiny.
The URL context (`/settings/...` vs `/projects/:slug/settings/...`) determines which scope is active.

---

## Settings Navigation Structure

```
Settings
├── PERSONAL
│   ├── Profile
│   ├── Security
│   ├── Notifications
│   └── Personal API Keys
│
├── ORGANIZATION                        (admin / owner only)
│   ├── General
│   ├── Members
│   ├── Groups                          [Business Edition]
│   ├── Roles                           [Business Edition]
│   ├── SSO / Authentication            [Business Edition]
│   ├── Integrations
│   ├── Custom Fields
│   ├── Audit Log                       [Business Edition]
│   ├── Billing
│   ├── Support
│   ├── System                          (operational health — admin only)
│   └── About
│
└── PROJECT                             (per-project; from project settings)
    ├── General
    ├── Environments
    ├── CI Integration
    ├── Notifications
    ├── Webhooks
    └── Danger Zone
```

---

## 1. Personal Settings

### 1.1 Profile
*Testiny equivalent: My profile*

| Field | Type | Notes |
|---|---|---|
| Display name | Text | |
| Avatar | Image upload | Falls back to initials |
| Timezone | Dropdown | Used for timestamp display |
| Language | Dropdown | English only in MVP; hooks for i18n later |

**DB:** `users` table (managed by Better Auth) + `user_profiles` extension table for timezone/language.

---

### 1.2 Security
*Testiny equivalent: My account*

| Field | Notes |
|---|---|
| Change password | Current + new + confirm |
| Two-factor authentication (2FA) | TOTP setup (QR code + recovery codes) |
| Active sessions | Table of sessions with device/IP/last seen + "Revoke" per row |
| Revoke all other sessions | Bulk action |

**DB:** Managed by Better Auth (sessions table). 2FA secret stored per-user in Better Auth user table extension.

---

### 1.3 Notifications
*Testiny equivalent: (not present — CTRFHub addition)*

| Notification event | Channels |
|---|---|
| Run failed | Email, Slack DM |
| Run passed (after previous failure) | Email, Slack DM |
| Test result assigned to me | Email |
| Comment on a result I'm watching | Email |
| Weekly digest (pass rate trend) | Email |

Each event has an on/off toggle per channel.

**DB:** `user_notification_preferences` table — `(user_id, event_type, channel, enabled)`.

---

### 1.4 Personal API Keys
*Testiny equivalent: API keys*

| Field | Notes |
|---|---|
| Key name | Label for identification |
| Prefix preview | First 8 chars shown after creation |
| Created at | |
| Last used | |
| Revoke | Single-row action |

Personal keys are used for CLI/curl access. Project-level CI tokens (for ingest) live in Project → CI Integration.

**DB:** `personal_api_tokens` table — `(id, user_id, name, token_hash, last_used_at, created_at)`.

---

## 2. Organization Settings

### 2.1 General
*Testiny equivalent: Organization*

| Field | Notes |
|---|---|
| Organization name | Display name |
| Slug | URL identifier; editable with warning |
| Logo | Image upload |
| Default timezone | Fallback for members who haven't set their own |
| Plan / Edition | Read-only; shows "Community Edition" or "Business Edition" |

**DB:** `organizations` table (existing).

---

### 2.2 Members
*Testiny equivalent: User management*

| Field | Notes |
|---|---|
| Invite by email | Sends invite link; invited user appears as "Pending" until accepted |
| Role assignment | Admin \| Member \| Viewer (coarse roles; fine-grained in Roles [Business]) |
| Remove member | With confirmation modal |
| Member table | Name, email, role, joined date, last active |

**DB:** `organization_members` table — `(org_id, user_id, role, invited_at, joined_at)`.

---

### 2.3 Groups *(Business Edition)*
*Testiny equivalent: Group management*

Groups allow bulk-assigning project access and roles to a set of users.

| Field | Notes |
|---|---|
| Group name | |
| Members | Multi-select users |
| Project access | Which projects the group has access to + role per project |

**DB:** `groups` table + `group_members` junction + `group_project_access` junction.

---

### 2.4 Roles *(Business Edition)*
*Testiny equivalent: Role management*

Custom RBAC roles beyond the built-in Admin/Member/Viewer.

| Field | Notes |
|---|---|
| Role name | |
| Permissions | Checklist: view runs, upload runs, manage project settings, manage members, etc. |
| Assignable to | Members or Groups |

**DB:** `role_definitions` table + `role_permissions` table.

---

### 2.5 SSO / Authentication *(Business Edition)*
*Testiny equivalent: (implicit in auth settings)*

| Field | Notes |
|---|---|
| Provider | SAML 2.0 \| OIDC |
| Entity ID / Issuer URL | SAML config |
| SSO URL | IdP login URL |
| Certificate | PEM paste |
| Attribute mapping | email, name, groups |
| Enforce SSO | Toggle — disables password login when on |

**DB:** `sso_configurations` table — `(org_id, provider, config_json, enforced, created_at)`.

---

### 2.6 Custom Fields
*Testiny equivalent: Custom fields*

Unlimited user-defined metadata fields applied to `test_cases`, `test_results`, or `test_runs`. Defined once at org level and enabled per-project. CTRF ingest API can populate values as part of the run payload.

| Field | Notes |
|---|---|
| Name | User-defined label (e.g. "Jira Ticket", "Component", "Estimate") |
| Type | text \| integer \| decimal \| boolean \| date \| duration \| dropdown \| url |
| Applies to | test_case \| test_result \| test_run |
| Dropdown options | Ordered list of option strings (only for dropdown type) |
| Required | Toggle — enforces value entry in UI |
| Enabled | Toggle — hide from UI without deleting |
| In new projects | Toggle — auto-enable on newly created projects |
| Display order | Drag-to-reorder within entity type |

From the project side (Project → General or a dedicated tab), a project admin can enable/disable which org-level fields apply to their project.

**DB:** `custom_field_definitions` + `custom_field_values` + `project_custom_field_settings` tables.

---

### 2.7 Integrations
*Testiny equivalent: Integrations*

Org-level outbound integrations. Project-level webhooks are separate (Project → Webhooks).

| Integration | Config fields |
|---|---|
| **Slack** | OAuth app install or incoming webhook URL; default channel |
| **Jira** | Base URL, project key, API token; auto-create Jira issue on run failure (toggle) |
| **GitHub** | App install or PAT; post run status check to PR (toggle) |
| **PagerDuty** | Integration key; alert on N consecutive failures (threshold config) |
| **Email (SMTP)** | Host, port, credentials; used for all system emails; defaults to built-in |

**DB:** `org_integrations` table — `(org_id, integration_type, config_json, enabled, created_at)`.

---

### 2.8 Audit Log *(Business Edition)*
*Testiny equivalent: Audit log*

Read-only event log. Matches Testiny's implementation closely.

| Column | Notes |
|---|---|
| Timestamp | |
| Area | Data \| Authentication \| Settings \| Billing |
| By user | User display name (or `<System>` for automated events) |
| Operation | Create \| Update \| Delete \| Login \| Export |
| Details | Human-readable description + entity ID |

Features: filterable by area/user/date range, Export all (CSV), configurable retention (default 90 days).

**DB:** `audit_logs` table — `(id, org_id, user_id, area, operation, details, created_at)`.

---

### 2.9 Billing
*Testiny equivalent: Billing*

| Section | Notes |
|---|---|
| Current plan | "Community Edition — Free" or "Business Edition" |
| License key | Paste-in field for self-hosted Business license activation |
| License details | Seats, expiry, licensed to |
| Upgrade CTA | Link to purchase (Community → Business) |
| Invoice history | Managed externally (link out to billing portal) |

**DB:** `licenses` table — `(org_id, license_key_hash, plan, seats, expires_at, activated_at)`.

---

### 2.10 Support
*Testiny equivalent: Support*

Static page with links:
- Documentation (docs.ctrfhub.io)
- GitHub Issues
- Community Slack / Discord
- Contact email

No DB required.

---

### 2.11 System
*Testiny equivalent: none — CTRFHub addition*

Operational health dashboard for instance administrators. Accessible to org owners/admins only. All data is gathered fresh on each page load (no client-side caching). S3 artifact scan results are cached server-side for 5 minutes to avoid expensive bucket listings.

**Route:** `GET /org/settings/system`

#### Sections

**System Info**

| Field | Source |
|---|---|
| CTRFHub version | `package.json` `version` field |
| Edition | License check (Community / Business) |
| Node.js version | `process.version` |
| Uptime | `process.uptime()` formatted as `Xd Xh Xm` |
| PostgreSQL version | `SELECT version()` |
| Storage backend | `ARTIFACT_STORAGE` env var (`local` / `s3 (bucket-name)`) |
| Active SSE connections | In-memory `sseRegistry` count |

**Database Table Sizes** *(descending by size)*

Query from `pg_statio_user_tables` joined with `pg_class`. Shows the 8 largest application tables:

| Column | SQL source |
|---|---|
| Table name | `tablename` |
| Estimated rows | `reltuples::bigint` from `pg_class` |
| Table size | `pg_size_pretty(pg_relation_size(...))` |
| Index size | total − table |
| Total size | `pg_size_pretty(pg_total_relation_size(...))` |

Tables shown: `test_results`, `test_runs`, `test_artifacts`, `audit_logs`, `custom_field_values`, `test_result_comments`, `organizations`, `projects`.

Footer row: **Total DB size** — `SELECT pg_size_pretty(pg_database_size(current_database()))`.

**Artifact Storage**

Queried from the `test_artifacts` table (not filesystem scan — efficient and works for both local and S3):

```sql
SELECT
  artifact_type,
  COUNT(*) AS file_count,
  pg_size_pretty(SUM(size_bytes)) AS total_size,
  SUM(size_bytes) AS total_bytes
FROM test_artifacts
WHERE storage_type IN ('local', 's3')
GROUP BY artifact_type
ORDER BY total_bytes DESC;
```

External URL artifacts (`storage_type = 'url'`) shown in a separate row as a count only (no size — we don't know external file sizes).

**Disk Space** *(local storage only — hidden when `ARTIFACT_STORAGE=s3`)*

Checked with the `check-disk-space` npm package against `ARTIFACT_LOCAL_PATH`:

| Field | Value |
|---|---|
| Volume path | `/data/artifacts` |
| Total capacity | e.g. `500 GB` |
| Used | e.g. `142 GB (28%)` |
| Free | e.g. `358 GB` |

Progress bar rendered with CSS (no JS required): width = `used / total * 100%`. Bar turns amber at 70% used, red at 90%.

**Retention Policy**

| Field | Value |
|---|---|
| Org default | `{retention_days} days` (with link to General settings) |
| Last sweep ran | Timestamp from `system_events` log (deferred — PL-008) |
| Next scheduled | Next occurrence of `RETENTION_CRON_SCHEDULE` |

**DB:** Uses only existing `organizations.retention_days`. Historical sweep stats (PL-008) are deferred.

#### Growth estimate *(deferred to PL-008)*

"At the current ingestion rate, the disk will fill in approximately X months." Requires daily `system_snapshots` rows written by the nightly worker. Deferred to post-MVP.

#### Data security

- No credentials, connection strings, or secret env vars are exposed on this page
- S3 bucket name is shown; `S3_KEY` and `S3_SECRET` are never exposed
- Page requires org admin role; returns 403 for non-admins

---

### 2.12 About
*Testiny equivalent: About*

Read-only instance info:
- CTRFHub version (semver)
- Edition (Community / Business)
- Build SHA
- Node.js version
- Database version / connection status

No DB required; served from server-side environment variables.

---

## 3. Project Settings

Accessed via the project sidebar gear icon, or Settings → Projects → [select project].

### 3.1 General
*Testiny equivalent: Projects (partial)*

| Field | Notes |
|---|---|
| Project name | |
| Slug | Editable with warning (breaks existing URLs) |
| Run ID prefix | e.g. `E2E`; display IDs become `E2E-123` (see DD-006) |
| Base URL | Site under test |
| Description | |
| Default environment | Pre-selected in filter on Test Runs screen |

**DB:** `projects` table (existing, including `id_prefix`).

---

### 3.2 Environments
*Testiny equivalent: (CTRFHub addition)*

Managed list of environment names for this project. Not a hard FK — `test_runs.environment` remains free-text on ingest, but this list populates filter dropdowns and flags unrecognized values with a warning badge.

| Field | Notes |
|---|---|
| Name | e.g. staging, production, local, preview |
| Color | Pill badge color in the UI |
| Default | One environment marked as default for new runs |
| Active toggle | Hide deprecated environments from filters |

**DB:** `project_environments` table — `(id, project_id, name, color, is_default, active, created_at)`.

---

### 3.3 CI Integration
*Testiny equivalent: Automation*

The primary screen for connecting CI pipelines to CTRFHub.

| Section | Notes |
|---|---|
| Project API Token | Generate / rotate / revoke a project-scoped ingest token |
| Setup wizard tabs | GitHub Actions \| GitLab CI \| CircleCI \| Jenkins \| Generic curl |
| Each tab shows | Copy-paste YAML/shell snippet pre-filled with token + project endpoint |
| Ingest endpoint | Read-only display of `POST /api/v1/projects/:slug/runs` |
| Last ingest | Timestamp of last successful CTRF upload |

**DB:** `project_tokens` table — `(id, project_id, name, token_hash, last_used_at, created_at, revoked_at)`.

---

### 3.4 Notifications
*Testiny equivalent: (CTRFHub addition)*

Project-level notification rules, independent of personal notification preferences.

| Rule trigger | Config |
|---|---|
| Run failed | Notify Slack channel #xxx |
| Pass rate drops below N% | Notify Slack channel + email list |
| N consecutive failures on same test | Notify Slack + optionally create Jira issue |
| Run completed (always) | Webhook (see 3.5) |

Rules reference the org-level Integrations config for channel/token credentials.

**DB:** `project_notification_rules` table — `(id, project_id, trigger_type, threshold, integration_type, config_json, enabled)`.

---

### 3.5 Webhooks
*Testiny equivalent: (CTRFHub addition)*

Outbound HTTP callbacks on run events.

| Field | Notes |
|---|---|
| URL | Target endpoint |
| Events | run.completed \| run.failed \| result.assigned |
| Secret | HMAC signing secret for payload verification |
| Active toggle | |
| Recent deliveries | Last 10 delivery attempts with status + response code |

**DB:** `project_webhooks` table — `(id, project_id, url, events_json, secret_hash, active, created_at)`.
`project_webhook_deliveries` table — `(id, webhook_id, event, status_code, response_body, delivered_at)`.

---

### 3.6 Danger Zone

| Action | Confirmation required |
|---|---|
| Archive project | Type project slug; hides from lists, data retained |
| Delete project | Type project slug; permanently destroys all runs and results |
| Transfer ownership | Enter new owner email |

No new DB tables; uses soft-delete (`archived_at` on projects) or hard delete with cascade.

---

## Testiny → CTRFHub Mapping

| Testiny | CTRFHub | Scope | Notes |
|---|---|---|---|
| My profile | Profile | Personal | Direct carry |
| My account | Security | Personal | Renamed |
| API keys | Personal API Keys | Personal | Direct carry |
| Organization | General | Organization | Direct carry |
| Projects | Project > General | Project | Moved to project scope |
| User management | Members | Organization | Direct carry |
| Group management | Groups | Organization | Business Edition |
| Role management | Roles | Organization | Business Edition |
| Integrations | Integrations | Organization | Expanded (Slack, Jira, GitHub, PagerDuty, SMTP) |
| Custom fields | Custom Fields | Organization | Community; unlimited fields, 3 entity types |
| Automation | CI Integration | Project | Renamed; project-scoped token + YAML snippets |
| Audit log | Audit Log | Organization | Business Edition |
| Billing | Billing | Organization | License key model for self-hosted |
| Support | Support | Organization | Direct carry |
| About | About | Organization | Direct carry |
| *(not present)* | Environments | Project | CTRFHub addition |
| *(not present)* | Notifications (personal) | Personal | CTRFHub addition |
| *(not present)* | Notifications (project rules) | Project | CTRFHub addition |
| *(not present)* | Webhooks | Project | CTRFHub addition |
| *(not present)* | SSO / Authentication | Organization | Business Edition |

---

## New DB Tables Required by Settings

| Table | Settings screen | Edition |
|---|---|---|
| `user_profiles` | Profile | Community |
| `user_notification_preferences` | Personal > Notifications | Community |
| `personal_api_tokens` | Personal > API Keys | Community |
| `organization_members` | Organization > Members | Community |
| `org_integrations` | Organization > Integrations | Community |
| `custom_field_definitions` | Organization > Custom Fields | Community |
| `custom_field_values` | Organization > Custom Fields | Community |
| `project_custom_field_settings` | Organization > Custom Fields | Community |
| `licenses` | Organization > Billing | Both |
| `project_environments` | Project > Environments | Community |
| `project_tokens` | Project > CI Integration | Community |
| `project_notification_rules` | Project > Notifications | Community |
| `project_webhooks` | Project > Webhooks | Community |
| `project_webhook_deliveries` | Project > Webhooks | Community |
| `system_snapshots` | Organization > System | Community — deferred PL-008 |
| `groups` | Organization > Groups | Business |
| `group_members` | Organization > Groups | Business |
| `group_project_access` | Organization > Groups | Business |
| `role_definitions` | Organization > Roles | Business |
| `role_permissions` | Organization > Roles | Business |
| `sso_configurations` | Organization > SSO | Business |
| `audit_logs` | Organization > Audit Log | Business |
