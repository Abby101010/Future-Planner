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
    <section>
      <h1>view:calendar</h1>
      {loading && <p>loading…</p>}
      {error && <pre>error: {String(error)}</pre>}
      <pre>{JSON.stringify(data, null, 2)}</pre>
      <button onClick={refetch}>refetch</button>

      <h2>commands</h2>
      <select value={kind} onChange={(e) => setKind(e.target.value)}>
        <option>command:create-task</option>
        <option>command:update-task</option>
        <option>command:delete-task</option>
        <option>command:toggle-task</option>
      </select>
      <div>
        <textarea
          rows={5}
          cols={60}
          value={argsJson}
          onChange={(e) => setArgsJson(e.target.value)}
        />
      </div>
      <button onClick={exec}>run</button>
      <p>status: {status || "idle"}</p>
    </section>
  );
}
