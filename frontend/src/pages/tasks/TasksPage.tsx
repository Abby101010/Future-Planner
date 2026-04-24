/* TasksPage — Home/Today. Absorbs legacy Dashboard (contract line 68).
 *
 * GET /view/tasks + /view/dashboard on mount. Every contract command in the
 * Tasks section is wired. Sub-components live alongside in pages/tasks/.
 */

import { useEffect, useState } from "react";
import useStore from "../../store/useStore";
import { useQuery } from "../../hooks/useQuery";
import { useCommand } from "../../hooks/useCommand";
import TopBar from "../../components/primitives/TopBar";
import Button from "../../components/primitives/Button";
import Banner from "../../components/primitives/Banner";
import { startJob } from "../../components/chrome/JobStatusDock";
import NotifStack from "./NotifStack";
import TaskRow from "./TaskRow";
import AddTaskLine from "./AddTaskLine";
import ReminderRow from "./ReminderRow";
import type {
  UITask,
  UIReminder,
  UIPendingTask,
  UIProposal,
  UINudge,
} from "./tasksTypes";

interface TasksView {
  tasks?: UITask[];
  reminders?: UIReminder[];
  pendingTasks?: UIPendingTask[];
  proposals?: UIProposal[];
  nudges?: UINudge[];
}

interface DashboardView {
  todayTasks?: UITask[];
  pendingTasks?: UIPendingTask[];
  reminders?: UIReminder[];
  nudges?: UINudge[];
  proposals?: UIProposal[];
  paceBanner?: { title?: string; body?: string } | null;
}

