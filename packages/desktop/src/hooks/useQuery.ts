/* NorthStar — useQuery hook (Phase 5b)
 *
 * Display-only data fetch. One call per page, one GET per call. The hook:
 *   1. On mount, serves cached data (if fresh-ish) immediately while
 *      firing a background revalidation via `queryView`.
 *   2. Re-fetches whenever the kind or stringified args change.
 *   3. Auto-refetches on `view:invalidate` WebSocket events that name
 *      the current kind (the server tells us what to invalidate).
 *
 * This is intentionally a hand-rolled micro-implementation — we do NOT
 * want React Query or SWR as a dep. Task 18/19 will decide whether to
 * pull one in.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { QueryKind } from "@northstar/core";
import { queryView } from "../services/transport";
import { cacheKey, get as cacheGet, set as cacheSet, invalidate as cacheInvalidate } from "../services/queryCache";
import { wsClient } from "../services/wsClient";

const FRESH_WINDOW_MS = 5_000;

export interface UseQueryResult<T> {
  data?: T;
  loading: boolean;
  error?: Error;
  refetch: () => void;
}

export interface UseQueryOptions {
  enabled?: boolean;
}

export function useQuery<T>(
  kind: QueryKind,
  args?: Record<string, unknown>,
  opts?: UseQueryOptions,
): UseQueryResult<T> {
  const enabled = opts?.enabled !== false;
  const key = cacheKey(kind, args);

  // Seed synchronously from the module cache so that a remount within
  // the fresh window shows data without a flash.
  const initial = cacheGet(key);
  const [data, setData] = useState<T | undefined>(
    initial ? (initial.data as T) : undefined,
  );
  const [loading, setLoading] = useState<boolean>(enabled && !initial);
  const [error, setError] = useState<Error | undefined>(undefined);

  // Abort the in-flight fetch when args change or the component unmounts.
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(
    async (force: boolean): Promise<void> => {
      if (!enabled) return;
      const cached = cacheGet(key);
      if (cached && !force && Date.now() - cached.fetchedAt < FRESH_WINDOW_MS) {
        setData(cached.data as T);
        setLoading(false);
        return;
      }
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      if (!cached) setLoading(true);
      setError(undefined);
      try {
        const result = await queryView<T>(kind, args);
        if (controller.signal.aborted) return;
        cacheSet(key, result);
        setData(result);
        setLoading(false);
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err as Error);
        setLoading(false);
      }
    },
    // `key` captures both kind and args.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, enabled],
  );

  // Fetch on mount and when key/enabled changes.
  useEffect(() => {
    void run(false);
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  // Listen for server-driven cache invalidations.
  useEffect(() => {
    if (!enabled) return;
    const unsub = wsClient.subscribe("view:invalidate", (payload) => {
      if (!payload || !Array.isArray(payload.viewKinds)) return;
      if (payload.viewKinds.includes(kind)) {
        cacheInvalidate(kind);
        void run(true);
      }
    });
    return unsub;
  }, [kind, enabled, run]);

  const refetch = useCallback(() => {
    void run(true);
  }, [run]);

  return { data, loading, error, refetch };
}
