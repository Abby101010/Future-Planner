/* NorthStar — Auth context
 *
 * Wraps the entire app. Provides the current Supabase auth session to all
 * components via useAuth(). Handles session hydration on mount, listens for
 * auth state changes, and exposes signOut().
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "../services/supabase";
import { wsClient } from "../services/wsClient";
import * as queryCache from "../services/queryCache";
import useStore from "../store/useStore";

interface AuthState {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  session: null,
  user: null,
  loading: true,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Hydrate from persisted localStorage session.
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    // Listen for all auth state changes (sign in, sign out, token refresh).
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(newSession);
        setLoading(false);
      },
    );

    // Electron deep-link listener: exchange OAuth code for session when
    // the system browser redirects back via northstar://auth/callback.
    const unsubDeepLink = window.electronAuth?.onDeepLink(async (url) => {
      try {
        const parsed = new URL(url);
        const code = parsed.searchParams.get("code");
        if (code) {
          await supabase.auth.exchangeCodeForSession(code);
        }
      } catch (err) {
        console.error("[auth] deep-link exchange failed:", err);
      }
    });

    return () => {
      subscription.unsubscribe();
      unsubDeepLink?.();
    };
  }, []);

  const signOut = useCallback(async () => {
    // 1. Disconnect WebSocket to prevent stale-token usage.
    wsClient.disconnect();

    // 2. Clear the in-memory query cache so the next user doesn't see old data.
    queryCache.clear();

    // 3. Sign out from Supabase (clears localStorage tokens).
    await supabase.auth.signOut();

    // 4. Reset the store view.
    useStore.getState().setView("welcome");
  }, []);

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        loading,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
