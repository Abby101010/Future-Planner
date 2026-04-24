/* Starward server — WebSocket upgrade handler
 *
 * Attaches a `ws` WebSocketServer to the existing HTTP server in
 * `noServer` mode so Express still owns routing. On every `upgrade`
 * event we:
 *
 *   1. Pull a bearer token from either the Authorization header or
 *      a `?token=` query param (browser WebSocket API can't set
 *      headers, so we accept both).
 *   2. Validate it through the same helper the HTTP middleware uses
 *      (`validateBearerToken`), which resolves a userId.
 *   3. If auth fails, reply with a raw `HTTP/1.1 401` and destroy the
 *      socket so the client sees a clean rejection.
 *   4. Otherwise hand the socket to `wss.handleUpgrade` and register
 *      it with the ConnectionRegistry keyed by userId.
 *
 * We do NOT start an Anthropic stream or open any per-connection
 * resources here — this is pure transport. Emitters in ws/events.ts
 * push data INTO the sockets later from route handlers.
 */

import type * as http from "node:http";
import { WebSocketServer } from "ws";
import { validateBearerToken, extractBearerToken } from "../middleware/auth";
import { connectionRegistry } from "./connections";
import { envelope } from "@starward/core";

const WS_PATH = "/ws";

/**
 * Resolve a bearer token for a given upgrade request. Prefers the
 * Authorization header (Node WS clients can set it) and falls back to
 * a `?token=...` query param (browsers can only do query params).
 */
function tokenFromUpgradeRequest(req: http.IncomingMessage): string | null {
  const headerToken = extractBearerToken(req.headers["authorization"] ?? null);
  if (headerToken) return headerToken;

  // Parse query string off req.url without pulling in `url` module
  // helpers that assume an absolute URL.
  const rawUrl = req.url ?? "";
  const qIndex = rawUrl.indexOf("?");
  if (qIndex === -1) return null;
  const params = new URLSearchParams(rawUrl.slice(qIndex + 1));
  const q = params.get("token");
  return q && q.length > 0 ? q : null;
}

/**
 * Attach a WebSocketServer to the given HTTP server. Safe to call
 * exactly once at startup, right after `http.createServer(app)` and
 * before `server.listen()`.
 */
export function attachWebSocketServer(httpServer: http.Server): void {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    // Only claim upgrades on our path so other upgrade consumers
    // (if any are ever added) aren't stolen.
    const rawUrl = req.url ?? "";
    const pathname = rawUrl.split("?", 1)[0];
    if (pathname !== WS_PATH) return;

    const token = tokenFromUpgradeRequest(req);
    void validateBearerToken(token)
      .then((auth) => {
        if (!auth) {
          // Reject before the WS handshake — raw HTTP response is the
          // cleanest signal to clients that auth failed.
          socket.write(
            "HTTP/1.1 401 Unauthorized\r\n" +
              "Connection: close\r\n" +
              "Content-Length: 0\r\n" +
              "\r\n",
          );
          socket.destroy();
          return;
        }

        wss.handleUpgrade(req, socket, head, (ws) => {
          connectionRegistry.add(auth.userId, ws);
          // Application-level ping/pong. The browser's WebSocket API
          // auto-answers WS-protocol ping frames but doesn't surface
          // them to `onmessage`, so the renderer never sees liveness
          // from `ws.ping()`. We listen for a JSON `{kind:"ping"}`
          // envelope from the client and echo back a `pong` envelope
          // so the renderer's 60s dead-frame watchdog stays happy.
          ws.on("message", (raw) => {
            let text: string;
            try {
              text = raw.toString();
            } catch {
              return;
            }
            if (!text) return;
            let parsed: { kind?: unknown } | null = null;
            try {
              parsed = JSON.parse(text) as { kind?: unknown };
            } catch {
              return;
            }
            if (!parsed || parsed.kind !== "ping") return;
            if (ws.readyState !== 1) return;
            try {
              ws.send(
                JSON.stringify(
                  envelope("pong" as never, {
                    ts: new Date().toISOString(),
                  }),
                ),
              );
            } catch {
              /* ignore — next tick will clean up */
            }
          });
          wss.emit("connection", ws, req);
        });
      })
      .catch(() => {
        // Any unexpected validator error → close with policy violation.
        try {
          socket.destroy();
        } catch {
          /* ignore */
        }
      });
  });

  // Close any mid-handshake sockets if the server is shutting down.
  httpServer.on("close", () => {
    wss.close();
  });
}
