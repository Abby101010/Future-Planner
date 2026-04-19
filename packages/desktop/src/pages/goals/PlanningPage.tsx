/* PlanningPage — bare HTML. view:planning + goal/monthly-context commands. */

import { useState } from "react";
import { useQuery } from "../../hooks/useQuery";
import { useCommand } from "../../hooks/useCommand";
import useStore from "../../store/useStore";

export default function PlanningPage() {
  const setView = useStore((s) => s.setView);
  const { data, loading, error, refetch } = useQuery<{ goals?: { id: string; title: string }[] }>(
    "view:planning",
  );
  const { run } = useCommand();
  const [kind, setKind] = useState("command:create-goal");
  const [argsJson, setArgsJson] = useState(
    '{"title":"test goal","description":"","goalType":"big","importance":"medium","targetDate":""}',
  );
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
      <h1>view:planning</h1>
      {loading && <p>loading…</p>}
      {error && <pre>error: {String(error)}</pre>}
      <pre>{JSON.stringify(data, null, 2)}</pre>
      <button onClick={refetch}>refetch</button>

      <h2>open goal plan page</h2>
      {(data?.goals ?? []).map((g) => (
        <div key={g.id}>
          <button onClick={() => setView(`goal-plan-${g.id}` as never)}>
            {g.title} ({g.id})
          </button>
        </div>
      ))}

      <h2>commands</h2>
      <select value={kind} onChange={(e) => setKind(e.target.value)}>
        <option>command:create-goal</option>
        <option>command:update-goal</option>
        <option>command:delete-goal</option>
        <option>command:save-monthly-context</option>
        <option>command:delete-monthly-context</option>
        <option>command:set-vacation-mode</option>
        <option>command:adjust-all-overloaded-plans</option>
      </select>
      <div>
        <textarea
          rows={6}
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
