/* ──────────────────────────────────────────────────────────
   NorthStar — Tasks page

   Phase 7: read-side consumes `view:tasks`. Toggle-task is wired
   to `command:toggle-task`. Skip wired to `command:skip-task`.
   Today's tasks are grouped by source: Goals, Calendar, Tasks.

   DailyTaskRecord (DB-shape with jsonb `payload`) is flattened to
   the core DailyTask shape before handing it to TaskCard / ProgressRow
   / AllTasksSection so those components keep their current contract.
   ────────────────────────────────────────────────────────── */

import { useEffect, useState, useRef } from "react";
import {
  Flame,
  ChevronRight,
  RefreshCw,
  X,
  Palmtree,
  AlertTriangle,
  Loader2,
  Trash2,
  CheckSquare,
  Undo2,
  Calendar,
  Clock,
  Check,
  Sparkles,
} from "lucide-react";
import { useT } from "../../i18n";
import { shouldAutoReflect, triggerReflection } from "../../services/memory";
import Heatmap from "./Heatmap";
import RecoveryModal from "./RecoveryModal";
import MilestoneCelebration from "./MilestoneCelebration";
import BigGoalProgress from "./BigGoalProgress";
import ReminderList from "./ReminderList";
import ProgressRow from "./ProgressRow";
import NudgesSection from "./NudgesSection";
import TaskCard from "./TaskCard";
import GoalTaskCard from "./GoalTaskCard";
import PaceBanner from "./PaceBanner";
import AgentProgress from "../goals/AgentProgress";
import "./PaceBanner.css";
import type {
  CalendarEvent,
  ContextualNudge,
  DailyLog,
  DailyTask,
  Goal,
  HeatmapEntry,
  PaceMismatch,
  Reminder,
} from "@northstar/core";
import { useQuery } from "../../hooks/useQuery";
import { useCommand } from "../../hooks/useCommand";
import "../../styles/tasks-shared.css";
import "./TasksPage.css";

// MUST match packages/server/src/views/tasksView.ts
interface TasksVacationMode {
  active: boolean;
  startDate: string | null;
  endDate: string | null;
}
interface TasksBigGoalProgress {
  goalId: string;
  title: string;
  total: number;
  completed: number;
  percent: number;
}
interface TodayProgressSummary {
  completed: number;
  total: number;
  ratePercent: number;
}
interface PendingGoalTask extends DailyTask {
  goalTitle: string;
  goalId: string;
  weekId?: string;
  dayId?: string;
}
interface TasksView {
  todayDate: string;
  todayLog: DailyLog | null;
  dailyLogs: DailyLog[];
  heatmapData: HeatmapEntry[];
  goals: Goal[];
  bigGoalProgress: TasksBigGoalProgress[];
  activeReminders: Reminder[];
  todayReminders: Reminder[];
  todayEvents: CalendarEvent[];
  recentNudges: ContextualNudge[];
  vacationMode: TasksVacationMode;
  totalIncompleteTasks: number;
  todayProgress: TodayProgressSummary;
  todayMissedTasks: DailyTask[];
  pendingGoalTasks: PendingGoalTask[];
  paceMismatches: PaceMismatch[];
}

const setVacationMode = (
  _mode: { active: boolean; startDate: string; endDate: string } | null,
): void => {};