export default function TasksPage() {
  const tasksQ = useQuery<TasksView>("view:tasks");
  const dashQ = useQuery<DashboardView>("view:dashboard");
  const { run, running } = useCommand();
  const setChatOpen = useStore((s) => s.setChatOpen);
  const setChatChannel = useStore((s) => s.setChatChannel);
  const setPendingChatMessage = useStore((s) => s.setPendingChatMessage);

  const [showDone, setShowDone] = useState(false);
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && window.innerWidth < 1200,
  );
  const [cmdError, setCmdError] = useState<string | null>(null);

  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 1200);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const tasks: UITask[] = tasksQ.data?.tasks ?? dashQ.data?.todayTasks ?? [];
  const reminders: UIReminder[] = tasksQ.data?.reminders ?? dashQ.data?.reminders ?? [];
  const pending: UIPendingTask[] = tasksQ.data?.pendingTasks ?? dashQ.data?.pendingTasks ?? [];
  const proposals: UIProposal[] = tasksQ.data?.proposals ?? dashQ.data?.proposals ?? [];
  const nudges: UINudge[] = tasksQ.data?.nudges ?? dashQ.data?.nudges ?? [];

  function refetchAll() {
    tasksQ.refetch();
    dashQ.refetch();
  }

  const wrap = (fn: () => Promise<unknown>) => async () => {
    setCmdError(null);
    try {
      await fn();
    } catch (e) {
      setCmdError((e as Error).message);
    }
  };

  // Daily planning
  const refreshDaily = wrap(async () => {
    await run("command:refresh-daily-plan", {});
    refetchAll();
  });
  const regenerateDaily = wrap(async () => {
    const r = await run<{ jobId?: string }>("command:regenerate-daily-tasks", {});
    if (r?.jobId) startJob(r.jobId, "Regenerating daily tasks");
    refetchAll();
  });
  const confirmDaily = wrap(async () => {
    await run("command:confirm-daily-tasks", {});
    refetchAll();
  });
  const bonusTask = wrap(async () => {
    await run("command:generate-bonus-task", {});
    refetchAll();
  });
  const gapFillers = wrap(async () => {
    await run("command:propose-gap-fillers", {});
    refetchAll();
  });
  const estimateAll = wrap(async () => {
    await run("command:estimate-task-durations", { taskIds: tasks.map((t) => t.id) });
    refetchAll();
  });
  const deleteTasksForDate = wrap(async () => {
    if (!window.confirm("Delete all of today's tasks?")) return;
    await run("command:delete-tasks-for-date", {});
    refetchAll();
  });

  // Task CRUD
  const toggleTask = (id: string) =>
    wrap(async () => {
      await run("command:toggle-task", { taskId: id });
      refetchAll();
    })();
  const skipTask = (id: string) =>
    wrap(async () => {
      await run("command:skip-task", { taskId: id });
      refetchAll();
    })();
  const deleteTask = (id: string) =>
    wrap(async () => {
      await run("command:delete-task", { taskId: id });
      refetchAll();
    })();
  const rescheduleTask = (id: string, newDate: string) =>
    wrap(async () => {
      await run("command:reschedule-task", { taskId: id, newDate });
      refetchAll();
    })();
  const cantComplete = (id: string) =>
    wrap(async () => {
      await run("command:cant-complete-task", { taskId: id });
      refetchAll();
    })();
  const setTimeBlock = (id: string, timeBlock: string) =>
    wrap(async () => {
      await run("command:set-task-time-block", { taskId: id, timeBlock });
      refetchAll();
    })();
  const setProjectTag = (id: string, tag: string) =>
    wrap(async () => {
      await run("command:set-task-project-tag", { taskId: id, tag });
      refetchAll();
    })();
  const estimateOne = (id: string) =>
    wrap(async () => {
      await run("command:estimate-task-durations", { taskIds: [id] });
      refetchAll();
    })();
  const priorityFeedback = (id: string, feedback: string) =>
    wrap(async () => {
      await run("command:submit-priority-feedback", {
        feedback: { taskId: id, direction: feedback },
      });
      refetchAll();
    })();

  // Pending triage
  const confirmPending = (id: string) =>
    wrap(async () => {
      await run("command:confirm-pending-task", { pendingTaskId: id });
      refetchAll();
    })();
  const rejectPending = (id: string) =>
    wrap(async () => {
      await run("command:reject-pending-task", { pendingTaskId: id });
      refetchAll();
    })();

  // Proposals / reschedule
  const acceptProposal = (id: string) =>
    wrap(async () => {
      await run("command:accept-task-proposal", { proposalId: id });
      refetchAll();
    })();
  const snoozeProposal = (id: string) =>
    wrap(async () => {
      await run("command:snooze-reschedule", { proposalId: id });
      refetchAll();
    })();
  const dismissProposal = (id: string) =>
    wrap(async () => {
      await run("command:dismiss-reschedule", { proposalId: id });
      refetchAll();
    })();
  const deferOverflow = wrap(async () => {
    await run("command:defer-overflow", {
      taskIds: tasks.filter((t) => !(t.done ?? t.completed)).map((t) => t.id),
    });
    refetchAll();
  });
  const undoDefer = wrap(async () => {
    await run("command:undo-defer", { taskIds: [] });
    refetchAll();
  });

  // Reminders
  const ackReminder = (id: string) =>
    wrap(async () => {
      await run("command:acknowledge-reminder", { id });
      refetchAll();
    })();
  const delReminder = (id: string) =>
    wrap(async () => {
      await run("command:delete-reminder", { id });
      refetchAll();
    })();
  const addReminder = wrap(async () => {
    await run("command:upsert-reminder", {
      title: "New reminder",
      date: new Date().toISOString().slice(0, 10),
    });
    refetchAll();
  });
  const delRemindersBatch = wrap(async () => {
    await run("command:delete-reminders-batch", { ids: reminders.map((r) => r.id) });
    refetchAll();
  });

  // Nudges
  const dismissNudge = (id: string) =>
    wrap(async () => {
      await run("command:dismiss-nudge", { nudgeId: id });
      refetchAll();
    })();

  function askChatAboutPace() {
    setChatChannel("home");
    setPendingChatMessage("Help me recover pace on my slipping goal.");
    setChatOpen(true);
  }

  const visibleTasks = showDone ? tasks : tasks.filter((t) => !(t.done ?? t.completed));
  const doneCount = tasks.filter((t) => t.done ?? t.completed).length;
  const leftCount = tasks.length - doneCount;
  const plannedMin = tasks
    .filter((t) => !(t.done ?? t.completed))
    .reduce((sum, t) => sum + (t.duration ?? t.estimatedDurationMinutes ?? 0), 0);
  const plannedLabel = `${Math.floor(plannedMin / 60)}h ${plannedMin % 60}m`;

  const paceBanner = dashQ.data?.paceBanner;

  return (
    <>
      <TopBar
        eyebrow={new Date().toLocaleDateString(undefined, {
          weekday: "long",
          month: "long",
          day: "numeric",
        })}
        title="Today"
        right={
          <>
            <Button
              tone="ghost"
              size="sm"
              icon="refresh"
              onClick={refreshDaily}
              data-api="POST /commands/refresh-daily-plan"
              data-testid="tasks-refresh-daily"
              disabled={running}
            >
              Refresh
            </Button>
            <Button
              tone="ghost"
              size="sm"
              icon="bolt"
              onClick={regenerateDaily}
              data-api="POST /commands/regenerate-daily-tasks"
              data-testid="tasks-regenerate-daily"
              disabled={running}
            >
              Regenerate
            </Button>
            <Button
              tone="primary"
              size="sm"
              icon="check"
              onClick={confirmDaily}
              data-api="POST /commands/confirm-daily-tasks"
              data-testid="tasks-confirm-daily"
              disabled={running}
            >
              Confirm plan
            </Button>
          </>
        }
      />

      {tasksQ.loading && !tasksQ.data && (
        <div
          data-testid="tasks-loading"
          style={{ padding: 40, textAlign: "center", color: "var(--fg-faint)" }}
        >
          Loading tasks…
        </div>
      )}
      {tasksQ.error && (
        <div
          data-testid="tasks-error"
          style={{
            padding: 20,
            color: "var(--danger)",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
          }}
        >
          {String(tasksQ.error)}
        </div>
      )}
      {cmdError && (
        <div
          data-testid="tasks-cmd-error"
          style={{
            padding: 10,
            color: "var(--danger)",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
          }}
        >
          {cmdError}
        </div>
      )}

      {narrow && (
        <div style={{ maxWidth: 780, margin: "0 auto", width: "100%", padding: "12px 32px 0" }}>
          <NotifStack
            inline
            pending={pending}
            proposals={proposals}
            nudges={nudges}
            onConfirmPending={confirmPending}
            onRejectPending={rejectPending}
            onAcceptProposal={acceptProposal}
            onSnoozeProposal={snoozeProposal}
            onDismissProposal={dismissProposal}
            onDismissNudge={dismissNudge}
            onDeferOverflow={deferOverflow}
          />
        </div>
      )}
      {!narrow && (
        <NotifStack
          pending={pending}
          proposals={proposals}
          nudges={nudges}
          onConfirmPending={confirmPending}
          onRejectPending={rejectPending}
          onAcceptProposal={acceptProposal}
          onSnoozeProposal={snoozeProposal}
          onDismissProposal={dismissProposal}
          onDismissNudge={dismissNudge}
          onDeferOverflow={deferOverflow}
        />
      )}

      <div
        style={{
          maxWidth: 780,
          margin: "0 auto",
          width: "100%",
          padding: "56px 32px 140px",
          paddingRight:
            !narrow && pending.length + proposals.length + nudges.length > 0
              ? "calc(32px + 308px)"
              : 32,
          transition: "padding-right .25s ease",
          display: "flex",
          flexDirection: "column",
          gap: 56,
        }}
      >
        <section>
          <header
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              marginBottom: 8,
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
              <h2
                className="h-headline"
                style={{
                  margin: 0,
                  fontSize: "var(--t-2xl)",
                  color: "var(--fg)",
                  letterSpacing: "-0.01em",
                }}
              >
                Reminders
              </h2>
              <span
                style={{ fontSize: "var(--t-xs)", color: "var(--fg-faint)", fontWeight: 500 }}
              >
                {reminders.length}
              </span>
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              <Button
                size="xs"
                tone="ghost"
                icon="plus"
                onClick={addReminder}
                data-api="POST /commands/upsert-reminder"
                data-testid="reminders-add"
              >
                Add
              </Button>
              {reminders.length > 0 && (
                <Button
                  size="xs"
                  tone="ghost"
                  onClick={delRemindersBatch}
                  data-api="POST /commands/delete-reminders-batch"
                  data-testid="reminders-clear-all"
                >
                  Clear all
                </Button>
              )}
            </div>
          </header>
          {reminders.map((r) => (
            <ReminderRow key={r.id} reminder={r} onAck={ackReminder} onDelete={delReminder} />
          ))}
          {reminders.length === 0 && (
            <div
              data-testid="reminders-empty"
              style={{
                padding: "18px 0",
                color: "var(--fg-faint)",
                fontSize: "var(--t-sm)",
                borderBottom: "1px solid var(--border-soft)",
              }}
            >
              No reminders.
            </div>
          )}
        </section>

        <section>
          <header
            style={{
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 16,
              marginBottom: 12,
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: 18, flexWrap: "wrap" }}>
              <h2
                className="h-headline"
                style={{
                  margin: 0,
                  fontSize: "var(--t-2xl)",
                  color: "var(--fg)",
                  letterSpacing: "-0.01em",
                }}
              >
                Tasks
              </h2>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 10,
                  fontSize: "var(--t-sm)",
                  color: "var(--fg-mute)",
                }}
              >
                <span
                  className="num-gold tnum"
                  style={{ fontSize: "var(--t-xl)", lineHeight: 1 }}
                >
                  {leftCount}
                </span>
                <span>left</span>
                <span style={{ opacity: 0.4 }}>·</span>
                <span className="tnum">{plannedLabel}</span>
                <span>planned</span>
                <span style={{ opacity: 0.4 }}>·</span>
                <span className="tnum">{doneCount}</span>
                <span>done</span>
                <span style={{ opacity: 0.4 }}>·</span>
                <button
                  onClick={bonusTask}
                  data-api="POST /commands/generate-bonus-task"
                  data-testid="tasks-bonus"
                  style={{
                    border: 0,
                    background: "transparent",
                    color: "var(--fg-faint)",
                    cursor: "pointer",
                    fontSize: "var(--t-sm)",
                    textDecoration: "underline",
                    textDecorationStyle: "dotted",
                    padding: 0,
                  }}
                >
                  Bonus task
                </button>
              </div>
            </div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {doneCount > 0 && (
                <Button
                  size="xs"
                  tone="ghost"
                  onClick={() => setShowDone((s) => !s)}
                  data-testid="tasks-toggle-done"
                >
                  {showDone ? "Hide" : "Show"} {doneCount} done
                </Button>
              )}
              <Button
                size="xs"
                tone="ghost"
                icon="sparkle"
                onClick={gapFillers}
                data-api="POST /commands/propose-gap-fillers"
                data-testid="tasks-gap-fillers"
              >
                Gap fillers
              </Button>
              <Button
                size="xs"
                tone="ghost"
                icon="bolt"
                onClick={estimateAll}
                data-api="POST /commands/estimate-task-durations"
                data-testid="tasks-estimate-all"
              >
                Estimate all
              </Button>
              <Button
                size="xs"
                tone="ghost"
                icon="trash"
                onClick={deleteTasksForDate}
                data-api="POST /commands/delete-tasks-for-date"
                data-testid="tasks-clear-day"
              >
                Clear day
              </Button>
            </div>
          </header>

          <AddTaskLine onAdded={refetchAll} />

          {visibleTasks.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              onToggle={toggleTask}
              onSkip={skipTask}
              onReschedule={rescheduleTask}
              onDelete={deleteTask}
              onCantComplete={cantComplete}
              onSetTimeBlock={setTimeBlock}
              onSetProjectTag={setProjectTag}
              onEstimate={estimateOne}
              onPriorityFeedback={priorityFeedback}
            />
          ))}
          {visibleTasks.length === 0 && !tasksQ.loading && (
            <div
              data-testid="tasks-empty"
              style={{
                padding: 40,
                textAlign: "center",
                color: "var(--fg-faint)",
                fontSize: "var(--t-sm)",
              }}
            >
              All done for today.
            </div>
          )}

          <button
            onClick={undoDefer}
            data-api="POST /commands/undo-defer"
            data-testid="tasks-undo-defer"
            style={{
              marginTop: 14,
              border: 0,
              background: "transparent",
              color: "var(--fg-faint)",
              fontSize: 10,
              cursor: "pointer",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              fontWeight: 600,
              opacity: 0.5,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.5")}
          >
            Undo recent defer
          </button>
        </section>

        {paceBanner && (
          <Banner
            tone="pace"
            icon="bolt"
            title={paceBanner.title ?? "Pace notice"}
            body={paceBanner.body ?? ""}
            action={
              <Button size="sm" onClick={askChatAboutPace} data-testid="tasks-pace-chat">
                Reschedule
              </Button>
            }
          />
        )}
      </div>
    </>
  );
}
