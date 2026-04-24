/* LoginPage — designed Supabase auth screen.
 *
 * Contract (lines 15-23): email/password (signInWithPassword / signUp) +
 * Google OAuth (signInWithOAuth + exchangeCodeForSession on callback).
 * All handled via the existing Supabase SDK in services/supabase.ts and the
 * Electron deep-link exchange in contexts/AuthContext.tsx.
 */

import { useState, type FormEvent } from "react";
import { supabase } from "../../services/supabase";
import Icon from "../../components/primitives/Icon";
import Button from "../../components/primitives/Button";

type Mode = "signin" | "signup";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<Mode>("signin");
  const [status, setStatus] = useState<string>("");

  const canSubmit = email.includes("@") && password.length >= 6;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setStatus("…");
    const { error } =
      mode === "signin"
        ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
        : await supabase.auth.signUp({ email: email.trim(), password });
    setStatus(error ? `error: ${error.message}` : `${mode} ok`);
  }

  async function handleGoogle() {
    setStatus("google…");
    const redirectTo = "http://localhost/auth/callback";

    // Clear any stale Supabase session first so the new account's session
    // fully replaces the old one — otherwise a partially-cached token can
    // shadow the fresh exchange on first render.
    try {
      await supabase.auth.signOut();
    } catch {
      /* no session to sign out of — fine */
    }

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        skipBrowserRedirect: true,
        redirectTo,
        // Force Google to show the account chooser every time, even when the
        // browser already has a signed-in Google session. Without this, Google
        // silently reuses the last-used account and the flow feels like
        // "skipped OAuth". See Google's OIDC "prompt" parameter docs.
        queryParams: { prompt: "select_account" },
      },
    });
    if (error) {
      setStatus(`error: ${error.message}`);
      return;
    }
    if (!data.url) {
      setStatus("error: no oauth url");
      return;
    }
    if (window.electronAuth?.oauthPopup) {
      const code = await window.electronAuth.oauthPopup(data.url, redirectTo);
      if (code) {
        const { error: exErr } = await supabase.auth.exchangeCodeForSession(code);
        setStatus(exErr ? `error: ${exErr.message}` : "google ok");
      } else {
        setStatus("cancelled");
      }
    } else {
      window.location.href = data.url;
    }
  }

  return (
    <div
      data-testid="login-page"
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg)",
        padding: 40,
      }}
    >
      <div style={{ maxWidth: 380, width: "100%", textAlign: "center" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 10, marginBottom: 32 }}>
          <Icon name="north-star" size={28} style={{ color: "var(--accent)" }} />
          <span className="h-display" style={{ fontSize: 22, color: "var(--fg)" }}>
            Starward
          </span>
        </div>
        <h1
          className="h-display"
          style={{
            margin: "0 0 8px",
            fontSize: "var(--t-3xl)",
            color: "var(--fg)",
            lineHeight: 1.15,
          }}
        >
          {mode === "signin" ? "Welcome back." : "Create your account."}
        </h1>
        <p style={{ margin: 0, fontSize: "var(--t-md)", color: "var(--fg-mute)" }}>
          {mode === "signin" ? "Sign in with Google or email." : "Sign up with Google or email."}
        </p>

        <Button
          size="lg"
          icon="google"
          onClick={handleGoogle}
          style={{
            width: "100%",
            marginTop: 24,
            justifyContent: "center",
            background: "var(--white)",
            color: "var(--fg)",
          }}
          data-api="Supabase SDK: signInWithOAuth"
          data-testid="login-google"
        >
          Continue with Google
        </Button>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            margin: "20px 0",
            color: "var(--fg-faint)",
            fontSize: 10,
          }}
        >
          <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
          OR
          <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
        </div>

        <div
          style={{
            display: "inline-flex",
            border: "1px solid var(--border)",
            borderRadius: 4,
            overflow: "hidden",
            marginBottom: 12,
          }}
        >
          {(["signin", "signup"] as const).map((m) => (
            <button
              key={m}
              data-testid={`login-mode-${m}`}
              onClick={() => setMode(m)}
              style={{
                padding: "5px 14px",
                fontSize: 11,
                fontWeight: mode === m ? 600 : 500,
                background: mode === m ? "var(--navy)" : "transparent",
                color: mode === m ? "var(--white)" : "var(--fg-mute)",
                border: 0,
                cursor: "pointer",
                textTransform: "capitalize",
              }}
            >
              {m === "signin" ? "Sign in" : "Sign up"}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit}>
          <input
            data-testid="login-email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@domain.com"
            type="email"
            style={{
              width: "100%",
              padding: "10px 12px",
              border: "1px solid var(--border)",
              borderRadius: "var(--r-md)",
              fontSize: "var(--t-md)",
              marginBottom: 8,
            }}
          />
          <input
            data-testid="login-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            type="password"
            style={{
              width: "100%",
              padding: "10px 12px",
              border: "1px solid var(--border)",
              borderRadius: "var(--r-md)",
              fontSize: "var(--t-md)",
              marginBottom: 10,
            }}
          />

          <Button
            size="lg"
            tone="primary"
            type="submit"
            disabled={!canSubmit}
            style={{ width: "100%", justifyContent: "center" }}
            data-api={mode === "signup" ? "Supabase SDK: signUp" : "Supabase SDK: signInWithPassword"}
            data-testid="login-submit"
          >
            {mode === "signin" ? "Sign in" : "Create account"}
          </Button>
        </form>

        {status && (
          <div
            data-testid="login-status"
            style={{
              marginTop: 12,
              fontSize: 11,
              color: status.startsWith("error") ? "var(--danger)" : "var(--fg-mute)",
            }}
          >
            {status}
          </div>
        )}

        <div style={{ marginTop: 20, fontSize: 10, color: "var(--fg-faint)" }}>
          Post-redirect callback uses{" "}
          <span style={{ fontFamily: "var(--font-mono)" }}>exchangeCodeForSession</span>.
        </div>
      </div>
    </div>
  );
}
