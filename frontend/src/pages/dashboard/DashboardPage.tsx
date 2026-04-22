/* DashboardPage — zero-styling view:dashboard renderer. */

import { useQuery } from "../../hooks/useQuery";
import { useCommand } from "../../hooks/useCommand";

type DashboardView = Record<string, unknown> & {
  todayDate?: string;
  greetingName?: string;
  todaySummary?: unknown;
  activeGoals?: Array<Record<string, unknown>>;
  todayTasks?: Array<Record<string, unknown>>;
  pendingTasks?: Array<Record<string, unknown>>;
  homeChatMessages?: Array<Record<string, unknown>>;
  activeReminders?: Array<Record<string, unknown>>;
  recentNudges?: Array<Record<string, unknown>>;
  dailyLoad?: unknown;
  vacationMode?: unknown;
  currentMonthContext?: unknown;
};

export default function DashboardPage() {
  const { data, loading, error, refetch } = useQuery<DashboardView>("view:dashboard");
  const { run } = useCommand();

  async function dispatch(kind: string, args: Record<string, unknown> = {}) {
    try {
      await run(kind as never, args);
    } catch (e) {
      console.error(kind, e);
    }
  }

  return (
    <section className="dashboard-page" data-testid="dashboard-page">
      <h1>view:dashboard</h1>
      {loading && <p data-testid="dashboard-loading">loading…</p>}
      {error && <pre data-testid="dashboard-error">error: {String(error)}</pre>}

      <div className="dashboard-actions" data-testid="dashboard-actions">
        <button className="dashboard-refetch" data-testid="dashboard-refetch" onClick={refetch}>
          refetch
        </button>
        <button data-testid="dashboard-refresh-daily-plan" onClick={() => dispatch("command:refresh-daily-plan")}>
          refresh-daily-plan
        </button>
        <button data-testid="dashboard-regenerate-daily-tasks" onClick={() => dispatch("command:regenerate-daily-tasks")}>
          regenerate-daily-tasks
        </button>
        <button data-testid="dashboard-confirm-daily-tasks" onClick={() => dispatch("command:confirm-daily-tasks")}>
          confirm-daily-tasks
        </button>
        <button data-testid="dashboard-generate-bonus-task" onClick={() => dispatch("command:generate-bonus-task")}>
          generate-bonus-task
        </button>
        <button data-testid="dashboard-propose-gap-fillers" onClick={() => dispatch("command:propose-gap-fillers")}>
          propose-gap-fillers
        </button>
      </div>

      <section data-testid="dashboard-today-summary">
        <h2>todaySummary / dailyLoad / vacationMode / currentMonthContext</h2>
        <pre>
          {JSON.stringify(
            {
              todayDate: data?.todayDate,
              greetingName: data?.greetingName,
              todaySummary: data?.todaySummary,
              dailyLoad: data?.dailyLoad,
              vacationMode: data?.vacationMode,
              currentMonthContext: data?.currentMonthContext,
            },
            null,
            2,
          )}
        </pre>
      </section>

      <section data-testid="dashboard-today-tasks">
        <h2>todayTasks</h2>
        <ul>
          {(data?.todayTasks ?? []).map((t, i) => {
            const id = String(t.id ?? i);
            return (
              <li key={id} data-testid={`dashboard-task-${id}`}>
                <code>{id}</code> — {String(t.title ?? "")}
                <button
                  data-testid={`dashboard-task-toggle-${id}`}
                  onClick={() => dispatch("command:toggle-task", { taskId: id })}
                >
                  toggle
                </button>
                <button
                  data-testid={`dashboard-task-skip-${id}`}
                  onClick={() => dispatch("command:skip-task", { taskId: id })}
                >
                  skip
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section data-testid="dashboard-active-goals">
        <h2>activeGoals</h2>
        <ul>
          {(data?.activeGoals ?? []).map((g, i) => {
            const id = String(g.id ?? i);
            return (
              <li key={id} data-testid={`dashboard-goal-${id}`}>
                <code>{id}</code> — {String(g.title ?? "")}
                <button
                  data-testid={`dashboard-goal-pause-${id}`}
                  onClick={() => dispatch("command:pause-goal", { goalId: id })}
                >
                  pause
                </button>
                <button
                  data-testid={`dashboard-goal-resume-${id}`}
                  onClick={() => dispatch("command:resume-goal", { goalId: id })}
                >
                  resume
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section data-testid="dashboard-pending-tasks">
        <h2>pendingTasks</h2>
        <ul>
          {(data?.pendingTasks ?? []).map((p, i) => {
            const id = String(p.id ?? i);
            return (
              <li key={id} data-testid={`dashboard-pending-${id}`}>
                <code>{id}</code> — {String(p.title ?? p.userInput ?? "")}
                <button
                  data-testid={`dashboard-pending-confirm-${id}`}
                  onClick={() => dispatch("command:confirm-pending-task", { pendingTaskId: id })}
                >
                  confirm
                </button>
                <button
                  data-testid={`dashboard-pending-reject-${id}`}
                  onClick={() => dispatch("command:reject-pending-task", { pendingTaskId: id })}
                >
                  reject
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section data-testid="dashboard-home-chat">
        <h2>homeChatMessages</h2>
        <ul>
          {(data?.homeChatMessages ?? []).map((m, i) => (
            <li key={i} data-testid={`dashboard-home-chat-${i}`}>
              <code>{String(m.role ?? m.author ?? "")}</code>: {String(m.content ?? m.text ?? "")}
            </li>
          ))}
        </ul>
      </section>

      <section data-testid="dashboard-active-reminders">
        <h2>activeReminders</h2>
        <ul>
          {(data?.activeReminders ?? []).map((r, i) => {
            const id = String(r.id ?? i);
            return (
              <li key={id} data-testid={`dashboard-reminder-${id}`}>
                <code>{id}</code> — {String(r.title ?? "")}
                <button
                  data-testid={`dashboard-reminder-ack-${id}`}
                  onClick={() => dispatch("command:acknowledge-reminder", { reminderId: id })}
                >
                  ack
                </button>
                <button
                  data-testid={`dashboard-reminder-delete-${id}`}
                  onClick={() => dispatch("command:delete-reminder", { reminderId: id })}
                >
                  delete
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section data-testid="dashboard-recent-nudges">
        <h2>recentNudges</h2>
        <ul>
          {(data?.recentNudges ?? []).map((n, i) => {
            const id = String(n.id ?? i);
            return (
              <li key={id} data-testid={`dashboard-nudge-${id}`}>
                <code>{id}</code> — {String(n.message ?? n.text ?? "")}
                <button
                  data-testid={`dashboard-nudge-dismiss-${id}`}
                  onClick={() => dispatch("command:dismiss-nudge", { nudgeId: id })}
                >
                  dismiss
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section data-testid="dashboard-raw">
        <h2>raw view:dashboard payload</h2>
        <pre>{JSON.stringify(data, null, 2)}</pre>
      </section>
    </section>
  );
}
