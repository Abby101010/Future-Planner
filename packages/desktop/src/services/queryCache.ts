/* NorthStar — tiny in-memory query cache (Phase 5b)
 *
 * Module-level Map keyed by `${kind}|${JSON.stringify(args)}`. Used by the
 * home-rolled `useQuery` hook so that a component remounting within its
 * staleness window sees cached data immediately while a background
 * revalidation runs. NO eviction policy, NO persistence. Task 18/19 will
 * decide whether to keep this or fold it into a React context.
 *
 * Do not add domain logic here. Stores `unknown` and lets the hook cast.
 */

import type { QueryKind } from "@northstar/core";

export interface CacheEntry {
  data: unknown;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

/** Deterministic cache key. JSON.stringify(undefined) is handled as "". */
export function cacheKey(kind: QueryKind, args?: Record<string, unknown>): string {
  return `${kind}|${args ? JSON.stringify(args) : ""}`;
}

export function get(key: string): CacheEntry | undefined {
  return cache.get(key);
}

export function set(key: string, data: unknown): void {
  cache.set(key, { data, fetchedAt: Date.now() });
}

/**
 * Invalidate every entry for the given query kind, regardless of args.
 * Called by the `view:invalidate` WebSocket listener inside useQuery.
 */
export function invalidate(kind: QueryKind): void {
  const prefix = `${kind}|`;
  for (const key of Array.from(cache.keys())) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

/** Nuke the entire cache — call on logout or user switch. */
export function clear(): void {
  cache.clear();
}
