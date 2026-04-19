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
  const [availabilityJson, setAvailabilityJson] = useState("[]");
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (data) {
      const d = data as { user?: { settings?: unknown; weeklyAvailability?: unknown } };
      if (d.user?.settings) setSettingsJson(JSON.stringify(d.user.settings, null, 2));
      if (d.user?.weeklyAvailability)
        setAvailabilityJson(JSON.stringify(d.user.weeklyAvailability, null, 2));
    }
  }, [data]);

  async function updateSettings() {
    setStatus("…");
    try {
      const settings = JSON.parse(settingsJson);
      const weeklyAvailability = JSON.parse(availabilityJson);
      await run("command:update-settings", { settings, weeklyAvailability });
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

  return (
    <section>
      <h1>view:settings</h1>
      {loading && <p>loading…</p>}
      {error && <pre>error: {String(error)}</pre>}
      <pre>{JSON.stringify(data, null, 2)}</pre>
      <button onClick={refetch}>refetch</button>

      <h2>command:update-settings — settings</h2>
      <textarea
        rows={8}
        cols={60}
        value={settingsJson}
        onChange={(e) => setSettingsJson(e.target.value)}
      />

      <h2>command:update-settings — weeklyAvailability</h2>
      <textarea
        rows={8}
        cols={60}
        value={availabilityJson}
        onChange={(e) => setAvailabilityJson(e.target.value)}
      />
      <div>
        <button onClick={updateSettings}>run update-settings</button>
      </div>

      <h2>command:reset-data</h2>
      <button onClick={resetData}>run reset-data</button>

      <h2>sign out</h2>
      <button onClick={signOut}>sign out</button>

      <p>status: {status || "idle"}</p>
    </section>
  );
}
