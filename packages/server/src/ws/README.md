# `@northstar/server` — WebSocket transport

This module stands up a WebSocket server on top of the existing Express
HTTP server so the backend can push AI token deltas, agent progress
updates, reminders, and view-invalidation signals to connected clients
in real time. HTTP remains the request/response channel; WS is a
one-way server-to-client push channel (the client is not expected to
send messages yet).

## Topology

- Single `http.Server` hosts both Express and the WS upgrade handler.
- `attachWebSocketServer(httpServer)` creates a `ws.WebSocketServer`
  in `noServer: true` mode and listens for `upgrade` events on the
  path `/ws`. Any upgrade on a different path is ignored so future
  consumers can coexist.
- A process-wide `ConnectionRegistry` singleton (`connectionRegistry`)
  tracks `Map<userId, Set<WebSocket>>`. One user may have multiple
  sockets (tabs, devices); emitters fan out to all of them.

## Auth model

WS upgrades reuse the exact same bearer-token validator as the HTTP
middleware (`validateBearerToken` in `middleware/auth.ts`). Clients may
supply the token one of two ways:

1. `Authorization: Bearer <token>` header — preferred when the client
   controls headers (Node, Electron, custom HTTP client).
2. `?token=<token>` query param — fallback for the browser `WebSocket`
   API, which cannot set custom headers.

A failed upgrade is answered with a raw `HTTP/1.1 401 Unauthorized`
and the TCP socket is destroyed. Once past the upgrade the socket is
trusted and tagged with its `userId` for the life of the connection —
there is no per-message re-auth.

## Heartbeat

Every socket gets a 30s `ping` interval. The registry records
`lastPongAt` on each `pong` event. If the gap between now and
`lastPongAt` ever exceeds 60s (two missed pings), the socket is
`terminate()`d and removed from the registry. This protects against
half-open TCP connections where a client silently disappears without
an orderly close.

Reconnection is the client's responsibility (Task 17). The server
does not attempt to persist in-flight streams across reconnects.

## Emitting events from route handlers

Route handlers should never call `ws.send()` or
`connectionRegistry.broadcastToUser()` directly. Instead import a
typed helper from `@northstar/server/ws` (or the barrel
`./ws/index.ts` inside the package) and call it with the current
`userId`:

```ts
import {
  emitAiTokenDelta,
  emitViewInvalidate,
} from "../ws";

// inside a route handler, after you already have req.userId:
emitAiTokenDelta(req.userId, { streamId, delta: "hello " });
emitViewInvalidate(req.userId, { viewKinds: ["view:tasks", "view:dashboard"] });
```

Each emitter wraps its payload in the standardized `envelope()` from
`@northstar/core/protocol/envelope`, so the wire format stays the same
whether a message came from HTTP or WS. Available emitters, one per
`EventKind`:

| Emitter                  | EventKind            |
| ------------------------ | -------------------- |
| `emitAiStreamStart`      | `ai:stream-start`    |
| `emitAiTokenDelta`       | `ai:token-delta`     |
| `emitAiStreamEnd`        | `ai:stream-end`      |
| `emitAgentProgress`      | `agent:progress`     |
| `emitViewInvalidate`     | `view:invalidate`    |
| `emitReminderTriggered`  | `reminder:triggered` |

## What this module deliberately does NOT do

- **No Anthropic streaming yet.** The emitters are stubs that will be
  wired in Task 16. In Phase 3b they exist, are typed, and work — but
  nothing calls them.
- **No rooms beyond per-user.** No topics, pub-sub, or groups.
- **No rate limiting.** The HTTP middleware chain handles that.
- **No server-side reconnect.** The client reconnects; the registry
  just cleans up dead sockets.
- **No client-to-server messages.** Incoming frames are currently
  ignored; add a router here only when a real use case shows up.
