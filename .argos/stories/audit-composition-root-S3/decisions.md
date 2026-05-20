# Decisions — audit-composition-root-S3

Non-obvious autonomous calls Argos made instead of pausing on an interactive prompt.
Per `.claude/agents/orchestrator.md §Decision log`.

## D-1 — Branched from `origin/main`, not local `main` (Phase 1, 2026-05-20)

**Context.** Local `main` still carries the divergent unpushed `7319025 docs(agents): rename Daedalus + Talos → Prometheus` commit from the Mac→Uranus migration (the same divergence noted in S2's `decisions.md` D-1). The remote `origin/main` is at `76604f4` (PR #86 merge — the S2 close-out).

**Call.** Branched `story/audit-composition-root-S3` from `origin/main @ 76604f4` directly, leaving local `main` untouched.

**Rationale.** Same as S2 D-1 — `origin/main` is the canonical post-S1/S2 baseline this story builds on; the local-only docs commit is unrelated to this story and not Argos's to push or revert. The post-S1/S2 merge gives S3 a clean read against `src/app.ts` (line numbers in the brief are against `origin/main @ 76604f4`, not the original audit's `origin/main @ pre-S1/S2`).

**Surfaced to André.** Noted in this `decisions.md` for the audit trail.

## D-2 — Brief frames finding #10 as F-decides; T's tier scope is consequently F-dependent (Phase 1, 2026-05-20)

**Context.** The audit decomposition for S3 says: "F decides; documents the choice in `feature-handoff.md`" for finding #10 (extract `GET /` to its own module vs. annotate the inline registration). The decomposition further says: "Page verification: T1 + T2 on `GET /` if F chooses option (a) (new rendered route in its own module). N/A if F chooses option (b) (no structural change)."

This makes T's tier scope **dependent on F's iter-1 call**. T cannot start until F has decided.

**Call.** The brief inlines both options and instructs T to read F's `feature-handoff.md` "Decisions not covered by planning docs" section to learn F's choice before deciding tier scope. The brief's "Test tiers required" table has both branches spelled out so T can route mechanically. Argos does not pre-commit T to either tier scope at Phase 1.

**Rationale.** Pre-committing T would either (i) over-spec T's scope and force it to produce N/A reports for tiers F didn't trigger, or (ii) under-spec and force a tier-scope renegotiation mid-story. Letting T read F's call is the autonomous-decision-rule shape: F makes a documented call within the brief's allowed range; T routes against it; A's review verifies the choice is consistent. No human in the loop.

**Surfaced to André.** Inline in the brief's "Test tiers required" table.
