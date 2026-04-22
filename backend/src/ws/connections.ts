/* NorthStar server — WebSocket connection registry
 *
 * Holds a Map<userId, Set<WebSocket>> so route handlers can push events
 * (AI token deltas, agent progress, view invalidations) to every live
 * socket belonging to a given user. A user may have multiple tabs /
 * devices connected simultaneously, so every operation fans out over
 * the set.
 *
 * Heartbeat: every socket gets a 30s ping interval. If the client fails
 * to answer with a pong within ~60s (two intervals), the socket is
 * terminated and cleaned up.
 */

import type { WebSocket } from "ws";
import type { Envelope } from "@northstar/core";

const PING_INTERVAL_MS = 30_000;
const DEAD_AFTER_MS = 60_000;

interface Tracked {
  /** Wall-clock time of the most recent pong (or connection open). */
  lastPongAt: number;
  /** The setInterval handle so we can clear it on close. */
  pingTimer: NodeJS.Timeout;
}

export class ConnectionRegistry {
  private readonly byUser = new Map<string, Set<WebSocket>>();
  private readonly trackers = new WeakMap<WebSocket, Tracked>();

  /**
   * Register a freshly-authenticated socket under `userId`, attach the
   * heartbeat, and wire up `close`/`error` so the socket auto-removes
   * itself from the registry.
   */
  add(userId: string, ws: WebSocket): void {
    let bucket = this.byUser.get(userId);
    if (!bucket) {
      bucket = new Set();
      this.byUser.set(userId, bucket);
    }
    bucket.add(ws);

    const tracked: Tracked = {
      lastPongAt: Date.now(),
      pingTimer: setInterval(() => {
        const t = this.trackers.get(ws);
        if (!t) return;
        if (Date.now() - t.lastPongAt > DEAD_AFTER_MS) {
          // No pong in 60s — assume the socket is dead and hang up.
          try {
            ws.terminate();
          } catch {
            /* ignore */
          }
          return;
        }
        try {
          ws.ping();
        } catch {
          /* ignore — next tick will terminate */
        }
      }, PING_INTERVAL_MS),
    };
    this.trackers.set(ws, tracked);

    ws.on("pong", () => {
      const t = this.trackers.get(ws);
      if (t) t.lastPongAt = Date.now();
    });

    const cleanup = () => this.remove(userId, ws);
    ws.on("close", cleanup);
    ws.on("error", cleanup);
  }

  /**
   * Remove a socket from the registry and stop its heartbeat. Safe to
   * call multiple times (close + error can both fire).
   */
  remove(userId: string, ws: WebSocket): void {
    const tracked = this.trackers.get(ws);
    if (tracked) {
      clearInterval(tracked.pingTimer);
      this.trackers.delete(ws);
    }
    const bucket = this.byUser.get(userId);
    if (!bucket) return;
    bucket.delete(ws);
    if (bucket.size === 0) this.byUser.delete(userId);
  }

  /**
   * Serialize an envelope once and fan it out to every socket belonging
   * to `userId`. No-op if the user has no live sockets.
   */
  broadcastToUser(userId: string, envelope: Envelope<unknown>): void {
    const bucket = this.byUser.get(userId);
    if (!bucket || bucket.size === 0) return;
    const payload = JSON.stringify(envelope);
    for (const ws of bucket) {
      this.sendRaw(ws, payload);
    }
  }

  /**
   * Fan out to every connected socket regardless of user. Mostly useful
   * for server-wide notices; day-to-day events should stay per-user.
   */
  broadcastToAll(envelope: Envelope<unknown>): void {
    const payload = JSON.stringify(envelope);
    for (const bucket of this.byUser.values()) {
      for (const ws of bucket) {
        this.sendRaw(ws, payload);
      }
    }
  }

  /** Count of live sockets for a user — mostly for tests / diagnostics. */
  countForUser(userId: string): number {
    return this.byUser.get(userId)?.size ?? 0;
  }

  private sendRaw(ws: WebSocket, payload: string): void {
    // ws.OPEN === 1; check readyState to avoid "WebSocket is not open" throws.
    if (ws.readyState !== 1) return;
    try {
      ws.send(payload);
    } catch {
      /* ignore — close handler will clean up */
    }
  }
}

/** Process-wide singleton used by route handlers via the ws/ barrel. */
export const connectionRegistry = new ConnectionRegistry();
