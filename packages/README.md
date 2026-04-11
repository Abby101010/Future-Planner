# packages/

npm workspaces monorepo root. Three packages:

| Package | Role |
|---|---|
| `@northstar/core` | Shared wire types, envelope protocol, pure domain helpers. Imported by both desktop and server |
| `@northstar/server` | Express + Postgres + Anthropic. Deploys to Fly.io. Speaks the envelope protocol over HTTP and emits WS invalidations |
| `@northstar/desktop` | Electron + React renderer. Reads via `view:*`, writes via `command:*`, subscribes to WS |

## The one rule

**`@northstar/core` has no runtime dependencies** (no `pg`, no
`react`, no `express`, no `fetch`). Desktop and server both depend on
core; core depends on neither.

## Typecheck everything

```bash
npm run typecheck
```

This runs `tsc -b` across all three packages in the correct
dependency order.