export default function TasksPage() {
  const t = useT();
  const { data, loading, error, refetch } = useQuery<TasksView>("view:tasks");
  const { run } = useCommand();

  const dismissNudge = async (id: string) => {
    try {
      await run("command:dismiss-nudge", { nudgeId: id });
      refetch();
    } catch { /* best-effort */ }
  };
  const respondToNudge = async (id: string, feedbackValue: string, _isPositive: boolean) => {
    if (feedbackValue === "dismiss") {
      await dismissNudge(id);
    } else if (feedbackValue === "reschedule") {
      const nudge = (data?.recentNudges ?? []).find((n: ContextualNudge) => n.id === id);
      if (nudge?.context) {
        try {
          await run("command:adaptive-reschedule", { goalId: nudge.context });
          await dismissNudge(id);
          refetch();
        } catch { /* best-effort */ }
      }
    }
  };

  const [showRecovery, setShowRecovery] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showVacationInput, setShowVacationInput] = useState(false);
  const [vacStartDate, setVacStartDate] = useState("");
  const [vacEndDate, setVacEndDate] = useState("");
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deferMoves, setDeferMoves] = useState<
    Array<{ taskId: string; title: string; fromDate: string; toDate: string }>
  >([]);
  const [confirming, setConfirming] = useState(false);
  const deferCheckedRef = useRef<string | null>(null);

  // Derived view-data shortcuts.
  const goals: Goal[] = data?.goals ?? [];
  const heatmapData = data?.heatmapData ?? [];
  const calendarEvents = data?.todayEvents ?? [];
  const vacationMode = data?.vacationMode ?? null;
  const reminders = data?.todayReminders ?? [];
  const bigGoalProgressRows = (data?.bigGoalProgress ?? []).map((r) => ({
    title: r.title,
    total: r.total,
    completed: r.completed,
    percent: r.percent,
  }));
  const nudges: ContextualNudge[] = data?.recentNudges ?? [];

  const todayLog: DailyLog | null = data?.todayLog ?? null;

  // Auto-reflection trigger (fire-and-forget).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const should = await shouldAutoReflect();
        if (should && !cancelled) {
          await triggerReflection("auto");
        }
      } catch {
        // silent
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Milestone celebration
  useEffect(() => {
    if (todayLog?.milestoneCelebration) {
      setShowCelebration(true);
    }
  }, [todayLog?.milestoneCelebration]);

  // Cognitive overload: auto-defer once per today-date on load.
  useEffect(() => {
    const todayDate = data?.todayDate;
    if (!todayDate) return;
    if (deferCheckedRef.current === todayDate) return;
    deferCheckedRef.current = todayDate;
    (async () => {
      try {
        const res = await run<{
          moves: Array<{
            taskId: string;
            title: string;
            fromDate: string;
            toDate: string;
          }>;
        }>("command:defer-overflow", { date: todayDate });
        if (res?.moves && res.moves.length > 0) {
          setDeferMoves(res.moves);
          refetch();
        }
      } catch {
        // silent — overload defer is best-effort
      }
    })();
  }, [data?.todayDate, run, refetch]);

  // ── Loading / error states ──
  if (loading && !data) {
    return (
      <div className="tasks-page">
        <div className="tasks-page-scroll">
          <AgentProgress visible={true} title={t.agents?.title} />
          <div className="tasks-loading">
            <Loader2 size={18} className="spin" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="tasks-page">
        <div className="tasks-page-scroll">
          <div className="error-card">
            <div className="error-card-content">
              <AlertTriangle size={16} />
              <p>{error.message}</p>
            </div>
            <div className="error-card-actions">
              <button className="btn btn-ghost btn-sm" onClick={refetch}>
                <RefreshCw size={14} /> Retry
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const today = data.todayDate;
  const { completed: completedCount, total: totalCount, ratePercent: completionRate } =
    data.todayProgress;
  const missedTasks = data.todayMissedTasks;
  const pendingGoalTasks = data.pendingGoalTasks;

  const handleToggleTask = async (taskId: string) => {
    await run("command:toggle-task", { taskId });
    refetch();
  };

  const handleSkipTask = async (taskId: string) => {
    await run("command:skip-task", { taskId });
    refetch();
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!window.confirm("Delete this task?")) return;
    await run("command:delete-task", { taskId });
    refetch();
  };

  const toggleSelectTask = (taskId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`Delete ${selectedIds.size} selected task(s)?`)) return;
    for (const id of selectedIds) {
      await run("command:delete-task", { taskId: id });
    }
    setSelectedIds(new Set());
    setSelectMode(false);
    refetch();
  };

  const handleDeleteAllToday = async () => {
    if (!window.confirm("Delete ALL tasks for today?")) return;
    await run("command:delete-tasks-for-date", { date: data?.todayDate });
    setSelectedIds(new Set());
    setSelectMode(false);
    refetch();
  };

  const handleUndoDefer = async () => {
    if (!data?.todayDate || deferMoves.length === 0) return;
    await run("command:undo-defer", { fromDate: data.todayDate });
    setDeferMoves([]);
    refetch();
  };

  // ── Group today's tasks by source ──
  // Deduplicate by task ID — the server may return the same task
  // twice if auto-generation re-runs or the DB has duplicate rows.
  const rawTodayTasks = todayLog?.tasks ?? [];
  const seenIds = new Set<string>();
  const allTodayTasks: DailyTask[] = [];
  for (const t of rawTodayTasks) {
    if (!seenIds.has(t.id)) {
      seenIds.add(t.id);
      allTodayTasks.push(t);
    }
  }

  // Goal-sourced: has goalId or planNodeId
  const goalTasks = allTodayTasks.filter(
    (t) => t.goalId || t.planNodeId,
  );
  // Calendar-sourced: category hint or progressContribution mentions calendar
  const calendarTasks = allTodayTasks.filter(
    (t) =>
      !t.goalId &&
      !t.planNodeId &&
      (t.progressContribution?.toLowerCase().includes("calendar") ||
        t.whyToday?.toLowerCase().includes("calendar")),
  );
  // Everything else = general tasks
  const generalTasks = allTodayTasks.filter(
    (t) =>
      !goalTasks.includes(t) && !calendarTasks.includes(t),
  );

  // Find the goal title for a goalId
  const goalTitleFor = (goalId: string | null | undefined) => {
    if (!goalId) return undefined;
    const g = goals.find((g) => g.id === goalId);
    return g ? `🎯 ${g.title}` : "🎯 Goal";
  };

  return (
    <div className="tasks-page">
      {/* Celebration overlay */}
      {showCelebration && todayLog?.milestoneCelebration && (
        <MilestoneCelebration
          celebration={todayLog.milestoneCelebration}
          onClose={() => setShowCelebration(false)}
        />
      )}

      {/* Recovery modal */}
      {showRecovery && todayLog && (
        <RecoveryModal
          todayLog={todayLog}
          onClose={() => setShowRecovery(false)}
        />
      )}

      <div className="tasks-page-scroll">
        {/* Header */}
        <header className="tasks-page-header animate-fade-in">
          <div className="tasks-page-header-top">
            <h2>{t.common.tasks}</h2>
            {!vacationMode?.active && !showVacationInput && (
              <button
                className="vacation-link"
                onClick={() => setShowVacationInput(true)}
              >
                <Palmtree size={13} />
              </button>
            )}
          </div>
          {todayLog?.notificationBriefing && (
            <p className="tasks-page-briefing">{todayLog.notificationBriefing}</p>
          )}
        </header>

        {/* ── Vacation Mode ── */}
        {vacationMode?.active ? (
          <div className="vacation-banner animate-fade-in">
            <Palmtree size={16} />
            <span>
              {vacationMode.startDate} — {vacationMode.endDate}
            </span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setVacationMode(null)}
            >
              {t.goalTypes?.endVacation || "End"}
            </button>
          </div>
        ) : showVacationInput ? (
          <div className="vacation-input-row animate-fade-in">
            <input
              type="date"
              className="input input-sm"
              value={vacStartDate}
              onChange={(e) => setVacStartDate(e.target.value)}
            />
            <span className="vacation-sep">—</span>
            <input
              type="date"
              className="input input-sm"
              value={vacEndDate}
              onChange={(e) => setVacEndDate(e.target.value)}
            />
            <button
              className="btn btn-primary btn-sm"
              disabled={!vacStartDate || !vacEndDate}
              onClick={() => {
                setVacationMode({
                  active: true,
                  startDate: vacStartDate,
                  endDate: vacEndDate,
                });
                setShowVacationInput(false);
              }}
            >
              {t.common.confirm}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setShowVacationInput(false)}
            >
              <X size={14} />
            </button>
          </div>
        ) : null}

        {/* ── Big Goal Progress Summary ── */}
        <BigGoalProgress rows={bigGoalProgressRows} />

        {/* ── Reminders (always visible, above tasks) ── */}
        <ReminderList
          reminders={reminders}
          onAcknowledge={async (id) => {
            await run("command:acknowledge-reminder", { reminderId: id });
            refetch();
          }}
          onDelete={async (id) => {
            await run("command:delete-reminder", { reminderId: id });
            refetch();
          }}
          onEdit={async (r) => {
            await run("command:upsert-reminder", { reminder: r });
            refetch();
          }}
          onBulkDelete={async (ids) => {
            await run("command:delete-reminders-batch", { reminderIds: ids });
            refetch();
          }}
        />

        {/* ── Cognitive overload banner ── */}
        {deferMoves.length > 0 && (
          <div className="overload-banner animate-fade-in">
            <div className="overload-banner-head">
              <AlertTriangle size={16} />
              <strong>
                Today was overloaded — I moved {deferMoves.length} task
                {deferMoves.length === 1 ? "" : "s"} to make room.
              </strong>
              <button
                className="btn btn-ghost btn-xs"
                onClick={handleUndoDefer}
                title="Restore moved tasks"
              >
                <Undo2 size={12} /> Undo all
              </button>
            </div>
            <ul className="overload-banner-list">
              {deferMoves.map((m) => (
                <li key={m.taskId}>
                  • {m.title} → {m.toDate}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── Pace mismatch banner ── */}
        {(data?.paceMismatches ?? []).length > 0 && (
          <PaceBanner
            mismatches={data!.paceMismatches}
            onReschedule={refetch}
          />
        )}

        {/* ── Daily Tasks Proposal Card ── */}
        {todayLog?.tasksConfirmed === false && allTodayTasks.length > 0 ? (
          <section className="tasks-proposal-card animate-slide-up">
            <div className="proposal-header">
              <Sparkles size={18} />
              <h3>Today's Proposed Plan</h3>
            </div>

            {todayLog?.adaptiveReasoning && (
              <p className="proposal-reasoning">{todayLog.adaptiveReasoning}</p>
            )}

            <div className="proposal-task-list">
              {allTodayTasks.map((task) => {
                const badge = goalTitleFor(task.goalId);
                return (
                  <div key={task.id} className="proposal-task-item">
                    <div className="proposal-task-info">
                      <span className="proposal-task-title">{task.title}</span>
                      {badge && (
                        <span className="badge badge-source">{badge}</span>
                      )}
                    </div>
                    <div className="proposal-task-meta">
                      {task.durationMinutes && (
                        <span className="proposal-task-duration">
                          <Clock size={11} />
                          {task.durationMinutes}m
                        </span>
                      )}
                      {task.cognitiveWeight && (
                        <span className="proposal-task-weight">
                          ⚡ {task.cognitiveWeight}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="proposal-summary">
              <span>
                {allTodayTasks.length} task{allTodayTasks.length === 1 ? "" : "s"}
                {" · "}
                {allTodayTasks.reduce((s, t) => s + (t.durationMinutes ?? 0), 0)}m
                {" · "}
                ⚡ {allTodayTasks.reduce((s, t) => s + (t.cognitiveWeight ?? 0), 0)} pts
              </span>
            </div>

            <div className="proposal-actions">
              <button
                className="btn btn-primary btn-sm"
                disabled={confirming}
                onClick={async () => {
                  setConfirming(true);
                  try {
                    await run("command:confirm-daily-tasks", {
                      date: data?.todayDate,
                    });
                    refetch();
                  } finally {
                    setConfirming(false);
                  }
                }}
              >
                {confirming ? (
                  <Loader2 size={14} className="spin" />
                ) : (
                  <Check size={14} />
                )}
                Approve Plan
              </button>
              <button
                className="btn btn-ghost btn-sm"
                disabled={refreshing}
                onClick={async () => {
                  setRefreshing(true);
                  try {
                    await run("command:regenerate-daily-tasks", {
                      date: data?.todayDate,
                    });
                    refetch();
                  } catch {
                    refetch();
                  } finally {
                    setRefreshing(false);
                  }
                }}
              >
                {refreshing ? (
                  <Loader2 size={14} className="spin" />
                ) : (
                  <RefreshCw size={14} />
                )}
                Regenerate
              </button>
            </div>
          </section>
        ) : (
        /* ── Today's Tasks — grouped by source ── */
        <section className="tasks-section animate-slide-up">
          <div className="tasks-header">
            <h3>{t.dashboard.today}</h3>
            <div className="tasks-header-right">
              {selectMode ? (
                <>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={handleDeleteSelected}
                    disabled={selectedIds.size === 0}
                  >
                    <Trash2 size={14} /> Delete ({selectedIds.size})
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setSelectMode(false);
                      setSelectedIds(new Set());
                    }}
                  >
                    <X size={14} /> Cancel
                  </button>
                </>
              ) : (
                <>
                  {allTodayTasks.length > 0 && (
                    <>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => setSelectMode(true)}
                        title="Select multiple tasks"
                      >
                        <CheckSquare size={14} /> Select
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={handleDeleteAllToday}
                        title="Delete every task for today"
                      >
                        <Trash2 size={14} /> Delete all
                      </button>
                    </>
                  )}
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={async () => {
                      setRefreshing(true);
                      try {
                        await run("command:regenerate-daily-tasks", {
                          date: data?.todayDate,
                        });
                        refetch();
                      } catch {
                        // fallback to simple refetch
                        refetch();
                      } finally {
                        setRefreshing(false);
                      }
                    }}
                    disabled={refreshing}
                    title="Regenerate tasks"
                  >
                    {refreshing ? (
                      <Loader2 size={14} className="spin" />
                    ) : (
                      <RefreshCw size={14} />
                    )}
                  </button>
                </>
              )}
            </div>
          </div>

          {/* From Goals */}
          {goalTasks.length > 0 && (
            <>
              <div className="tasks-source-divider">
                <span>🎯 From Goals</span>
              </div>
              <div className="tasks-list">
                {goalTasks.map((task, i) => (
                  <TaskCard
                    key={`goal-${task.id}-${i}`}
                    task={task}
                    isOneThing={
                      task.id ===
                      (todayLog as unknown as { one_thing?: string })?.one_thing
                    }
                    onToggle={() => handleToggleTask(task.id)}
                    onSkip={() => handleSkipTask(task.id)}
                    onDelete={() => handleDeleteTask(task.id)}
                    selected={selectedIds.has(task.id)}
                    onToggleSelect={() => toggleSelectTask(task.id)}
                    selectMode={selectMode}
                    index={i}
                    sourceBadge={goalTitleFor(task.goalId)}
                  />
                ))}
              </div>
            </>
          )}

          {/* Pending goal-plan tasks not yet in daily tasks */}
          {pendingGoalTasks.length > 0 && (
            <>
              {goalTasks.length === 0 && (
                <div className="tasks-source-divider">
                  <span>🎯 From Goals</span>
                </div>
              )}
              <div className="tasks-list">
                {pendingGoalTasks.map((task, i) => (
                  <GoalTaskCard
                    key={`pending-${task.goalId}-${task.id}-${i}`}
                    task={{
                      id: task.id,
                      title: task.title,
                      description: task.description ?? "",
                      durationMinutes: task.durationMinutes ?? 30,
                      completed: task.completed,
                      dueDate: today,
                    }}
                    goalTitle={task.goalTitle}
                    onToggle={async () => {
                      await run("command:toggle-task", { taskId: task.id });
                      refetch();
                    }}
                  />
                ))}
              </div>
            </>
          )}

          {/* From Calendar — AI-generated task cards */}
          {calendarTasks.length > 0 && (
            <>
              <div className="tasks-source-divider">
                <span>📅 From Calendar</span>
              </div>
              <div className="tasks-list">
                {calendarTasks.map((task, i) => (
                  <TaskCard
                    key={`cal-${task.id}-${i}`}
                    task={task}
                    isOneThing={false}
                    onToggle={() => handleToggleTask(task.id)}
                    onSkip={() => handleSkipTask(task.id)}
                    onDelete={() => handleDeleteTask(task.id)}
                    selected={selectedIds.has(task.id)}
                    onToggleSelect={() => toggleSelectTask(task.id)}
                    selectMode={selectMode}
                    index={i}
                  />
                ))}
              </div>
            </>
          )}

          {/* Raw calendar events — shown when no AI-generated calendar tasks exist yet */}
          {calendarTasks.length === 0 && calendarEvents.length > 0 && (
            <>
              <div className="tasks-source-divider">
                <span>📅 From Calendar</span>
              </div>
              <div className="tasks-list">
                {calendarEvents.map((evt) => {
                  const startTime = new Date(evt.startDate).toLocaleTimeString(
                    undefined,
                    { hour: "numeric", minute: "2-digit" },
                  );
                  const endTime = new Date(evt.endDate).toLocaleTimeString(
                    undefined,
                    { hour: "numeric", minute: "2-digit" },
                  );
                  return (
                    <div key={evt.id} className="task-card calendar-event-card">
                      <div className="task-content">
                        <div className="task-title-row">
                          <Calendar size={13} />
                          <span className="task-title">{evt.title}</span>
                          {evt.category && (
                            <span className="badge badge-source">{evt.category}</span>
                          )}
                        </div>
                        <div className="task-meta">
                          <span className="task-duration">
                            <Clock size={11} />
                            {evt.isAllDay ? "All day" : `${startTime} – ${endTime}`}
                          </span>
                          {evt.durationMinutes && !evt.isAllDay && (
                            <>
                              <span className="task-meta-sep" />
                              <span className="task-meta-label">{evt.durationMinutes}m</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* General Tasks */}
          {generalTasks.length > 0 && (
            <>
              <div className="tasks-source-divider">
                <span>📋 Tasks</span>
              </div>
              <div className="tasks-list">
                {generalTasks.map((task, i) => (
                  <TaskCard
                    key={`gen-${task.id}-${i}`}
                    task={task}
                    isOneThing={
                      task.id ===
                      (todayLog as unknown as { one_thing?: string })?.one_thing
                    }
                    onToggle={() => handleToggleTask(task.id)}
                    onSkip={() => handleSkipTask(task.id)}
                    onDelete={() => handleDeleteTask(task.id)}
                    selected={selectedIds.has(task.id)}
                    onToggleSelect={() => toggleSelectTask(task.id)}
                    selectMode={selectMode}
                    index={i}
                  />
                ))}
              </div>
            </>
          )}

          {allTodayTasks.length === 0 && pendingGoalTasks.length === 0 && (
            <div className="tasks-empty">
              <p>{t.dashboard.noTasks}</p>
            </div>
          )}
        </section>
        )}

        {/* Contextual nudges */}
        <NudgesSection
          nudges={nudges}
          onDismiss={dismissNudge}
          onRespond={respondToNudge}
        />

        {/* Progress cards */}
        {todayLog && (
          <ProgressRow
            todayLog={todayLog}
            completedCount={completedCount}
            totalCount={totalCount}
            completionRate={completionRate}
          />
        )}

        {/* Heatmap */}
        <section className="heatmap-section animate-slide-up">
          <h3>{t.dashboard.activity}</h3>
          <Heatmap data={heatmapData} />
          {todayLog?.heatmapEntry && (
            <div className="streak-info">
              <Flame size={14} />
              <span>
                {t.dashboard.dayStreak(
                  todayLog.heatmapEntry.currentStreak,
                  todayLog.heatmapEntry.totalActiveDays,
                )}
              </span>
            </div>
          )}
        </section>

        {/* Recovery prompt */}
        {missedTasks.length > 0 && completedCount > 0 && (
          <div className="recovery-prompt animate-slide-up">
            <p>{t.dashboard.recoveryPrompt}</p>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setShowRecovery(true)}
            >
              {t.dashboard.adjustPlan}
              <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
