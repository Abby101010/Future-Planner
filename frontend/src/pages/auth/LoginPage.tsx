/* LoginPage — bare HTML test harness.
 *
 * Supabase email/password + Google OAuth. No styling. AuthGuard uses this
 * when no session exists; on success the parent provider swaps in the app.
 */

import { useState, type FormEvent } from "react";
import { supabase } from "../../services/supabase";

type Mode = "signin" | "signup";

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<string>("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus("…");
    const fn =
      mode === "signin"
        ? supabase.auth.signInWithPassword({ email: email.trim(), password })
        : supabase.auth.signUp({ email: email.trim(), password });
    const { error } = await fn;
    setStatus(error ? `error: ${error.message}` : `${mode} ok`);
  }

  async function handleGoogle() {
    setStatus("google…");
    const redirectTo = "http://localhost/auth/callback";
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { skipBrowserRedirect: true, redirectTo },
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
    <section>
      <h1>auth</h1>
      <form onSubmit={handleSubmit}>
        <div>
          <label>
            mode:&nbsp;
            <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
              <option value="signin">signin</option>
              <option value="signup">signup</option>
            </select>
          </label>
        </div>
        <div>
          <input
            type="email"
            placeholder="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <input
            type="password"
            placeholder="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button type="submit">{mode}</button>
      </form>
      <p>
        <button type="button" onClick={handleGoogle}>
          google oauth
        </button>
      </p>
      <p>status: {status || "idle"}</p>
    </section>
  );
}
