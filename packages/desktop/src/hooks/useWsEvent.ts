/* NorthStar — useWsEvent hook (Phase 5b)
 *
 * Subscribe a React component to a single WebSocket event kind for its
 * lifetime. The listener reference is captured in a ref so callers can
 * pass an inline arrow function without thrashing subscriptions.
 */

import { useEffect, useRef } from "react";
import type { EventKind } from "@northstar/core";
import { wsClient, type EventPayloads } from "../services/wsClient";

export function useWsEvent<K extends EventKind>(
  kind: K,
  listener: (data: EventPayloads[K], streamId?: string) => void,
): void {
  const listenerRef = useRef(listener);
  listenerRef.current = listener;

  useEffect(() => {
    const unsub = wsClient.subscribe<K>(kind, (data, streamId) => {
      listenerRef.current(data, streamId);
    });
    return unsub;
  }, [kind]);
}
