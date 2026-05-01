# CTRF-003 — Remediation Pass 1

**Branch:** `story/CTRF-003-opus`
**Trigger:** Spec-enforcer `BLOCK` verdict — see `.argos/CTRF-003/spec-audit.md` Finding #1.
**Workflow position:** `implementstory.md` Phase 1 (Feature-implementer) → Phase 2 (Test-writer).
**Authored:** 2026-05-01 by Argos.

---

## Why this remediation exists

The shipped story passes integration tests, but the per-type per-file size ceilings documented in the brief (`image 10 MB / video 100 MB / zip 200 MB / log 5 MB`) are **not actually enforced in production**. `@fastify/multipart` is registered without a `limits.fileSize` override, so its default 1 MB cap rejects every artifact > 1 MB before the custom check at `src/lib/artifact-validation.ts:13-19` ever runs.

Symptoms in the current state:
- A 5 MB valid PNG is rejected with `FST_REQ_FILE_TOO_LARGE` (Fastify's code), not 201.
- The custom code path in `checkFileSizeLimit()` and the type-aware ceilings are dead code.
- Test #4 had to be loosened to status-only assertion to pass.

This is a contract failure, not a documentation gap. The fix is small.

---

## Pass 1 — Feature-implementer scope

You are operating per `.antigravity/agents/feature-implementer.md`. You may **only** modify files under `src/` (and not under `src/__tests__/`).

### Required reading before writing code

You **must** read these before any edit:

1. `.argos/CTRF-003/spec-audit.md` — read Findings row #1 in full and the "Verdict" section.
2. `.argos/CTRF-003/feature-handoff.md` — your own handoff from the original pass.
3. `skills/ctrf-ingest-validation.md` — re-read §"Multipart uploads" to confirm the per-type ceilings.
4. `skills/fastify-route-convention.md` — confirm plugin-registration conventions.

### The change

In `src/app.ts` around line 556 (the `app.register(fastifyMultipart, {…})` call), add a `limits` option so the multipart plugin's hard ceiling sits *above* the highest custom per-type limit (zip = 200 MB), letting the application-layer per-type checks fire as documented.

**Required diff (illustrative — do not copy verbatim if your formatting differs):**

```ts
await app.register(fastifyMultipart, {
  // Don't attach files to body — we iterate parts manually in the route
  attachFieldsToBody: false,
  // Plugin-level ceiling sits at the highest per-type limit (zip = 200 MB).
  // Per-type ceilings (image 10 MB / video 100 MB / zip 200 MB / log 5 MB)
  // are enforced in src/lib/artifact-validation.ts after we classify the file.
  // Without this, @fastify/multipart's default 1 MB cap preempts every check.
  limits: {
    fileSize: 200 * 1024 * 1024,
  },
});
```

### Why this exact value

- 200 MB = the highest documented per-type ceiling (zip). Setting it as the plugin ceiling lets the type-aware checks in `artifact-validation.ts` decide acceptance/rejection per-type.
- Anything larger than 200 MB is over the maximum legitimate per-type ceiling and should still be rejected at the plugin layer (defence-in-depth).
- Per-run total (`MAX_ARTIFACT_SIZE_PER_RUN`, default 500 MB) is still enforced in `parseMultipartIngest()` and is unaffected by this change.

### Out of scope for Pass 1

Do **not** in this pass:

- Touch any file under `src/__tests__/`. The integration tests need updating (Pass 2), but that is **test-writer work** by role boundary.
- Refactor `parseMultipartIngest()` or any validation helper. The existing custom check is correct; it just was never being reached.
- Modify any other multipart option (`attachFieldsToBody`, `limits.fields`, `limits.parts`, etc.). Single-option change only.
- Address Findings rows #2 (external-URL path validation), #3 (file split), #4 (`app.ts` modifications), or #5 (silent skip on missing file part). #2 is deferred to ART-001 per the audit; the others were ruled NIT/NON-BLOCKING.

### Verification (Pass 1)

Run locally and capture results in your handoff:

```bash
npm run typecheck    # 0 errors
npm run lint         # 0 errors (existing `as any` warnings remain — unchanged)
npm run dev          # server boots clean on :3000
```

You may **not** run `npm test` — that's the test-writer's territory.

### Commit conventions

One commit, scope `fix(CTRF-003)`:

```
fix(CTRF-003): raise @fastify/multipart fileSize ceiling so per-type limits fire

The plugin was registered without a limits override, so its default 1 MB cap
preempted the application-layer per-type ceilings (image 10 MB / video 100 MB
/ zip 200 MB / log 5 MB). Set fileSize to 200 MB (the highest legitimate
per-type ceiling) so artifact-validation.ts governs.

Refs: .argos/CTRF-003/spec-audit.md Finding #1
```

### Handoff (Pass 1 → Pass 2)

Append a new section to `.argos/CTRF-003/feature-handoff.md` titled `## Remediation Pass 1` with:

- The commit SHA + message.
- The verification command results.
- A pointer to this brief: `Triggered by .argos/CTRF-003/remediation-1.md`.
- A "Next action (Test-writer)" subsection naming the two test changes required (see Pass 2 below).

---

## Pass 2 — Test-writer scope

After Pass 1 ships, the test-writer (Daedalus in test-writer mode, fresh session) executes Pass 2. You are operating per `.antigravity/agents/test-writer.md`. You may **only** modify files under `src/__tests__/` (and `e2e/tests/` if applicable, which it is not for this story).

### Required reading

1. `.argos/CTRF-003/spec-audit.md` — Coverage gaps #2 and #3.
2. `.argos/CTRF-003/feature-handoff.md` — including the new `## Remediation Pass 1` section.
3. `skills/vitest-three-layer-testing.md` — confirm integration-tier conventions.
4. `skills/ctrf-ingest-validation.md` — re-read §"Multipart uploads" for per-type ceilings.

### Change A — Tighten Test #4 (`returns 413 when an image exceeds the per-file size limit`)

Located in `src/__tests__/integration/ingest-artifacts.test.ts` around line 360.

Required edits:

1. Change the file size from 11 MB to **12 MB** (still well over the 10 MB image limit, with comfortable headroom over rounding edges).
2. Add an assertion on the response code:

   ```ts
   const body = JSON.parse(res.body);
   expect(body.code).toBe('ARTIFACT_FILE_TOO_LARGE');
   ```

3. Remove the comment block at lines 354-359 explaining the loosening — the loosening is gone. Replace with a single-line comment:

   ```ts
   // ── 4. Per-file size limit (1 API key call) ────────────────────────────
   // 12 MB image — over the 10 MB image ceiling but under the 200 MB plugin
   // ceiling, so artifact-validation.ts governs.
   ```

### Change B — Add new test: 5 MB valid PNG accepted

Insert as Test #4b (between current #4 and current #5). This test proves that the plugin's 1 MB default no longer blocks legitimate uploads.

```ts
// ── 4b. Per-file size — under the per-type limit, over the old 1 MB default ─
it('accepts a valid PNG between 1 MB and the 10 MB image limit', async () => {
  const png = oversizedPng(5); // 5 MB — over Fastify's old 1 MB default,
                                // under the 10 MB image ceiling.
  const ctrf = makeCtrfWithAttachments([
    [{ name: 'midsize.png', contentType: 'image/png', path: 'midsize.png' }],
  ]);

  const res = await injectMultipart(f, ctrf, [
    { fieldName: 'midsize.png', fileName: 'midsize.png', contentType: 'image/png', data: png },
  ]);

  expect(res.statusCode).toBe(201);
});
```

If `oversizedPng()` doesn't already accept arbitrary MB sizes, extend it (it lives in the same file; this is in-scope test-helper work). The function should produce a buffer whose first bytes are the valid PNG magic (`89 50 4E 47 0D 0A 1A 0A`) followed by enough padding bytes to hit the requested size — magic-bytes validation only inspects the first 16 bytes, so the remainder can be filler.

### Verification (Pass 2)

```bash
npx vitest run src/__tests__/integration/ingest-artifacts.test.ts   # 10/10 pass
npm run test                                                         # full suite, 413/413 pass
npx tsc --noEmit                                                     # 0 errors
npm run lint                                                         # 0 errors
```

### Commit conventions

One commit, scope `test(CTRF-003)`:

```
test(CTRF-003): tighten per-file 413 assertion and cover 5 MB acceptance

Now that @fastify/multipart's fileSize ceiling sits at 200 MB,
the application-layer ARTIFACT_FILE_TOO_LARGE check governs. Tighten Test #4
to use 12 MB and assert code=ARTIFACT_FILE_TOO_LARGE; add Test #4b that
uploads a 5 MB valid PNG and expects 201.

Refs: .argos/CTRF-003/spec-audit.md Coverage gaps #2 and #3
```

### Handoff (Pass 2 → Spec-enforcer re-audit)

Append a new section to `.argos/CTRF-003/test-handoff.md` titled `## Remediation Pass 2` with:

- The commit SHA + message.
- The four verification command results.
- An updated test list noting the new Test #4b and the tightened Test #4 assertion.
- A "Next action (Spec-enforcer)" subsection asking for re-audit against Finding #1 only — the rest of the suite is unchanged.

---

## Re-audit scope

The spec-enforcer's re-audit need only confirm:

1. `src/app.ts:556` (or wherever multipart is registered) now has `limits.fileSize` set to 200 MB or larger.
2. `src/__tests__/integration/ingest-artifacts.test.ts` Test #4 now asserts `code === 'ARTIFACT_FILE_TOO_LARGE'` with a > 10 MB file.
3. A new Test #4b (or equivalent name) accepts a 5 MB PNG.
4. `npm run test` — 413/413 pass.
5. `npm run typecheck` and `npm run lint` — clean.

If all five hold, the audit's Verdict flips to **PASS** and the story is ready for PR creation per `implementstory.md` Phase 5.

---

## Escalation

If during Pass 1 you discover that `src/app.ts` already has a `limits` option set somewhere I missed, or if the multipart registration has moved since the original pass — stop and update `.argos/CTRF-003/gaps-during-remediation.md` with what you found. Do not guess.

If during Pass 2 the existing `oversizedPng()` helper has a different signature or behavior than I described, adapt as needed and note the deviation in your handoff. The semantic requirement is "5 MB valid PNG that passes magic-bytes" — the mechanic is yours to choose.
