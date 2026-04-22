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

  async function pause(goalId: string) {
    try {
      await run("command:pause-goal", { goalId });
      refetch();
    } catch (e) {
      setStatus(`error: ${(e as Error).message}`);
    }
  }
  async function resume(goalId: string) {
    try {
      await run("command:resume-goal", { goalId });
      refetch();
    } catch (e) {
      setStatus(`error: ${(e as Error).message}`);
    }
  }

  return (
    <section className="planning-page" data-testid="planning-page">
      <h1>view:planning</h1>
      {loading && <p data-testid="planning-loading">loading…</p>}
      {error && <pre data-testid="planning-error">error: {String(error)}</pre>}
      <pre data-testid="planning-data">{JSON.stringify(data, null, 2)}</pre>
      <button className="planning-refetch" data-testid="planning-refetch" onClick={refetch}>
        refetch
      </button>

      <h2>open goal plan page</h2>
      {(data?.goals ?? []).map((g) => (
        <div key={g.id} className="planning-goal-row" data-testid={`planning-goal-${g.id}`}>
          <button
            data-testid={`planning-open-goal-${g.id}`}
            onClick={() => setView(`goal-plan-${g.id}` as never)}
          >
            {g.title} ({g.id})
          </button>
          <button
            data-testid={`planning-pause-goal-${g.id}`}
            onClick={() => pause(g.id)}
          >
            pause
          </button>
          <button
            data-testid={`planning-resume-goal-${g.id}`}
            onClick={() => resume(g.id)}
          >
            resume
          </button>
        </div>
      ))}

      <h2>commands</h2>
      <select
        className="planning-command-select"
        data-testid="planning-command-kind"
        value={kind}
        onChange={(e) => setKind(e.target.value)}
      >
        <option>command:create-goal</option>
        <option>command:update-goal</option>
        <option>command:delete-goal</option>
        <option>command:save-monthly-context</option>
        <option>command:delete-monthly-context</option>
        <option>command:set-vacation-mode</option>
        <option>command:adjust-all-overloaded-plans</option>
        <option>command:pause-goal</option>
        <option>command:resume-goal</option>
      </select>
      <div>
        <textarea
          className="planning-command-args"
          data-testid="planning-command-args"
          rows={6}
          cols={60}
          value={argsJson}
          onChange={(e) => setArgsJson(e.target.value)}
        />
      </div>
      <button className="planning-command-run" data-testid="planning-command-run" onClick={exec}>
        run
      </button>
      <p data-testid="planning-command-status">status: {status || "idle"}</p>
    </section>
  );
}
