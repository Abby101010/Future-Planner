/* CalendarPage — bare HTML. view:calendar + task commands. */

import { useState } from "react";
import { useQuery } from "../../hooks/useQuery";
import { useCommand } from "../../hooks/useCommand";

export default function CalendarPage() {
  const { data, loading, error, refetch } = useQuery<unknown>("view:calendar");
  const { run } = useCommand();
  const [argsJson, setArgsJson] = useState(
    '{"title":"test","date":"2026-04-19","durationMinutes":30}',
  );
  const [kind, setKind] = useState("command:create-task");
  const [status, setStatus] = useState("");

  async function exec() {
    setStatus("…");
    try {
      await run(kind as never, JSON.parse(argsJson));
      setStatus("ok");
      refetch();
    } catch (e) {
      setStatus(`error: ${(e as Error).message}`);
    }
  }

  return (
    <section className="calendar-page" data-testid="calendar-page">
      <h1>view:calendar</h1>
      {loading && <p data-testid="calendar-loading">loading…</p>}
      {error && <pre data-testid="calendar-error">error: {String(error)}</pre>}
      <pre data-testid="calendar-data">{JSON.stringify(data, null, 2)}</pre>
      <button className="calendar-refetch" data-testid="calendar-refetch" onClick={refetch}>
        refetch
      </button>

      <h2>commands</h2>
      <select
        className="calendar-command-select"
        data-testid="calendar-command-kind"
        value={kind}
        onChange={(e) => setKind(e.target.value)}
      >
        <option>command:create-task</option>
        <option>command:update-task</option>
        <option>command:delete-task</option>
        <option>command:toggle-task</option>
        <option>command:set-task-time-block</option>
        <option>command:set-task-project-tag</option>
        <option>command:reschedule-task</option>
      </select>
      <div>
        <textarea
          className="calendar-command-args"
          data-testid="calendar-command-args"
          rows={5}
          cols={60}
          value={argsJson}
          onChange={(e) => setArgsJson(e.target.value)}
        />
      </div>
      <button className="calendar-command-run" data-testid="calendar-command-run" onClick={exec}>
        run
      </button>
      <p data-testid="calendar-command-status">status: {status || "idle"}</p>
    </section>
  );
}
