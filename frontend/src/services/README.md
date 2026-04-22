# desktop/src/services/

The boundary layer between React and the outside world. Every call
that leaves the renderer process — HTTP, WebSocket, localStorage —
goes through a function defined here.

## Files

| File | Role |
|---|---|
| `auth.ts` | The single source of the bearer token |
| `transport.ts` | Envelope-protocol transport — the primary path used by `hooks/useQuery` and `hooks/useCommand` |
| `queryCache.ts` | In-memory cache keyed by view kind + params; invalidated on WS `view:invalidate` events |
| `wsClient.ts` | WebSocket client — heartbeats, reconnect, per-event-kind subscription |
| `cloudTransport.ts` | **Legacy** channel-based transport, shrinking. Still used by `ai.ts`, `memory.ts`, `repositories/index.ts` for call sites that haven't been migrated to `view:*` yet |
| `ai.ts` | Typed wrappers around the legacy `ai:*` channels — new code should prefer a dedicated command |
| `memory.ts` | Wrappers around the legacy `memory:*` channels (reflection, signals, nudges, behavior profile) |

## The one rule

**`transport.ts` is the only file that calls `fetch()` for the
envelope protocol, and `cloudTransport.ts` is the only file that
calls `fetch()` for the legacy channel protocol.** React code goes
through a hook; no page or component imports either transport module
directly.

## What NOT to put here

- New call sites importing `cloudTransport.cloudInvoke` — add a view
  or command and use the hooks instead.
- Business logic — services are dumb wire glue, nothing more.
- DOM access or React hooks — those live in `../hooks/` and
  `../components/`.
