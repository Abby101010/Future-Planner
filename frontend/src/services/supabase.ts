/* Starward — Supabase client singleton
 *
 * Initializes the Supabase JS client with auth configured for:
 * - Automatic token refresh
 * - Session persistence in localStorage (sandboxed by Electron's contextIsolation)
 * - PKCE flow for OAuth (required for desktop apps)
 *
 * This is the single source of truth for the auth session on the desktop.
 */

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    "[supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY",
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    flowType: "pkce",
  },
});
