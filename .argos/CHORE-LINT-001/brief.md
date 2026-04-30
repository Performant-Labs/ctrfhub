# CHORE-LINT-001 — Eliminate `any` casts in health.test.ts

**Type:** chore (refactor / type-safety)
**Estimated effort:** 1 short cycle (single file, mechanical refactor)
**Blocks:** nothing
**Blocked by:** nothing

---

## Goal

Replace every `(app as any).<member>` cast in `src/__tests__/integration/health.test.ts` with a proper TypeScript type, so `npm run lint` passes with **zero warnings** (currently: 14 warnings, all `@typescript-eslint/no-explicit-any` in this one file).

After this change, the project's pre-push hook (typecheck + lint) prints a clean run.

---

## Context

The test file accesses Fastify decorations added by `buildApp()` — three custom members on the `FastifyInstance`:

- `getBootState()` — returns one of `'booting' | 'migrating' | 'ready'`
- `setBootState(state)` — sets the state (only used in test code)
- `orm` — the MikroORM instance (`MikroORM` type)

These decorations are real and live on the Fastify instance at runtime, but the base `FastifyInstance` type from `fastify` doesn't know about them. The current code "solves" this by casting to `any` 14 times. That's why ESLint warns.

The right fix, per Fastify's TypeScript conventions, is **module augmentation**: declare these decorations once on the global `FastifyInstance` type, and the casts go away entirely.

---

## Files in scope

**The only file you may modify:**

- `src/__tests__/integration/health.test.ts` — remove all `as any` casts
- *(probably)* `src/types/fastify-augment.d.ts` *(or similar, see "Approach")* — new file declaring the module augmentation

**Files you may READ for context but must not modify:**

- `src/app.ts` — to verify the actual signatures of `getBootState`, `setBootState`, and the `orm` decoration. Look around lines 380-385 (per the existing comment in health.test.ts L200).
- `src/__tests__/integration/health.test.ts` line 77 — example of the project's preferred narrowing idiom (`JSON.parse(...) as Record<string, unknown>`). Use this style of explicit narrowing where module augmentation isn't appropriate.

---

## Non-goals

Do not:

- Change any test logic, assertions, or test names.
- Add or remove tests.
- Change the import order or formatting outside what's required for the type fix.
- Touch any other file beyond what's listed in "Files in scope."
- Use `// eslint-disable-next-line` to silence the warnings — that's a worse fix than typing them properly.
- Use `as unknown as Foo` chains — if you find yourself reaching for one, the augmentation is the cleaner answer.

---

## Approach (recommended)

**Step 1 — confirm the actual decoration signatures.**

Open `src/app.ts`. Find where `getBootState`, `setBootState`, and `orm` are decorated onto the Fastify instance via `app.decorate(...)`. Note the exact types (especially the union for the `BootState` argument).

**Step 2 — add a module-augmentation file.**

Create `src/types/fastify-augment.d.ts` (path is a suggestion; if there's already a similar file in `src/types/` use that instead):

```ts
import 'fastify';
import type { MikroORM } from '@mikro-orm/core';

type BootState = 'booting' | 'migrating' | 'ready';

declare module 'fastify' {
  interface FastifyInstance {
    getBootState(): BootState;
    setBootState(state: BootState): void;
    orm: MikroORM;
  }
}
```

Use the **exact types** you confirmed from `src/app.ts`. If `MikroORM` is imported from a different package or sub-path in this project, mirror that import path. If `BootState` is already exported as a type from somewhere in `src/`, import it instead of redefining it.

**Step 3 — delete the `any` casts.**

Open `src/__tests__/integration/health.test.ts` and replace each occurrence of `(app as any).<member>` with just `app.<member>`. There are 14 of them on these lines: 36, 40, 44, 48, 49, 216, 222, 232, 238, 251, 257, 262, 267, 343.

**Step 4 — verify locally.**

```bash
npm run typecheck    # must pass with 0 errors
npm run lint         # must pass with 0 warnings (was: 14 warnings)
npm test             # must pass (no test logic changed; sanity check that the augmentation didn't break compilation)
```

If any of these fail, **read the error carefully and fix it**. Don't disable rules. Don't widen types back to `any`. Don't skip tests.

---

## Acceptance criteria

All four must hold:

1. `npm run lint` reports **0 warnings, 0 errors**.
2. `npm run typecheck` passes with no errors.
3. `npm test` passes — every test still runs, every assertion still holds.
4. The diff is small: one or two files changed, no test logic rewritten.

---

## Out of scope (do NOT attempt)

- Fixing `any` casts in any other file (there may be more elsewhere; not your problem in this task).
- Refactoring `health.test.ts`'s structure even if it'd be cleaner — the goal is type-safety, not test ergonomics.
- Updating skills/* docs to mention the augmentation pattern.

If you find yourself wanting to do any of these, stop and surface the suggestion to André as a follow-up task instead.

---

## Reference: the 14 warnings as ESLint reported them

```
src/__tests__/integration/health.test.ts
   36:27  warning  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
   40:27  warning  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
   44:20  warning  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
   48:20  warning  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
   49:27  warning  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  216:13  warning  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  222:13  warning  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  232:13  warning  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  238:13  warning  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  251:13  warning  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  257:13  warning  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  262:13  warning  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  267:13  warning  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  343:25  warning  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
```

---

## Workflow

1. Branch: as assigned by André (one of `chore/lint-001-qwen` or `chore/lint-001-opus`).
2. One commit, well-formed message:
   ```
   chore(types): replace `as any` casts in health.test.ts with FastifyInstance augmentation

   The test file used 14 `(app as any).<member>` casts to access decorations
   added at app-build time. Replaces those with a proper module augmentation
   declaring `getBootState`, `setBootState`, and `orm` on FastifyInstance,
   eliminating the @typescript-eslint/no-explicit-any warnings.

   Verified locally: lint clean (0 warnings), typecheck clean, all tests pass.
   ```
3. Push the branch using your normal git workflow. (If you don't have host git access, hand the push to André.)
4. Stop after pushing. Argos will judge both branches and open the winning PR.

---

## When you're done

Hand back to André with:

- The PR URL
- A 2-3 line summary: what you changed, what tests passed, anything surprising
- If anything didn't work, what you tried and where you got stuck

If you hit anything that looks ambiguous (e.g. `BootState` is defined in a place you didn't expect, or the `orm` type isn't `MikroORM`), pause and ask before guessing. Wrong guesses on types are easy to land in main and harder to undo.
