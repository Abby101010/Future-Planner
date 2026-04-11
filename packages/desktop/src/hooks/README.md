# desktop/src/hooks/

The envelope-protocol client hooks. Every page in `src/pages/` should
read and mutate domain data exclusively through these.

## What lives here

| Hook | Purpose |
|---|---|
| `useQuery<T>(kind, params?)` | Runs a `view:*` query, caches the result in `services/queryCache.ts`, and auto-refetches when the server sends a matching `view:invalidate` WebSocket event |
| `useCommand()` | Returns `{ run, running, error }` — `run(kind, input)` posts a `command:*` and returns its typed result |
| `useAiStream(streamId)` | Subscribes to `ai:token-delta` / `ai:stream-end` events for a given stream id and exposes `{ text, running, finished }` |
| `useWsEvent(kind, handler)` | Generic WS event subscription (one listener per kind) |

## The one rule

**These hooks are the only legitimate way for React code to talk to
the server.** No `fetch()` in pages, no imports of
`services/cloudTransport.ts`, no direct `wsClient.on(...)` — go
through a hook so caching, invalidation, and auth stay consistent.

## What NOT to put here

- Page-specific data massaging (put it in the page, or in `lib/`).
- Zustand reads/writes (use `useStore` directly for the small UI
  state that still lives there).
- New network transports — extend `services/transport.ts` first, then
  wrap it in a hook if needed.
