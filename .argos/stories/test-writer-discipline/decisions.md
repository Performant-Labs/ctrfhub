# Decision log — test-writer-discipline

## 2026-05-18 — Phase 1 (Brief) — Criterion 1 verification artifact: audit script, not unit test

**Decision.** Acceptance criterion 1's verification artifact will be an audit script in `scripts/`, written by F — not a unit test under `src/__tests__/`.

**Trigger.** Criterion 1 offers a choice ("a unit test of the role-file content, OR an audit script in `scripts/`"), but the brief's Constraints section restricts the PR to "role files / workflow docs / scripts."

**Rationale.** A unit test file lives under `src/__tests__/`, which is outside the constraint's allowed set; an audit script in `scripts/` is squarely inside it. Because criterion 1 explicitly offers a route that fully respects the Constraints section, no human escalation is needed — the constraints-over-literal-reading clause (merged in `orchestrator-autonomy-hardening` / PR #73) calls for escalation only when a literal reading *forces* a constraint violation, which it does not here. Argos picks the constraint-respecting route autonomously.

**Effect.** F's scope includes adding a `scripts/` audit script that verifies the new test-sizing rules are present in `test-writer.md`, `verifystory.md`, and `audit-tests.md`. The Phase 4 T invocation does not author a committed test file; T's work is acceptance criterion 2's dry-run plus running the audit script and the existing suite.
