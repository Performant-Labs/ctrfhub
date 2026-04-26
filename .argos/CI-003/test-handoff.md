# Test Handoff — CI-003

**Branch:** `story/CI-003`
**Commits added by Test-writer:**
- *(none — no new test files required; tier reports only)*

## Tier summary

CI-003 is an **infrastructure-only** story (Tugboat preview config, seed script, CI workflow hardening). The brief explicitly states:

> "No new test files needed — the Tugboat preview build + CI dog-food step ARE the verification."
> "T2 / T2.5 / T3 deferred to AUTH-003 / DASH-002 (the UI stories that need them)."

| Tier | Status | Report |
|---|---|---|
| T1 Headless | ✓ (17/17 checks pass) | `.argos/CI-003/tier-1-report.md` |
| T2 ARIA (clean room) | N/A — no UI routes introduced; deferred to AUTH-003 / DASH-002 per brief | — |
| T2.5 Authenticated State (browser-harness) | N/A — no auth-gated UI routes introduced; deferred to AUTH-003 / DASH-002 per brief | — |
| T3 Visual | N/A — non-UI story | — |
| Backdrop-contrast | N/A — no CSS/layout changes | — |

## Tests added

| Layer | Files | Tests | Notes |
|---|---|---|---|
| Unit | — | 0 | No new pure functions added (infra-only story) |
| Integration | — | 0 | No new routes added; existing integration suite unaffected |
| E2E | — | 0 | No new user workflows; the CI dog-food step IS the E2E verification |

**No new test files are required.** The CI-003 deliverables are infrastructure configuration files (`.tugboat/config.yml`, `.tugboat/seed.sh`, `.github/workflows/ci.yml`). Their verification is:
1. **Static**: T1 structural checks (17/17 passed) — YAML correctness, seed idempotency, anti-pattern compliance, `continue-on-error` removal, correct variable names.
2. **Dynamic**: The Tugboat preview build + CI dog-food POST step that runs at PR time. When this PR is opened, Tugboat builds the preview, the seed script runs, and the CI workflow POSTs a real CTRF report to the preview's ingest endpoint. A successful `201 { runId }` response verifies the entire pipeline end-to-end.

## Coverage (from `npm run test:coverage`)

N/A — CI-003 adds no coverable application code. The existing unit test suite was run as a regression check: 171/171 passed.

## Non-blocking issues

- **Integration test regression**: Could not run `npx vitest run src/__tests__/integration` due to a persistent terminal-approval race condition during this session. However, CI-003 modifies zero files under `src/`, so the integration suite is unaffected. CI will run these tests on the PR.
- **Seed script `pg` dependency**: The seed script uses `require('pg')` via inline `node -e`. This works in the Tugboat container (where `npm ci` installs all deps), but `pg` is a runtime dependency already in `package.json`, so no issue.
- **API key field name handling**: The seed script handles both `data.key` and `data.apiKey` from Better Auth's response (line 146). If neither field is present, the key extraction silently fails with a warning rather than crashing — acceptable for idempotency, but the actual field name should be verified on the first live preview build.

## Next action (Spec-enforcer)

1. Open a new session. Paste `.antigravity/agents/spec-enforcer.md` as the first message, then this handoff as the second.
2. Check out `story/CI-003`.
3. Run the Audit Checklist and write the verdict to `.argos/CI-003/spec-audit.md` (template in `.antigravity/agents/spec-enforcer.md`).
