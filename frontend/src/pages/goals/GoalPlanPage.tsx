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

  // ── add-task-to-plan form ─────────────────────────────────
  const [addDate, setAddDate] = useState("");
  const [addTitle, setAddTitle] = useState("");
  const [addMinutes, setAddMinutes] = useState("30");
  const [addWeight, setAddWeight] = useState("3");
  const [addForce, setAddForce] = useState(false);
  const [addStatus, setAddStatus] = useState("");
  const [addResult, setAddResult] = useState<unknown>(null);

  async function addTaskToPlan() {
    setAddStatus("…");
    setAddResult(null);
    try {
      const r = await run("command:add-task-to-plan", {
        goalId,
        date: addDate,
        title: addTitle,
        durationMinutes: Number(addMinutes) || 30,
        cognitiveWeight: Number(addWeight) || 3,
        force: addForce,
      });
      setAddResult(r);
      setAddStatus("ok");
      refetch();
    } catch (e) {
      setAddStatus(`error: ${(e as Error).message}`);
    }
  }

  // ── expand-plan-week form ─────────────────────────────────
  const [expandWeekId, setExpandWeekId] = useState("");
  const [expandStatus, setExpandStatus] = useState("");
  const [expandResult, setExpandResult] = useState<unknown>(null);

  async function expandPlanWeek() {
    if (!expandWeekId.trim()) {
      setExpandStatus("weekId required");
      return;
    }
    setExpandStatus("…");
    setExpandResult(null);
    try {
      const r = await run("command:expand-plan-week", { goalId, weekId: expandWeekId });
      setExpandResult(r);
      setExpandStatus("ok");
      refetch();
    } catch (e) {
      setExpandStatus(`error: ${(e as Error).message}`);
    }
  }

  return (
    <section className="goal-plan-page" data-testid="goal-plan-page">
      <h1>view:goal-plan (goalId={goalId})</h1>
      {loading && <p data-testid="goal-plan-loading">loading…</p>}
      {error && <pre data-testid="goal-plan-error">error: {String(error)}</pre>}
      <pre data-testid="goal-plan-data">{JSON.stringify(data, null, 2)}</pre>
      <button className="goal-plan-refetch" data-testid="goal-plan-refetch" onClick={refetch}>
        refetch
      </button>

      <h2>add-task-to-plan</h2>
      <div className="goal-plan-add-form" data-testid="goal-plan-add-form">
        <label>
          date (YYYY-MM-DD):
          <input
            data-testid="goal-plan-add-date"
            value={addDate}
            onChange={(e) => setAddDate(e.target.value)}
            placeholder="2026-04-22"
          />
        </label>
        <label>
          title:
          <input
            data-testid="goal-plan-add-title"
            value={addTitle}
            onChange={(e) => setAddTitle(e.target.value)}
          />
        </label>
        <label>
          durationMinutes:
          <input
            data-testid="goal-plan-add-minutes"
            type="number"
            value={addMinutes}
            onChange={(e) => setAddMinutes(e.target.value)}
          />
        </label>
        <label>
          cognitiveWeight (1-5):
          <input
            data-testid="goal-plan-add-weight"
            type="number"
            value={addWeight}
            onChange={(e) => setAddWeight(e.target.value)}
          />
        </label>
        <label>
          <input
            type="checkbox"
            data-testid="goal-plan-add-force"
            checked={addForce}
            onChange={(e) => setAddForce(e.target.checked)}
          />
          force (override over-budget rejection)
        </label>
        <button data-testid="goal-plan-add-run" onClick={addTaskToPlan}>
          run add-task-to-plan
        </button>
        <span data-testid="goal-plan-add-status">&nbsp;{addStatus}</span>
        {addResult != null && (
          <pre data-testid="goal-plan-add-result">{JSON.stringify(addResult, null, 2)}</pre>
        )}
      </div>

      <h2>expand-plan-week</h2>
      <div className="goal-plan-expand-form" data-testid="goal-plan-expand-form">
        <label>
          weekId:
          <input
            data-testid="goal-plan-expand-week-id"
            value={expandWeekId}
            onChange={(e) => setExpandWeekId(e.target.value)}
            placeholder="week-…"
          />
        </label>
        <button data-testid="goal-plan-expand-run" onClick={expandPlanWeek}>
          run expand-plan-week
        </button>
        <span data-testid="goal-plan-expand-status">&nbsp;{expandStatus}</span>
        {expandResult != null && (
          <pre data-testid="goal-plan-expand-result">{JSON.stringify(expandResult, null, 2)}</pre>
        )}
      </div>

      <h2>raw commands (JSON editor)</h2>
      <select
        className="goal-plan-command-select"
        data-testid="goal-plan-command-kind"
        value={kind}
        onChange={(e) => setKind(e.target.value)}
      >
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
          className="goal-plan-command-args"
          data-testid="goal-plan-command-args"
          rows={8}
          cols={60}
          value={argsJson}
          onChange={(e) => setArgsJson(e.target.value)}
        />
      </div>
      <button
        className="goal-plan-command-run"
        data-testid="goal-plan-command-run"
        onClick={exec}
      >
        run
      </button>
      <p data-testid="goal-plan-command-status">status: {status || "idle"}</p>
    </section>
  );
}
