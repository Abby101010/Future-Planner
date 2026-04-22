/* NorthStar — Auth guard
 *
 * Gates the entire app behind authentication. Shows a loading spinner while
 * the session hydrates, LoginPage when unauthenticated, or children when
 * a valid session exists.
 */

import type { ReactNode } from "react";
import { useAuth } from "../contexts/AuthContext";
import LoginPage from "../pages/auth/LoginPage";

export default function AuthGuard({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();

  if (loading) return <p>loading…</p>;
  if (!session) return <LoginPage />;
  return <>{children}</>;
}
