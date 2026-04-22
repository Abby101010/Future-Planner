/* GoalPlanPage — bare HTML. view:goal-plan (param) + plan-level commands. */

import { useState } from "react";
import { useQuery } from "../../hooks/useQuery";
import { useCommand } from "../../hooks/useCommand";

export default function GoalPlanPage({ goalId }: { goalId: string }) {
  const { data, loading, error, refetch } = useQuery<unknown>("view:goal-plan", { goalId });
  const { run } = useCommand();
  const [kind, setKind] = useState("command:adaptive-reschedule");
  const [argsJson, setArgsJson] = useState(`{"goalId":"${goalId}"}`);
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
      <h1>view:goal-plan (goalId={goalId})</h1>
      {loading && <p>loading…</p>}
      {error && <pre>error: {String(error)}</pre>}
      <pre>{JSON.stringify(data, null, 2)}</pre>
      <button onClick={refetch}>refetch</button>

      <h2>commands</h2>
      <select value={kind} onChange={(e) => setKind(e.target.value)}>
        <option>command:adaptive-reschedule</option>
        <option>command:adjust-all-overloaded-plans</option>
        <option>command:toggle-task</option>
        <option>command:expand-plan-week</option>
        <option>command:update-goal</option>
        <option>command:confirm-goal-plan</option>
        <option>command:regenerate-goal-plan</option>
        <option>command:reallocate-goal-plan</option>
        <option>command:regenerate-daily-tasks</option>
        <option>command:add-task-to-plan</option>
      </select>
      <div>
        <textarea
          rows={8}
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
