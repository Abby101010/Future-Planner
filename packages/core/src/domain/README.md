# core/src/domain/

Pure domain logic that both the server and the desktop client need to
reason about. Currently just `cognitiveBudget.ts` (with its unit
tests).

## The one rule

**Pure functions only.** Take plain data in, return plain data out.
These files are imported by server views/commands AND by React
components, so they must not depend on either side's runtime.

## What NOT to put here

- Any module that imports `pg`, `express`, `react`, or `fetch`.
- Side-effecting globals (module-level caches are fine only if they
  depend purely on their inputs).
- Wire-format or transport types — those belong in `../protocol/`.
