/* GoalBreakdownPage — view:goal-breakdown + ai:goal-breakdown trigger. */

import { useState } from "react";
import { useQuery } from "../../hooks/useQuery";
import { postJson } from "../../services/transport";

type GoalBreakdownView = {
  goalBreakdown: unknown;
  scheduledTasks: Array<Record<string, unknown>>;
};

export default function GoalBreakdownPage() {
  const [goalId, setGoalId] = useState("");
  const [breakdownStatus, setBreakdownStatus] = useState("");
  const [breakdownResult, setBreakdownResult] = useState<unknown>(null);
  const { data, loading, error, refetch } = useQuery<GoalBreakdownView>(
    "view:goal-breakdown",
    goalId ? { goalId } : undefined,
  );

  async function runBreakdown() {
    if (!goalId.trim()) {
      setBreakdownStatus("goalId required");
      return;
    }
    setBreakdownStatus("…");
    setBreakdownResult(null);
    try {
      const body = await postJson<unknown>("/ai/goal-breakdown", { goalId });
      setBreakdownResult(body);
      setBreakdownStatus("ok");
      refetch();
    } catch (e) {
      setBreakdownStatus(`error: ${(e as Error).message}`);
    }
  }

  return (
    <section className="goal-breakdown-page" data-testid="goal-breakdown-page">
      <h1>view:goal-breakdown</h1>
      <label data-testid="goal-breakdown-goal-id-label">
        goalId:
        <input
          className="goal-breakdown-goal-id-input"
          data-testid="goal-breakdown-goal-id"
          value={goalId}
          onChange={(e) => setGoalId(e.target.value)}
          placeholder="goal-…"
        />
      </label>
      <div className="goal-breakdown-actions" data-testid="goal-breakdown-actions">
        <button data-testid="goal-breakdown-refetch" onClick={refetch}>
          refetch
        </button>
        <button data-testid="goal-breakdown-run" onClick={runBreakdown}>
          POST /ai/goal-breakdown
        </button>
        <span data-testid="goal-breakdown-status">&nbsp;{breakdownStatus}</span>
      </div>
      {breakdownResult != null && (
        <pre data-testid="goal-breakdown-run-result">
          {JSON.stringify(breakdownResult, null, 2)}
        </pre>
      )}
      {loading && <p data-testid="goal-breakdown-loading">loading…</p>}
      {error && <pre data-testid="goal-breakdown-error">error: {String(error)}</pre>}
      <section data-testid="goal-breakdown-tree">
        <h2>breakdown tree</h2>
        <pre>{JSON.stringify(data?.goalBreakdown ?? null, null, 2)}</pre>
      </section>
      <section data-testid="goal-breakdown-scheduled">
        <h2>scheduledTasks ({data?.scheduledTasks?.length ?? 0})</h2>
        <pre>{JSON.stringify(data?.scheduledTasks ?? [], null, 2)}</pre>
      </section>
    </section>
  );
}
