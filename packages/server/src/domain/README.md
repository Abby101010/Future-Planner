# server/src/domain/

Server-specific domain helpers — pure functions that the server's
views and commands need and that don't belong in `@northstar/core`
(usually because they reason about database row shapes, or because
they're shaped around the server's execution context).

Truly cross-cutting domain logic (e.g. `cognitiveBudget.ts`) lives in
`@northstar/core/src/domain/` and is imported from there. Anything
here is a server-only extension.

## The one rule

**Pure functions, no I/O.** If a helper needs to query the database,
it belongs in `../repositories/`. If it needs to call Anthropic, it
belongs in `../ai/`.

## What NOT to put here

- SQL queries — go to `../repositories/`.
- Anthropic calls — go to `../ai/`.
- Things both the desktop and server need — promote them to
  `@northstar/core/src/domain/`.
