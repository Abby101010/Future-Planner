/* NorthStar — useAiStream hook (Phase 5b)
 *
 * Accumulates `ai:token-delta` events for a single streamId into a
 * component-local buffer and exposes `{ text, running, finished }`. When
 * the caller passes `null`, the hook is inert (returns empty state and
 * does not subscribe). Used by the chat UI and any other surface that
 * shows a streaming agent response.
 *
 * Intentionally does NOT write to Zustand — stream buffers are ephemeral
 * UI state and should not live in the global store. See the architectural
 * contract in Phase 5b docs.
 */

import { useEffect, useState } from "react";
import { wsClient } from "../services/wsClient";

export interface UseAiStreamResult {
  text: string;
  running: boolean;
  finished: boolean;
}

export function useAiStream(streamId: string | null): UseAiStreamResult {
  const [text, setText] = useState("");
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    if (!streamId) {
      setText("");
      setRunning(false);
      setFinished(false);
      return;
    }

    setText("");
    setRunning(true);
    setFinished(false);

    const unsubStart = wsClient.subscribe("ai:stream-start", (data, sid) => {
      const id = sid ?? data?.streamId;
      if (id !== streamId) return;
      setRunning(true);
      setFinished(false);
    });

    const unsubDelta = wsClient.subscribe("ai:token-delta", (data, sid) => {
      const id = sid ?? data?.streamId;
      if (id !== streamId) return;
      const delta = data?.delta ?? "";
      if (!delta) return;
      setText((prev) => prev + delta);
    });

    const unsubEnd = wsClient.subscribe("ai:stream-end", (data, sid) => {
      const id = sid ?? data?.streamId;
      if (id !== streamId) return;
      setRunning(false);
      setFinished(true);
    });

    return () => {
      unsubStart();
      unsubDelta();
      unsubEnd();
    };
  }, [streamId]);

  return { text, running, finished };
}
