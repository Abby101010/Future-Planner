/* NorthStar — Login / Sign-up page
 *
 * Centered frosted-glass card with email+password auth and Google OAuth.
 * Renders inside AuthGuard when no session exists.
 */

import { useState, useEffect, useRef, type FormEvent } from "react";
import { supabase } from "../../services/supabase";
import { useT } from "../../i18n";
import "./LoginPage.css";

type Mode = "signin" | "signup";

/** Inline Google "G" logo — avoids an external image dependency. */
function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

export default function LoginPage() {
  const t = useT();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const loadingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up timeout on unmount (e.g. when auth succeeds and LoginPage disappears).
  useEffect(() => () => {
    if (loadingTimer.current) clearTimeout(loadingTimer.current);
  }, []);

  /** Set loading with an auto-reset timeout so the UI never gets stuck. */
  function startLoading(timeoutMs = 15_000) {
    setLoading(true);
    if (loadingTimer.current) clearTimeout(loadingTimer.current);
    if (timeoutMs > 0) {
      loadingTimer.current = setTimeout(() => {
        setLoading(false);
        setError(t.auth.errorTimeout);
      }, timeoutMs);
    }
  }

  function stopLoading() {
    setLoading(false);
    if (loadingTimer.current) {
      clearTimeout(loadingTimer.current);
      loadingTimer.current = null;
    }
  }

  const disabled = loading;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!email.trim() || !password) {
      setError(t.auth.errorEmpty);
      return;
    }

    if (mode === "signup" && password !== confirmPassword) {
      setError(t.auth.errorPasswordMismatch);
      return;
    }

    startLoading();
    try {
      if (mode === "signin") {
        const { error: err } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (err) {
          setError(err.message);
        }
        // On success, AuthContext picks up the session via onAuthStateChange.
      } else {
        const { error: err } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (err) {
          setError(err.message);
        } else {
          setSuccess(t.auth.signUpSuccess);
          setMode("signin");
          setPassword("");
          setConfirmPassword("");
        }
      }
    } catch {
      setError(t.auth.errorGeneric);
    } finally {
      stopLoading();
    }
  }

  async function handleGoogle() {
    setError(null);
    setSuccess(null);
    startLoading(0);

    try {
      // Use deep-link flow only in packaged Electron (not dev mode).
      // In dev mode the Electron window can redirect to Google directly,
      // just like a regular browser tab.
      const useDeepLink =
        !!window.electronAuth && !window.location.hostname.includes("localhost");

      const { data, error: err } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          skipBrowserRedirect: useDeepLink,
          redirectTo: useDeepLink
            ? "northstar://auth/callback"
            : window.location.origin,
        },
      });

      if (err) {
        setError(err.message);
        stopLoading();
        return;
      }

      if (useDeepLink && data.url) {
        window.electronAuth!.openExternal(data.url);
      }
      // Otherwise the current page navigates to Google automatically.
      // On return, detectSessionInUrl + onAuthStateChange handle the rest.
    } catch {
      setError(t.auth.errorGeneric);
      stopLoading();
    }
  }

  return (
    <div className="login">
      <div className="login-card">
        <h1 className="login-title">{t.auth.title}</h1>
        <p className="login-subtitle">
          {mode === "signin" ? t.auth.signInSubtitle : t.auth.signUpSubtitle}
        </p>

        <form className="login-form" onSubmit={handleSubmit}>
          {error && <div className="login-error">{error}</div>}
          {success && <div className="login-success">{success}</div>}

          <div className="login-field">
            <label htmlFor="login-email">{t.auth.email}</label>
            <input
              id="login-email"
              className="input"
              type="email"
              autoComplete="email"
              placeholder={t.auth.emailPlaceholder}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={disabled}
            />
          </div>

          <div className="login-field">
            <label htmlFor="login-password">{t.auth.password}</label>
            <input
              id="login-password"
              className="input"
              type="password"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              placeholder={t.auth.passwordPlaceholder}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={disabled}
            />
          </div>

          {mode === "signup" && (
            <div className="login-field">
              <label htmlFor="login-confirm">{t.auth.confirmPassword}</label>
              <input
                id="login-confirm"
                className="input"
                type="password"
                autoComplete="new-password"
                placeholder={t.auth.confirmPasswordPlaceholder}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={disabled}
              />
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary login-cta"
            disabled={disabled}
          >
            {loading ? (
              <span className="login-spinner" />
            ) : mode === "signin" ? (
              t.auth.signIn
            ) : (
              t.auth.createAccount
            )}
          </button>
        </form>

        <div className="login-divider">{t.auth.or}</div>

        <button
          className="btn btn-secondary login-google"
          onClick={handleGoogle}
          disabled={disabled}
        >
          <GoogleIcon />
          {t.auth.continueWithGoogle}
        </button>

        <p className="login-toggle">
          {mode === "signin" ? t.auth.noAccount : t.auth.hasAccount}{" "}
          <button
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setError(null);
              setSuccess(null);
            }}
            disabled={disabled}
          >
            {mode === "signin" ? t.auth.signUpLink : t.auth.signInLink}
          </button>
        </p>
      </div>
    </div>
  );
}
