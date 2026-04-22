/* OnboardingPage — bare HTML. Reads view:onboarding, dispatches
 * command:complete-onboarding and command:update-settings. */

import { useState } from "react";
import { useQuery } from "../../hooks/useQuery";
import { useCommand } from "../../hooks/useCommand";

export default function OnboardingPage() {
  const { data, loading, error, refetch } = useQuery<unknown>("view:onboarding");
  const { run, running, error: cmdErr } = useCommand();
  const [goalRaw, setGoalRaw] = useState("");
  const [settingsJson, setSettingsJson] = useState(
    '{"enableNewsFeed":true,"theme":"system","language":"en"}',
  );
  const [status, setStatus] = useState("");

  async function complete() {
    setStatus("…");
    try {
      await run("command:complete-onboarding", { goalRaw });
      setStatus("onboarding completed");
      refetch();
    } catch (e) {
      setStatus(`error: ${(e as Error).message}`);
    }
  }

  async function updateSettings() {
    setStatus("…");
    try {
      const parsed = JSON.parse(settingsJson);
      await run("command:update-settings", { settings: parsed });
      setStatus("settings updated");
      refetch();
    } catch (e) {
      setStatus(`error: ${(e as Error).message}`);
    }
  }

  return (
    <section>
      <h1>view:onboarding</h1>
      {loading && <p>loading…</p>}
      {error && <pre>error: {String(error)}</pre>}
      <pre>{JSON.stringify(data, null, 2)}</pre>
      <button onClick={refetch}>refetch</button>

      <h2>command:complete-onboarding</h2>
      <input
        placeholder="goalRaw"
        value={goalRaw}
        onChange={(e) => setGoalRaw(e.target.value)}
      />
      <button disabled={running} onClick={complete}>
        run
      </button>

      <h2>command:update-settings</h2>
      <textarea
        rows={4}
        cols={60}
        value={settingsJson}
        onChange={(e) => setSettingsJson(e.target.value)}
      />
      <div>
        <button disabled={running} onClick={updateSettings}>
          run
        </button>
      </div>

      <p>status: {status || "idle"}</p>
      {cmdErr && <pre>cmdErr: {String(cmdErr)}</pre>}
    </section>
  );
}
