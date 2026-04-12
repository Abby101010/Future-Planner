/* ──────────────────────────────────────────────────────────
   NorthStar — Tasks page

   Phase 7: read-side consumes `view:tasks`. Toggle-task is wired
   to `command:toggle-task`. Skip wired to `command:skip-task`.
   Today's tasks are grouped by source: Goals, Calendar, Tasks.

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
}

function formatDate(): string {
  return new Date().toISOString().split("T")[0];
}

// Local no-ops that stand in for commands that don't exist yet on the
// server.
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
  const [taskJobId, setTaskJobId] = useState<string | null>(null);
  const [vacStartDate, setVacStartDate] = useState("");
  const [vacEndDate, setVacEndDate] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // Derived view-data shortcuts.
  const goals: Goal[] = data?.goals ?? [];
  const dailyLogs: DailyLog[] = data?.dailyLogs ?? [];
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
      await generateDailyTasks(
        // Legacy AI service signature — no roadmap/breakdown in the view
        // contract anymore, so we pass goals via the tail args.
        null as unknown as never,
        dailyLogs,
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
    dailyLogs,
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

  // ── Group today's tasks by source ──
  const allTodayTasks = todayLog?.tasks ?? [];

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

        {/* ── Reminders (always visible, above tasks) ── */}
        <ReminderList
          reminders={reminders}
          onAcknowledge={async (id) => {
            await run("command:acknowledge-reminder", { reminderId: id });
            refetch();
          }}
        />

        {/* ── Today's Tasks — grouped by source ── */}
        <section className="tasks-section animate-slide-up">
          <div className="tasks-header">
            <h3>{t.dashboard.today}</h3>
            <div className="tasks-header-right">
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

          {/* From Goals */}
          {goalTasks.length > 0 && (
            <>
              <div className="tasks-source-divider">
                <span>🎯 From Goals</span>
              </div>
              <div className="tasks-list">
                {goalTasks.map((task, i) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    isOneThing={
                      task.id ===
                      (todayLog as unknown as { one_thing?: string })?.one_thing
                    }
                    onToggle={() => handleToggleTask(task.id)}
                    onSkip={() => handleSkipTask(task.id)}
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
                    key={task.id}
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

          {/* From Calendar */}
          {calendarTasks.length > 0 && (
            <>
              <div className="tasks-source-divider">
                <span>📅 From Calendar</span>
              </div>
              <div className="tasks-list">
                {calendarTasks.map((task, i) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    isOneThing={false}
                    onToggle={() => handleToggleTask(task.id)}
                    onSkip={() => handleSkipTask(task.id)}
                    index={i}
                  />
                ))}
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
                    key={task.id}
                    task={task}
                    isOneThing={
                      task.id ===
                      (todayLog as unknown as { one_thing?: string })?.one_thing
                    }
                    onToggle={() => handleToggleTask(task.id)}
                    onSkip={() => handleSkipTask(task.id)}
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
