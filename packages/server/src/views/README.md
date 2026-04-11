# Views (Phase 5a)

Per-page read-model resolvers. Every URL in the client maps to exactly
one view kind and exactly one GET request; the resolver's job is to
assemble the narrowest possible, serialization-ready object that page
needs, and nothing else.

## The view-model contract

1. **Narrow, per-page.** A view is the view-model for ONE page. It is
   not a union of every entity that page "might" need. If the page has
   ten fields, the view has ten fields. If two pages happen to need
   overlapping data, they each get their own view — we duplicate the
   computation, not the page.
2. **Server-side compute.** Every derived field (streaks, progress
   percentages, overdue counts, "needs rescheduling" booleans, etc.)
   is computed inside the resolver. Clients are zero-logic renderers.
3. **Repositories only.** Resolvers compose one or more repositories
   from `../repositories` — they do not open SQL directly, except
   where a legacy field still lives in `app_store` (see below). That
   boundary keeps the view layer a pure assembly step.
4. **JSON-serializable.** No class instances. Dates must be strings.
   Maps and Sets must be flattened to arrays/objects. The whole
   return value goes through `JSON.stringify` at the route boundary.
5. **Typed at the seam.** Each view exports a TypeScript interface
   (e.g. `DashboardView`, `GoalPlanView`) so route handlers, tests,
   and — eventually — generated client bindings all agree on shape.

## App-store fallbacks

A few fields still live on the legacy `app_store` row because their
dedicated tables haven't been cut over yet (user profile, user
settings, `roadmap`, `goalBreakdown`, `deviceIntegrations`). Those
resolvers read app_store via an inline `readAppStoreKey<T>()` helper
and are marked `// TODO(phase6): move to <table>` so Phase 6 can grep
for every leftover and delete it in one pass.

New views must not introduce any new `app_store` reads. If you find
yourself reaching for one, add a repository or a migration instead.

## Invalidation

When a command mutates data, the command handler looks up which views
need to be invalidated in `_invalidation.ts` and fires a
`view:invalidate` WS event so connected clients refetch. The
invalidation table is the single source of truth — do not hardcode
`[ "view:dashboard" ]` inline in a command handler, extend the map.

## Usage from routes

```ts
import { viewResolvers } from "../views";
import { envelope, envelopeError } from "@northstar/core";

const resolver = viewResolvers["view:dashboard"];
const data = await resolver();
res.json(envelope("view:dashboard", data));
```
