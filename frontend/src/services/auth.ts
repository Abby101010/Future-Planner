/* NorthStar — auth token source
 *
 * The renderer never hardcodes a token at the call site. Every HTTP request
 * to the cloud API reads it from here. Backed by the Supabase Auth session:
 * getAuthToken() is async (for transport/fetch callers), getAuthTokenSync()
 * returns a cached value (for WebSocket and other sync callers).
 *
 * The onAuthStateChange listener keeps the cached token up to date and
 * triggers WS reconnection when the token changes.
 */

import { supabase } from "./supabase";

// Module-level cached token, updated by onAuthStateChange below.
let cachedToken: string | null = null;

// Subscribe to auth state changes at module scope. This fires on:
// - Initial session restore from localStorage
// - Sign in / sign up
// - Token refresh
// - Sign out
supabase.auth.onAuthStateChange((_event, session) => {
  cachedToken = session?.access_token ?? null;
});

// Hydrate cached token immediately from any persisted session.
supabase.auth.getSession().then(({ data }) => {
  cachedToken = data.session?.access_token ?? null;
});

/**
 * Returns the bearer token to send with cloud API requests.
 * Async — reads from the Supabase session. Use this in fetch-based callers.
 */
export async function getAuthToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * Returns the cached bearer token synchronously. Updated by onAuthStateChange.
 * Use this in WebSocket and other sync contexts (wsUrl builder, heartbeat).
 */
export function getAuthTokenSync(): string | null {
  return cachedToken;
}
