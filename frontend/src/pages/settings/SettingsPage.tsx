/* SettingsPage — bare HTML. view:settings + update-settings/reset-data. */

import { useEffect, useState } from "react";
import { useQuery } from "../../hooks/useQuery";
import { useCommand } from "../../hooks/useCommand";
import { useAuth } from "../../contexts/AuthContext";

export default function SettingsPage() {
  const { signOut } = useAuth();
  const { data, loading, error, refetch } = useQuery<unknown>("view:settings");
  const { run } = useCommand();
  const [settingsJson, setSettingsJson] = useState("{}");
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (data) {
      const d = data as { user?: { settings?: unknown } };
      if (d.user?.settings) setSettingsJson(JSON.stringify(d.user.settings, null, 2));
    }
  }, [data]);

  async function updateSettings() {
    setStatus("…");
    try {
      const settings = JSON.parse(settingsJson);
      await run("command:update-settings", { settings });
      setStatus("ok");
      refetch();
    } catch (e) {
      setStatus(`error: ${(e as Error).message}`);
    }
  }

  async function resetData() {
    if (!confirm("reset all user data?")) return;
    setStatus("…");
    try {
      await run("command:reset-data", {});
      setStatus("ok");
      refetch();
    } catch (e) {
      setStatus(`error: ${(e as Error).message}`);
    }
  }

  const enableNewsFeed =
    (data as { user?: { settings?: { enableNewsFeed?: boolean } } } | undefined)
      ?.user?.settings?.enableNewsFeed !== false; // default ON

  async function toggleNewsFeed() {
    setStatus("…");
    try {
      const currentSettings = JSON.parse(settingsJson);
      const newSettings = {
        ...currentSettings,
        enableNewsFeed: !enableNewsFeed,
      };
      await run("command:update-settings", { settings: newSettings });
      setSettingsJson(JSON.stringify(newSettings, null, 2));
      setStatus("ok");
      refetch();
    } catch (e) {
      setStatus(`error: ${(e as Error).message}`);
    }
  }

  return (
    <section className="settings-page" data-testid="settings-page">
      <h1>view:settings</h1>
      {loading && <p data-testid="settings-loading">loading…</p>}
      {error && <pre data-testid="settings-error">error: {String(error)}</pre>}
      <pre data-testid="settings-data">{JSON.stringify(data, null, 2)}</pre>
      <button className="settings-refetch" data-testid="settings-refetch" onClick={refetch}>
        refetch
      </button>

      <h2>command:update-settings — settings</h2>
      <textarea
        className="settings-settings-args"
        data-testid="settings-settings-args"
        rows={8}
        cols={60}
        value={settingsJson}
        onChange={(e) => setSettingsJson(e.target.value)}
      />
      <div>
        <button data-testid="settings-update-settings" onClick={updateSettings}>
          run update-settings
        </button>
      </div>

      <h2>News Feed visibility</h2>
      <label data-testid="settings-news-feed-toggle-label">
        <input
          type="checkbox"
          data-testid="settings-news-feed-toggle"
          checked={enableNewsFeed}
          onChange={toggleNewsFeed}
        />
        {" "}Show News Feed in sidebar
      </label>

      <h2>sign out</h2>
      <button data-testid="settings-sign-out" onClick={signOut}>
        sign out
      </button>

      <p data-testid="settings-status">status: {status || "idle"}</p>

      <details className="settings-danger-zone" data-testid="danger-zone">
        <summary>danger zone — irreversible admin actions</summary>
        <h3>command:reset-data</h3>
        <p>Wipes all user data. Require explicit opt-in before running.</p>
        <button data-testid="settings-reset-data" onClick={resetData}>
          run reset-data
        </button>
      </details>
    </section>
  );
}
