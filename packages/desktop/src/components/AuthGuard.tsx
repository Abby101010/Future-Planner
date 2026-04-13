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

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          background: "var(--bg-primary)",
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            border: "3px solid var(--border)",
            borderTopColor: "var(--accent)",
            borderRadius: "50%",
            animation: "spin 0.8s linear infinite",
          }}
        />
      </div>
    );
  }

  if (!session) {
    return <LoginPage />;
  }

  return <>{children}</>;
}
