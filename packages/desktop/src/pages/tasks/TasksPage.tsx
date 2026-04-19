/* TasksPage — bare HTML. view:tasks + every task/reminder/nudge command. */

import { useState } from "react";
import { useQuery } from "../../hooks/useQuery";
import { useCommand } from "../../hooks/useCommand";
import { useReminderNotifications } from "../../hooks/useReminderNotifications";
import type { Reminder } from "@northstar/core";

type Args = Record<string, unknown>;

function CmdForm({
  label,
  defaultArgs,
  onRun,
}: {
  label: string;
  defaultArgs: Args;
  onRun: (args: Args) => Promise<void>;
}) {
  const [argsJson, setArgsJson] = useState(JSON.stringify(defaultArgs, null, 2));
  const [status, setStatus] = useState("");
  return (
    <div style={{ margin: "8px 0" }}>
      <div><code>{label}</code></div>
      <textarea
        rows={3}
        cols={60}
        value={argsJson}
        onChange={(e) => setArgsJson(e.target.value)}
      />
      <div>
        <button
          onClick={async () => {
            setStatus("…");
            try {
              await onRun(JSON.parse(argsJson));
              setStatus("ok");
            } catch (e) {
              setStatus(`error: ${(e as Error).message}`);
            }
          }}
        >
          run
        </button>
        <span>&nbsp;{status}</span>
      </div>
    </div>
  );
}

export default function TasksPage() {
  const { data, loading, error, refetch } = useQuery<{ reminders?: Reminder[] }>("view:tasks");
  useReminderNotifications(data?.reminders ?? []);
  const { run } = useCommand();

  const commands: { kind: string; defaults: Args }[] = [
    { kind: "command:toggle-task", defaults: { taskId: "" } },
    { kind: "command:skip-task", defaults: { taskId: "" } },
    { kind: "command:delete-task", defaults: { taskId: "" } },
    { kind: "command:update-task", defaults: { taskId: "", patch: {} } },
    { kind: "command:reschedule-task", defaults: { taskId: "", newDate: "" } },
    { kind: "command:create-task", defaults: { title: "", date: "", durationMinutes: 30 } },
    { kind: "command:delete-tasks-for-date", defaults: { date: "" } },
    { kind: "command:confirm-daily-tasks", defaults: {} },
    { kind: "command:refresh-daily-plan", defaults: {} },
    { kind: "command:regenerate-daily-tasks", defaults: {} },
    { kind: "command:generate-bonus-task", defaults: {} },
    { kind: "command:accept-task-proposal", defaults: { proposalId: "" } },
    { kind: "command:cant-complete-task", defaults: { taskId: "", reason: "" } },
    { kind: "command:defer-overflow", defaults: { taskIds: [] } },
    { kind: "command:undo-defer", defaults: {} },
    { kind: "command:snooze-reschedule", defaults: { goalId: "" } },
    { kind: "command:dismiss-reschedule", defaults: { goalId: "" } },
    { kind: "command:confirm-pending-task", defaults: { pendingTaskId: "" } },
    { kind: "command:reject-pending-task", defaults: { pendingTaskId: "" } },
    { kind: "command:create-pending-task", defaults: { userInput: "" } },
    { kind: "command:upsert-reminder", defaults: { title: "", reminderTime: "", date: "" } },
    { kind: "command:acknowledge-reminder", defaults: { reminderId: "" } },
    { kind: "command:delete-reminder", defaults: { reminderId: "" } },
    { kind: "command:delete-reminders-batch", defaults: { reminderIds: [] } },
    { kind: "command:dismiss-nudge", defaults: { nudgeId: "" } },
  ];

  return (
    <section>
      <h1>view:tasks</h1>
      {loading && <p>loading…</p>}
      {error && <pre>error: {String(error)}</pre>}
      <pre>{JSON.stringify(data, null, 2)}</pre>
      <button onClick={refetch}>refetch</button>

      <h2>commands</h2>
      {commands.map((c) => (
        <CmdForm
          key={c.kind}
          label={c.kind}
          defaultArgs={c.defaults}
          onRun={(args) => run(c.kind as never, args)}
        />
      ))}
    </section>
  );
}
