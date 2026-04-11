/* ──────────────────────────────────────────────────────────
   NorthStar — Tasks page

   Phase 7: read-side consumes `view:tasks`. Toggle-task is wired
   to `command:toggle-task`. Snooze / skip / timer / heatmap /
   nudge-dismiss are local no-ops: the server has no matching
   commands yet (command:snooze-task, command:skip-task,
   command:start-task-timer, command:stop-task-timer,
   command:dismiss-nudge, command:respond-to-nudge) and the
   underlying state already lives server-side, so the worst case
   is that the button appears to do nothing until those commands
   land. Follow-up: add the six commands listed above to
   packages/server/src/routes/commands.ts.

   DailyTaskRecord (DB-shape with jsonb `payload`) is flattened to
   the core DailyTask shape before handing it to TaskCard / ProgressRow
   / AllTasksSection so those components keep their current contract.
   ────────────────────────────────────────────────────────── */

import { useEffect, useState, useCallback } from "react";
import {
  Flame,
  ChevronRight,
  RefreshCw,
  X,
  Palmtree,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { useT } from "../i18n";
import { generateDailyTasks } from "../services/ai";
// TODO(phase8): wire plan-job tracking via WS
const getActiveJobId = async (_type: string): Promise<string | null> => null;
import { shouldAutoReflect, triggerReflection, recordSignal } from "../services/memory";
import Heatmap from "../components/Heatmap";
import RecoveryModal from "../components/RecoveryModal";
import MilestoneCelebration from "../components/MilestoneCelebration";
import AgentProgress from "../components/AgentProgress";
import BigGoalProgress from "../components/BigGoalProgress";
import ReminderList from "../components/ReminderList";
import ProgressRow from "../components/ProgressRow";
import NudgesSection from "../components/NudgesSection";
import TaskCard from "../components/TaskCard";
import GoalTaskCard from "../components/GoalTaskCard";
import AllTasksSection from "../components/AllTasksSection";
import type {
  CalendarEvent,
  ContextualNudge,
  DailyLog,
  DailyTask,
  Goal,
  HeatmapEntry,
  Reminder,
} from "@northstar/core";
import { useQuery } from "../hooks/useQuery";
import { useCommand } from "../hooks/useCommand";
import "./TasksPage.css";

// MUST match packages/server/src/views/tasksView.ts
interface TasksVacationMode {
  active: boolean;
  startDate: string | null;
  endDate: string | null;
}
interface TasksDailyTaskRecord {
  id: string;
  date: string;
  goalId: string | null;
  planNodeId: string | null;
  title: string;
  completed: boolean;
  completedAt: string | null;
  orderIndex: number;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
interface TasksDailyLogRecord {
  id: string;
  date: string;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
interface TasksDailyLogHydrated extends TasksDailyLogRecord {
  tasks: TasksDailyTaskRecord[];
}
interface TasksBigGoalProgress {
  goalId: string;
  title: string;
  total: number;
  completed: number;
  percent: number;
}
interface NudgeRecord {
  id: string;
  kind: string;
  title: string;
  body: string;
  surfacedAt: string;
  dismissedAt: string | null;
  priority: number;
  context: string;
  actions: Array<{ label: string; feedbackValue: string; isPositive: boolean }>;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
interface TasksView {
  todayDate: string;
  todayLog: TasksDailyLogHydrated | null;
  dailyLogs: TasksDailyLogHydrated[];
  heatmapData: HeatmapEntry[];
  goals: Goal[];
  bigGoalProgress: TasksBigGoalProgress[];
  activeReminders: Reminder[];
  todayReminders: Reminder[];
  todayEvents: CalendarEvent[];
  recentNudges: NudgeRecord[];
  vacationMode: TasksVacationMode;
  totalIncompleteTasks: number;
}

/** Flatten DB-shape DailyTaskRecord → core DailyTask. */
function flattenTask(r: TasksDailyTaskRecord): DailyTask {
  const p = r.payload || {};
  return {
    id: r.id,
    title: r.title,
    description: (p.description as string) ?? "",
    durationMinutes: (p.durationMinutes as number) ?? 30,
    cognitiveWeight: p.cognitiveWeight as DailyTask["cognitiveWeight"],
    whyToday: (p.whyToday as string) ?? "",
    priority: ((p.priority as DailyTask["priority"]) ?? "should-do"),
    isMomentumTask: (p.isMomentumTask as boolean) ?? false,
    progressContribution: (p.progressContribution as string) ?? "",
    category: ((p.category as DailyTask["category"]) ?? "planning"),
    completed: r.completed,
    completedAt: r.completedAt ?? undefined,
    startedAt: p.startedAt as string | undefined,
    actualMinutes: p.actualMinutes as number | undefined,
    snoozedCount: p.snoozedCount as number | undefined,
    skipped: p.skipped as boolean | undefined,
  };
}

/** Build a core-shaped DailyLog out of a hydrated DB log for
 *  components (ProgressRow, RecoveryModal) that want the flat type. */
function hydrateLog(log: TasksDailyLogHydrated): DailyLog {
  const p = log.payload || {};
  return {
    id: log.id,
    userId: (p.userId as string) ?? "",
    date: log.date,
    tasks: log.tasks.map(flattenTask),
    heatmapEntry: (p.heatmapEntry as DailyLog["heatmapEntry"]) ?? {
      date: log.date,
      completionLevel: 0,
      currentStreak: 0,
      totalActiveDays: 0,
      longestStreak: 0,
    },
    notificationBriefing: (p.notificationBriefing as string) ?? "",
    milestoneCelebration: (p.milestoneCelebration as DailyLog["milestoneCelebration"]) ?? null,
    progress: (p.progress as DailyLog["progress"]) ?? {
      overallPercent: 0,
      milestonePercent: 0,
      currentMilestone: "",
      projectedCompletion: "",
      daysAheadOrBehind: 0,
    },
    yesterdayRecap: (p.yesterdayRecap as DailyLog["yesterdayRecap"]) ?? null,
    encouragement: (p.encouragement as string) ?? "",
    mood: p.mood as DailyLog["mood"],
    createdAt: log.createdAt,
  };
}

/** Map NudgeRecord → ContextualNudge for NudgesSection. */
function nudgeRecordToContextual(n: NudgeRecord): ContextualNudge {
  return {
    id: n.id,
    type: n.kind as ContextualNudge["type"],
    message: n.body,
    actions: n.actions,
    priority: n.priority,
    context: n.context,
    dismissed: n.dismissedAt !== null,
  };
}

function formatDate(): string {
  return new Date().toISOString().split("T")[0];
}

// Local no-ops that stand in for commands that don't exist yet on the
// server. Each one has a named follow-up in the page header comment.
const snoozeTask = (_taskId: string): void => {};
const skipTask = (_taskId: string): void => {};
const startTaskTimer = (_taskId: string): void => {};
const stopTaskTimer = (_taskId: string): void => {};
const setVacationMode = (
  _mode: { active: boolean; startDate: string; endDate: string } | null,
): void => {};
const dismissNudge = (_id: string): void => {};
const respondToNudge = (_id: string, _v: string, _pos: boolean): void => {};
const deviceIntegrations = {
  calendar: { enabled: false, selectedCalendars: [] as string[] },
  reminders: { enabled: false, selectedLists: [] as string[] },
};

export default function TasksPage() {
  const t = useT();
  const { data, loading, error, refetch } = useQuery<TasksView>("view:tasks");
  const { run } = useCommand();

  const [showRecovery, setShowRecovery] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);
  const [showAgentProgress, setShowAgentProgress] = useState(false);
  const [showVacationInput, setShowVacationInput] = useState(false);
  const [showAllTasks, setShowAllTasks] = useState(false);
  const [taskJobId, setTaskJobId] = useState<string | null>(null);
  const [vacStartDate, setVacStartDate] = useState("");
  const [vacEndDate, setVacEndDate] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // Derived view-data shortcuts.
  const goals: Goal[] = data?.goals ?? [];
  const todayLogRaw = data?.todayLog ?? null;
  const dailyLogsRaw = data?.dailyLogs ?? [];
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
  const nudges: ContextualNudge[] = (data?.recentNudges ?? []).map(nudgeRecordToContextual);

  // Hydrated copies for components expecting core types.
  const todayLog: DailyLog | null = todayLogRaw ? hydrateLog(todayLogRaw) : null;
  const allTasksByDate = dailyLogsRaw
    .filter((log) => log.tasks.length > 0)
    .map((log) => ({
      date: log.date,
      tasks: log.tasks.map(flattenTask),
    }));
  const totalIncompleteTasks = data?.totalIncompleteTasks ?? 0;

  const hasActivePlan = goals.length > 0;

  const loadTodayTasks = useCallback(async () => {
    if (goals.length === 0) return;
    setGenerating(true);
    setShowAgentProgress(true);
    setTaskJobId(null);
    setGenerateError(null);
    try {
      const today = formatDate();
      // Get any confirmed quick tasks that were added today
      const confirmedToday =
        todayLog?.tasks.filter(
          (task) => task.progressContribution === "Quick task added via chat",
        ) || [];
      setTimeout(async () => {
        const jid = await getActiveJobId("daily-tasks");
        if (jid) setTaskJobId(jid);
      }, 500);
      await generateDailyTasks(
        // Legacy AI service signature — no roadmap/breakdown in the view
        // contract anymore, so we pass goals via the tail args.
        null as unknown as never,
        dailyLogsRaw.map(hydrateLog),
        heatmapData,
        today,
        calendarEvents,
        deviceIntegrations,
        goals,
        confirmedToday,
        vacationMode && vacationMode.startDate && vacationMode.endDate
          ? {
              active: vacationMode.active,
              startDate: vacationMode.startDate,
              endDate: vacationMode.endDate,
            }
          : null,
        undefined,
      );
      // generateDailyTasks persists server-side via the AI handler; the
      // view refetch below picks up the newly-written daily log and
      // heatmap entry. Follow-up: add command:generate-daily-tasks so
      // this whole path runs through useCommand.
      recordSignal(
        "daily_tasks_generated",
        "tasks",
        `daily tasks for ${today}`,
      ).catch(() => {});
      refetch();
    } catch (err) {
      setGenerateError(
        err instanceof Error ? err.message : "Failed to generate tasks",
      );
    } finally {
      setGenerating(false);
      setShowAgentProgress(false);
      setTaskJobId(null);
    }
  }, [
    goals,
    calendarEvents,
    dailyLogsRaw,
    heatmapData,
    todayLog,
    vacationMode,
    refetch,
  ]);

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

  // ── Loading / error states ──
  if (loading && !data) {
    return (
      <div className="tasks-page">
        <div className="tasks-page-scroll">
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

  const completedCount = todayLog?.tasks.filter((t) => t.completed).length ?? 0;
  const totalCount = todayLog?.tasks.length ?? 0;
  const completionRate = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;
  const missedTasks = todayLog?.tasks.filter((t) => !t.completed) ?? [];

  // ── Today's tasks pulled from goal plans (the hierarchical case) ──
  const today = formatDate();
  const todayDayName = new Date().toLocaleDateString("en-US", { weekday: "long" });
  const todayDateLabel = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });

  const todayGoalTasks = goals.flatMap((g) => {
    const out: Array<DailyTask & { goalTitle: string; goalId: string; weekId?: string; dayId?: string }> = [];
    if (g.plan && Array.isArray(g.plan.years)) {
      for (const year of g.plan.years) {
        for (const month of year.months) {
          for (const week of month.weeks) {
            if (!week.locked) {
              for (const day of week.days) {
                const dayLabel = day.label.toLowerCase();
                if (
                  dayLabel === todayDayName.toLowerCase() ||
                  dayLabel.includes(todayDateLabel.toLowerCase()) ||
                  dayLabel.includes(today)
                ) {
                  for (const tk of day.tasks) {
                    out.push({
                      ...(tk as unknown as DailyTask),
                      goalTitle: g.title,
                      goalId: g.id,
                      weekId: week.id,
                      dayId: day.id,
                    });
                  }
                }
              }
            }
          }
        }
      }
    }
    return out;
  });
  const pendingGoalTasks = todayGoalTasks.filter((task) => !task.completed);

  const handleToggleTask = async (taskId: string) => {
    await run("command:toggle-task", { taskId });
    refetch();
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

        {generateError && (
          <div className="error-card animate-fade-in">
            <div className="error-card-content">
              <AlertTriangle size={16} />
              <p>{generateError}</p>
            </div>
            <div className="error-card-actions">
              {hasActivePlan && (
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    setGenerateError(null);
                    loadTodayTasks();
                  }}
                >
                  <RefreshCw size={13} />
                  Retry
                </button>
              )}
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setGenerateError(null)}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        <AgentProgress visible={showAgentProgress} jobId={taskJobId} />

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

        {/* ── Tasks Section ── */}
        <section className="tasks-section animate-slide-up">
          <div className="tasks-header">
            <h3>{t.dashboard.today}</h3>
            <div className="tasks-header-right">
              {todayLog && todayLog.tasks.length > 0 && (() => {
                const totalWeight = todayLog.tasks.reduce(
                  (sum, task) => sum + (task.cognitiveWeight || 3),
                  0,
                );
                const maxBudget = 12;
                return (
                  <span
                    className="tasks-weight-summary"
                    title={t.dashboard.cognitiveWeight}
                  >
                    🧠 {totalWeight}/{maxBudget} {t.dashboard.weightPts}
                  </span>
                );
              })()}
              {hasActivePlan && (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={loadTodayTasks}
                  disabled={generating}
                >
                  <RefreshCw size={14} />
                  {t.dashboard.generateDaily}
                </button>
              )}
            </div>
          </div>

          {/* Adaptive reasoning — explain WHY this many tasks */}
          {todayLog && (todayLog as unknown as { adaptiveReasoning?: string }).adaptiveReasoning && (
            <div className="adaptive-reasoning">
              <span className="adaptive-reasoning-label">🎯</span>
              <span className="adaptive-reasoning-text">
                {(todayLog as unknown as { adaptiveReasoning?: string }).adaptiveReasoning}
              </span>
            </div>
          )}

          {/* Today's AI-curated tasks (THE primary task list) */}
          {todayLog && (() => {
            const dailyTasks = todayLog.tasks.filter(
              (task) => task.priority === "must-do" || task.priority === "should-do",
            );
            const bonusTasks = todayLog.tasks.filter(
              (task) => task.priority === "bonus",
            );
            return (
              <>
                {dailyTasks.length > 0 && (
                  <div className="tasks-list">
                    {dailyTasks.map((task, i) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        isOneThing={
                          task.id ===
                          (todayLog as unknown as { one_thing?: string }).one_thing
                        }
                        onToggle={() => handleToggleTask(task.id)}
                        onSnooze={() => snoozeTask(task.id)}
                        onSkip={() => skipTask(task.id)}
                        onStartTimer={() => startTaskTimer(task.id)}
                        onStopTimer={() => stopTaskTimer(task.id)}
                        index={i}
                      />
                    ))}
                  </div>
                )}

                {bonusTasks.length > 0 && (
                  <>
                    <div className="bonus-tasks-divider">
                      <span>
                        ✨ {t.dashboard.bonusTasks || "Bonus — if you have extra energy"}
                      </span>
                    </div>
                    <div className="tasks-list tasks-list-bonus">
                      {bonusTasks.map((task, i) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          isOneThing={false}
                          onToggle={() => handleToggleTask(task.id)}
                          onSnooze={() => snoozeTask(task.id)}
                          onSkip={() => skipTask(task.id)}
                          onStartTimer={() => startTaskTimer(task.id)}
                          onStopTimer={() => stopTaskTimer(task.id)}
                          index={i}
                        />
                      ))}
                    </div>
                  </>
                )}

                {dailyTasks.length === 0 && bonusTasks.length === 0 && (
                  <div className="tasks-empty">
                    <p>{t.dashboard.noTasks}</p>
                  </div>
                )}
              </>
            );
          })()}

          {/* Goal plan tasks for today (only if not already covered by AI tasks) */}
          {pendingGoalTasks.length > 0 && !todayLog && (
            <div className="tasks-list">
              <div className="goal-tasks-divider">
                <span>{t.dashboard.goalTasks || "From your goal plans"}</span>
              </div>
              {pendingGoalTasks.map((task) => (
                <GoalTaskCard
                  key={task.id}
                  task={{
                    id: task.id,
                    title: task.title,
                    description: task.description ?? "",
                    durationMinutes: task.durationMinutes ?? 30,
                    completed: task.completed,
                    // GoalPlanTask has no dueDate field in core; default to today.
                    dueDate: today,
                  }}
                  goalTitle={task.goalTitle}
                  onToggle={async () => {
                    // Follow-up: add command:toggle-plan-task so this
                    // mutation doesn't have to resend the whole plan.
                    const goal = goals.find((g) => g.id === task.goalId);
                    if (!goal) return;
                    if (
                      goal.plan &&
                      Array.isArray(goal.plan.years) &&
                      task.weekId &&
                      task.dayId
                    ) {
                      const updatedPlan = {
                        ...goal.plan,
                        years: goal.plan.years.map((yr) => ({
                          ...yr,
                          months: yr.months.map((mo) => ({
                            ...mo,
                            weeks: mo.weeks.map((wk) => {
                              if (wk.id !== task.weekId) return wk;
                              return {
                                ...wk,
                                days: wk.days.map((dy) => {
                                  if (dy.id !== task.dayId) return dy;
                                  return {
                                    ...dy,
                                    tasks: dy.tasks.map((tk) =>
                                      tk.id === task.id
                                        ? {
                                            ...tk,
                                            completed: !tk.completed,
                                            completedAt: !tk.completed
                                              ? new Date().toISOString()
                                              : undefined,
                                          }
                                        : tk,
                                    ),
                                  };
                                }),
                              };
                            }),
                          })),
                        })),
                      };
                      await run("command:update-goal", {
                        goal: { ...goal, plan: updatedPlan },
                      });
                      refetch();
                    }
                  }}
                />
              ))}
            </div>
          )}

          {pendingGoalTasks.length === 0 && !todayLog && (
            <div className="tasks-empty">
              <p>{t.dashboard.noTasks}</p>
            </div>
          )}
        </section>

        {/* ── Reminders ── */}
        <ReminderList
          reminders={reminders}
          onAcknowledge={async (id) => {
            await run("command:acknowledge-reminder", { reminderId: id });
            refetch();
          }}
        />

        <AllTasksSection
          groups={allTasksByDate}
          totalIncomplete={totalIncompleteTasks}
          isExpanded={showAllTasks}
          onToggle={() => setShowAllTasks(!showAllTasks)}
        />

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
