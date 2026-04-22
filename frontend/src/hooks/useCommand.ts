/* NorthStar — useCommand hook (Phase 5b)
 *
 * Thin wrapper around `runCommand` so page components can dispatch a
 * mutation with a one-liner and still get `running` / `error` state for
 * button disabling and toast display.
 *
 * The hook intentionally does NOT wrap errors or retry — callers decide.
 * It also does not invalidate the cache; the server emits a
 * `view:invalidate` WS event after every command and `useQuery` picks it
 * up. That's the whole point of the envelope protocol.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { CommandKind } from "@northstar/core";
import { runCommand } from "../services/transport";

export interface UseCommandResult {
  run: <T>(kind: CommandKind, args: Record<string, unknown>) => Promise<T>;
  running: boolean;
  error?: Error;
}

export function useCommand(): UseCommandResult {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<Error | undefined>(undefined);

  // Guard against setState-after-unmount when a command resolves late.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const run = useCallback(
    async <T,>(kind: CommandKind, args: Record<string, unknown>): Promise<T> => {
      setRunning(true);
      setError(undefined);
      try {
        const result = await runCommand<T>(kind, args);
        if (mountedRef.current) setRunning(false);
        return result;
      } catch (err) {
        if (mountedRef.current) {
          setError(err as Error);
          setRunning(false);
        }
        throw err;
      }
    },
    [],
  );

  return { run, running, error };
}
