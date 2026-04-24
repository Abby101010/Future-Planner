/* Starward — tiny in-memory query cache (Phase 5b)
 *
 * Module-level Map keyed by `${kind}|${JSON.stringify(args)}`. Used by the
 * home-rolled `useQuery` hook so that a component remounting within its
 * staleness window sees cached data immediately while a background
 * revalidation runs. NO eviction policy, NO persistence. Task 18/19 will
 * decide whether to keep this or fold it into a React context.
 *
 * Do not add domain logic here. Stores `unknown` and lets the hook cast.
 */

import type { QueryKind } from "@starward/core";

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
 * Mark every entry for the given query kind as stale (fetchedAt=0).
 * The data stays in cache so useQuery can show it while refetching
 * (stale-while-revalidate), avoiding a loading flash on every WS
 * invalidation.
 */
export function invalidate(kind: QueryKind): void {
  const prefix = `${kind}|`;
  for (const [key, entry] of cache.entries()) {
    if (key.startsWith(prefix)) entry.fetchedAt = 0;
  }
}

// ── Entity patching ─────────────────────────────────────

/**
 * Recursively walk all cached view data, find objects whose `id`
 * matches `entityId`, and merge `patch` into them. Returns the cache
 * keys that were modified so callers can trigger re-renders.
 */
export function patchEntity(
  entityId: string,
  patch: Record<string, unknown>,
): string[] {
  const affected: string[] = [];
  for (const [key, entry] of cache.entries()) {
    if (deepPatch(entry.data, entityId, patch)) {
      affected.push(key);
    }
  }
  return affected;
}

function deepPatch(
  obj: unknown,
  entityId: string,
  patch: Record<string, unknown>,
): boolean {
  if (!obj || typeof obj !== "object") return false;
  if (Array.isArray(obj)) {
    let found = false;
    for (const item of obj) {
      if (deepPatch(item, entityId, patch)) found = true;
    }
    return found;
  }
  const record = obj as Record<string, unknown>;
  let found = false;
  if (record.id === entityId) {
    Object.assign(record, patch);
    found = true;
  }
  for (const val of Object.values(record)) {
    if (val && typeof val === "object") {
      if (deepPatch(val, entityId, patch)) found = true;
    }
  }
  return found;
}

/** Nuke the entire cache — call on logout or user switch. */
export function clear(): void {
  cache.clear();
}
