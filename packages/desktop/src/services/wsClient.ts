/* NorthStar — WebSocket client singleton (Phase 5b)
 *
 * Talks to the server's per-user WS channel. Inbound frames are envelopes
 * with a `kind` the server picked from `EventKind`. Listeners register by
 * kind via `subscribe()` and receive the strongly-typed payload plus an
 * optional `streamId` when the server tagged the envelope with one.
 *
 * Design notes:
 *   - Auto-reconnect with exponential backoff (1s → 30s), resets to 1s
 *     after a stable 30s connection.
 *   - Heartbeat: send a `ping` envelope every 25s; if no frame received
 *     in the last 60s the socket is considered dead and force-reconnected.
 *   - Token is read lazily via `getAuthToken()` on every connect attempt
 *     and appended as a `?token=` query param, matching the server auth
 *     shim added in Phase 3b. If the token changes mid-session, callers
 *     should call `reconnect()` or just disconnect+connect.
 *   - Version mismatch frames are dropped with a warning; they MUST NOT
 *     be surfaced to listeners, since the payload shape is unknown.
 */

import type { Envelope, EventKind, QueryKind } from "@northstar/core";
import { PROTOCOL_VERSION } from "@northstar/core";
import { getAuthTokenSync } from "./auth";
import { createLogger } from "../utils/logger";

const log = createLogger("ws");

/**
 * Strongly-typed payload map for each inbound event kind. Listeners are
 * narrowed by the kind they subscribe to.
 */
export type EventPayloads = {
  "ai:stream-start": { streamId: string; kind: string };
  "ai:token-delta": { streamId: string; delta: string };
  "ai:stream-end": { streamId: string; finishReason?: string };
  "agent:progress": {
    agentId: string;
    phase: string;
    message?: string;
    percent?: number;
  };
  "view:invalidate": { viewKinds: QueryKind[] };
  "reminder:triggered": { reminderId: string; title: string; body?: string };
};

type Listener<K extends EventKind> = (
  data: EventPayloads[K],
  streamId?: string,
) => void;

// Listeners stored as `Set<Listener<any>>` because TS can't express an
// existentially-quantified heterogeneous map directly. The public API
// (`subscribe<K>`) preserves the proper type at registration.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyListener = Listener<any>;

const RECONNECT_INITIAL_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const STABLE_RESET_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 25_000;
const DEAD_THRESHOLD_MS = 60_000;

function wsUrl(): string {
  const httpBase = (
    (import.meta.env.VITE_CLOUD_API_URL as string | undefined) || ""
  ).replace(/\/$/, "");
  if (!httpBase) {
    throw new Error("wsClient: VITE_CLOUD_API_URL is not set");
  }
  const wsBase = httpBase.replace(/^http/, "ws");
  const token = encodeURIComponent(getAuthTokenSync() ?? "");
  return `${wsBase}/ws?token=${token}`;
}

class WsClient {
  private socket: WebSocket | null = null;
  private listeners = new Map<EventKind, Set<AnyListener>>();
  private reconnectDelay = RECONNECT_INITIAL_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private stableTimer: ReturnType<typeof setTimeout> | null = null;
  private lastFrameAt = 0;
  private intentionallyClosed = false;
  private tokenAtConnect: string | null = null;

  isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  connect(): void {
    this.intentionallyClosed = false;
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }
    let url: string;
    try {
      url = wsUrl();
    } catch (err) {
      log.warn("cannot build ws url", (err as Error).message);
      return;
    }

    this.tokenAtConnect = getAuthTokenSync();
    log.debug("connecting", url);

    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch (err) {
      log.error("WebSocket constructor threw", (err as Error).message);
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      log.info("open");
      this.lastFrameAt = Date.now();
      this.startHeartbeat();
      // Reset backoff only after the connection has been stable for a while.
      if (this.stableTimer) clearTimeout(this.stableTimer);
      this.stableTimer = setTimeout(() => {
        this.reconnectDelay = RECONNECT_INITIAL_MS;
      }, STABLE_RESET_MS);
    };

    socket.onmessage = (ev: MessageEvent) => {
      this.lastFrameAt = Date.now();
      let parsed: Envelope<unknown>;
      try {
        parsed = JSON.parse(ev.data as string) as Envelope<unknown>;
      } catch {
        log.warn("malformed frame, dropping");
        return;
      }
      if (parsed.v !== PROTOCOL_VERSION) {
        log.warn("protocol version mismatch, dropping frame", parsed.v);
        return;
      }
      // Silently ignore server-side pong/health frames that carry no
      // registered event kind.
      const kind = parsed.kind as EventKind;
      const set = this.listeners.get(kind);
      if (!set || set.size === 0) return;
      for (const listener of set) {
        try {
          listener(parsed.data, parsed.streamId);
        } catch (err) {
          log.error("listener threw", (err as Error).message);
        }
      }
    };

    socket.onerror = (ev) => {
      log.warn("socket error", (ev as Event).type);
    };

    socket.onclose = (ev) => {
      log.info("close", ev.code, ev.reason);
      this.stopHeartbeat();
      if (this.stableTimer) {
        clearTimeout(this.stableTimer);
        this.stableTimer = null;
      }
      this.socket = null;
      if (!this.intentionallyClosed) {
        this.scheduleReconnect();
      }
    };
  }

  disconnect(): void {
    this.intentionallyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.stableTimer) {
      clearTimeout(this.stableTimer);
      this.stableTimer = null;
    }
    this.stopHeartbeat();
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        /* ignore */
      }
      this.socket = null;
    }
    this.reconnectDelay = RECONNECT_INITIAL_MS;
  }

  /**
   * Register a typed listener for a given event kind. Returns an
   * unsubscribe function. Listeners are called with the envelope's `data`
   * and its optional `streamId`.
   */
  subscribe<K extends EventKind>(
    kind: K,
    listener: Listener<K>,
  ): () => void {
    let set = this.listeners.get(kind);
    if (!set) {
      set = new Set<AnyListener>();
      this.listeners.set(kind, set);
    }
    set.add(listener as AnyListener);
    return () => {
      const current = this.listeners.get(kind);
      if (!current) return;
      current.delete(listener as AnyListener);
      if (current.size === 0) this.listeners.delete(kind);
    };
  }

  /** Force a reconnect — public for callers that know the token rotated. */
  reconnect(): void {
    this.disconnect();
    this.intentionallyClosed = false;
    this.connect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = this.reconnectDelay;
    log.debug(`reconnect in ${delay}ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
      this.connect();
    }, delay);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      // If the token rotated since we opened, bounce the socket.
      if (getAuthTokenSync() !== this.tokenAtConnect) {
        log.info("token rotated, reconnecting");
        this.reconnect();
        return;
      }
      if (Date.now() - this.lastFrameAt > DEAD_THRESHOLD_MS) {
        log.warn("no frames in 60s, force-reconnecting");
        this.reconnect();
        return;
      }
      const sock = this.socket;
      if (sock && sock.readyState === WebSocket.OPEN) {
        try {
          sock.send(
            JSON.stringify({
              v: PROTOCOL_VERSION,
              kind: "ping",
              ts: new Date().toISOString(),
            }),
          );
        } catch (err) {
          log.warn("ping send failed", (err as Error).message);
        }
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

/** Singleton — import and call directly. */
export const wsClient = new WsClient();
