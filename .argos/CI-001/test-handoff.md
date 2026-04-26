# Test Handoff — CI-001

**Branch:** `story/CI-001`
**Commits added by Test-writer:** none — this story added no application code, so no test files were authored.

---

## Tier summary

| Tier | Status | Report |
|---|---|---|
| T1 Headless | ✓ | `.argos/CI-001/tier-1-report.md` |
| T2 ARIA (clean room) | N/A — infrastructure-only story, no rendered UI | N/A |
| T2.5 Authenticated State (browser-harness) | N/A — infrastructure-only story, no rendered UI | N/A |
| T3 Visual | N/A — no UI changes | N/A |
| Backdrop-contrast | N/A — no layout/CSS changes | N/A |

---

## Tests added

| Layer | Files | Tests | Notes |
|---|---|---|---|
| Unit | — | 0 | No new pure functions shipped in this story |
| Integration | — | 0 | No new Fastify routes shipped in this story |
| E2E | — | 0 | E2E spec directory is intentionally empty (noted in feature-handoff); Playwright returns exit 0 on "no tests found" |

**Rationale:** CI-001 delivered only infrastructure artefacts (`Dockerfile`, `.dockerignore`, `.github/workflows/ci.yml`, `.github/workflows/release.yml`). No files under `src/` were touched. There are no new pure functions, no new routes, and no new UI surfaces — the Three-Tier Verification Hierarchy was applied at T1 only, which is the correct and complete scope for an infrastructure story.

---

## Existing test coverage (unaffected by CI-001)

`npm run test:unit` — **148 passed**, 0 failed (6 files) in 1.38 s  
`npm run test:int` — **62 passed**, 0 failed (3 files) in 2.58 s  
Total: **210 tests green**, no regressions introduced.

Coverage thresholds measured against application code — unchanged from prior stories. The CI-001 changes do not alter any covered source file.

---

## T1 verification summary (full detail in tier-1-report.md)

All 24 headless checks passed:

- **YAML validity:** `ci.yml` and `release.yml` both parse without errors.
- **Job ordering:** `lint` (independent) → `unit` (independent, parallel with lint) → `integration` (`needs: unit`) → `e2e` (`needs: integration`). Matches the spec.
- **Runner policy:** All jobs use `ubuntu-latest`; no self-hosted runners (forbidden per `cleanup/strip-self-hosted-runner-vestige`).
- **Install discipline:** `npm ci` used throughout (no `npm install`).
- **Release permissions:** `packages: write` declared at workflow level; `GITHUB_TOKEN` used (no hardcoded creds).
- **Multi-arch:** `linux/amd64,linux/arm64` confirmed in `build-push-action`.
- **Dog-food:** Ingest step present, guarded by `vars.CTRFHUB_STAGING_URL != ''`, `continue-on-error: true`.
- **Dockerfile:** 2-stage (`builder` / `runner`), both `node:22-alpine`, `npx tsc` + `@tailwindcss/cli --minify` in builder, `npm ci --omit=dev` in runner, `HEALTHCHECK` polls `/health`, `CMD ["node", "dist/index.js"]`.
- **`.dockerignore`:** All 11 required exclusions present; `.env.example` correctly whitelisted with `!.env.example`.

---

## Non-blocking issues

- **E2E tests are not yet authored** (`e2e/tests/` is empty). This is expected — no UI stories have shipped. `npm run test:e2e` exits 0 ("no tests found"). Playwright's zero-test exit code is intentional; CI will not red-light on this.
- **Dog-food ingest is a dry-run placeholder.** `vars.CTRFHUB_STAGING_URL` is not yet set; the ingest step will be silently skipped until Argos configures it. CI-003 (Tugboat) will harden this path.
- **Docker build was not re-run locally by Test-writer.** It was verified by the Feature-implementer (42.7s, exit 0, `v22.22.2`). A re-run would add no signal beyond the YAML/policy checks above; it was not repeated.

---

## Next action (Spec-enforcer)

1. Open a new session. Paste `.antigravity/agents/spec-enforcer.md` as the first message, then this handoff as the second.
2. Confirm you are on `story/CI-001` (`git checkout story/CI-001`).
3. Run the Audit Checklist against `Dockerfile`, `.dockerignore`, `.github/workflows/ci.yml`, `.github/workflows/release.yml` and write the verdict to `.argos/CI-001/spec-audit.md` (template in `.antigravity/agents/spec-enforcer.md`).
4. Key spec references:
   - `docs/planning/architecture.md §CI / CD` and `§Image build`
   - `docs/planning/testing-strategy.md §Layer 3 — E2E Tests` and `§Dog-food reporter config`
   - `docs/planning/tasks.md §CI-001` (canonical acceptance criteria)
