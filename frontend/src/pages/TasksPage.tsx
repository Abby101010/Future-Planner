/* ──────────────────────────────────────────────────────────
   NorthStar — Tasks page
   All task displays, progress, heatmap, mood, nudges, recovery
   ────────────────────────────────────────────────────────── */

import { useEffect, useState, useCallback } from "react";
import {
  Check,
  Flame,
  Clock,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  Pause,
  Play,
  SkipForward,
  AlarmClock,
  X,
  Palmtree,
  AlertTriangle,
} from "lucide-react";
import useStore from "../store/useStore";
import { useT, getDateLocale } from "../i18n";
import { generateDailyTasks, getActiveJobId } from "../services/ai";
import { shouldAutoReflect, triggerReflection, recordSignal } from "../services/memory";
import Heatmap from "../components/Heatmap";
import RecoveryModal from "../components/RecoveryModal";
import MilestoneCelebration from "../components/MilestoneCelebration";
import AgentProgress from "../components/AgentProgress";
import BigGoalProgress from "../components/BigGoalProgress";
import ReminderList from "../components/ReminderList";
import ProgressRow from "../components/ProgressRow";
import NudgesSection from "../components/NudgesSection";
import type { DailyTask, Reminder } from "../types";
import "./TasksPage.css";

function formatDate(): string {
  return new Date().toISOString().split("T")[0];
}

export default function TasksPage() {
  const {
    user,
    roadmap,
    goalBreakdown,
    goals,
    calendarEvents,
    deviceIntegrations,
    todayLog,
    setTodayLog,
    addDailyLog,
    dailyLogs,
    toggleTask,
    snoozeTask,
    skipTask,
    startTaskTimer,
    stopTaskTimer,
    heatmapData,
    setHeatmapData,
    isLoading,
    setLoading,
    error,
    setError,
    nudges,
    refreshNudges,
    dismissNudge,
    respondToNudge,
    vacationMode,
    setVacationMode,
    reminders,
    acknowledgeReminder,
  } = useStore();

  const [showRecovery, setShowRecovery] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);
  const [showAgentProgress, setShowAgentProgress] = useState(false);
  const [showVacationInput, setShowVacationInput] = useState(false);
  const [showAllTasks, setShowAllTasks] = useState(false);
  const [taskJobId, setTaskJobId] = useState<string | null>(null);
  const [vacStartDate, setVacStartDate] = useState("");
  const [vacEndDate, setVacEndDate] = useState("");
  const t = useT();
  const lang = user?.settings?.language || "en";

  // Compute big goal progress for the summary bar
  const bigGoalProgress = goals
    .filter((g) => (g.goalType === "big" || (!g.goalType && g.scope === "big")) && g.status !== "archived")
    .map((g) => {
      let total = 0, completed = 0;
      if (g.plan && Array.isArray(g.plan.years)) {
        for (const yr of g.plan.years) {
          for (const mo of yr.months) {
            for (const wk of mo.weeks) {
              for (const dy of wk.days) {
                for (const tk of dy.tasks) {
                  total++;
                  if (tk.completed) completed++;
                }
              }
            }
          }
        }
      }
      return { title: g.title, total, completed, percent: total > 0 ? Math.round((completed / total) * 100) : 0 };
    });

  // Collect all tasks across all daily logs (for "All Tasks" dropdown)
  const allTasksByDate = dailyLogs
    .filter((log) => log.tasks.length > 0)
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((log) => ({
      date: log.date,
      tasks: log.tasks,
    }));

  // Today's active reminders
  const todayDate = formatDate();
  const todayReminders = reminders.filter(
    (r) => r.date === todayDate && !r.acknowledged
  ).sort((a, b) => a.reminderTime.localeCompare(b.reminderTime));

  // Count incomplete tasks across all logs
  const totalIncompleteTasks = dailyLogs.reduce(
    (sum, log) => sum + log.tasks.filter((t) => !t.completed && !t.skipped).length,
    0
  );

  const hasActivePlan = !!(goalBreakdown || roadmap || goals.length > 0);

  const loadTodayTasks = useCallback(async () => {
    if (!goalBreakdown && !roadmap && goals.length === 0) return;
    setLoading(true);
    setShowAgentProgress(true);
    setTaskJobId(null);
    setError(null);
    try {
      const today = formatDate();
      const plan = goalBreakdown || roadmap;
      // Get any confirmed quick tasks that were added today
      const confirmedToday = todayLog?.tasks.filter((t) =>
        t.progressContribution === "Quick task added via chat"
      ) || [];
      // Capture jobId for progress display after a short delay
      setTimeout(async () => {
        const jid = await getActiveJobId("daily-tasks");
        if (jid) setTaskJobId(jid);
      }, 500);
      const log = await generateDailyTasks(
        plan as any,
        dailyLogs,
        heatmapData,
        today,
        calendarEvents,
        deviceIntegrations,
        goals,
        confirmedToday,
        vacationMode,
        user?.weeklyAvailability
      );
      setTodayLog(log);
      addDailyLog(log);
      if (log.heatmapEntry) {
        setHeatmapData([...heatmapData, log.heatmapEntry]);
      }
      recordSignal("daily_tasks_generated", "tasks", `${log.tasks.length} tasks for ${today}`).catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate tasks");
    } finally {
      setLoading(false);
      setShowAgentProgress(false);
      setTaskJobId(null);
    }
  }, [goalBreakdown, roadmap, goals, calendarEvents, deviceIntegrations, dailyLogs, heatmapData, todayLog, setLoading, setError, setTodayLog, addDailyLog, setHeatmapData]);

  // Load today's tasks if we don't have them
  useEffect(() => {
    const today = formatDate();
    const existing = dailyLogs.find((l) => l.date === today);
    if (existing) {
      setTodayLog(existing);
    }
  }, [dailyLogs, setTodayLog]);

  // Refresh nudges when todayLog changes
  useEffect(() => {
    if (todayLog) {
      refreshNudges();
    }
  }, [todayLog, refreshNudges]);

  // Auto-reflection trigger
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
    return () => { cancelled = true; };
  }, []);

  const completedCount = todayLog?.tasks.filter((t) => t.completed).length ?? 0;
  const totalCount = todayLog?.tasks.length ?? 0;
  const completionRate = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;
  const missedTasks = todayLog?.tasks.filter((t) => !t.completed) ?? [];

  // Milestone celebration
  useEffect(() => {
    if (todayLog?.milestoneCelebration) {
      setShowCelebration(true);
    }
  }, [todayLog?.milestoneCelebration]);

  // Get TODAY's tasks from goal plans only (not all unlocked tasks!)
  // The AI daily task generator already selects from goal plans, so this section
  // only shows tasks explicitly scheduled for TODAY in the hierarchical plan.
  const today = formatDate();
  const todayDayName = new Date().toLocaleDateString("en-US", { weekday: "long" });
  const todayDateLabel = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });

  const todayGoalTasks = goals.flatMap((g) => {
    const tasks: Array<any> = [];
    if (g.plan && Array.isArray(g.plan.years)) {
      for (const year of g.plan.years) {
        for (const month of year.months) {
          for (const week of month.weeks) {
            if (!week.locked) {
              for (const day of week.days) {
                // Only include tasks from today's day (match by day name or date label)
                const dayLabel = day.label.toLowerCase();
                if (
                  dayLabel === todayDayName.toLowerCase() ||
                  dayLabel.includes(todayDateLabel.toLowerCase()) ||
                  dayLabel.includes(today)
                ) {
                  for (const t of day.tasks) {
                    tasks.push({ ...t, goalTitle: g.title, goalId: g.id, weekId: week.id, dayId: day.id });
                  }
                }
              }
            }
          }
        }
      }
    }
    // Flat plan tasks don't have day association — skip them from daily view
    // (they are managed from the Goal Plan page)
    return tasks;
  });
  const pendingGoalTasks = todayGoalTasks.filter((t) => !t.completed);

  // Count for header — total pending across all goals (for overview, not display)
  const totalPendingAcrossGoals = goals.reduce((count, g) => {
    if (g.plan && Array.isArray(g.plan.years)) {
      for (const year of g.plan.years) {
        for (const month of year.months) {
          for (const week of month.weeks) {
            if (!week.locked) {
              for (const day of week.days) {
                count += day.tasks.filter((t) => !t.completed).length;
              }
            }
          }
        }
      }
    }
    return count;
  }, 0);

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
              <button className="vacation-link" onClick={() => setShowVacationInput(true)}>
                <Palmtree size={13} />
              </button>
            )}
          </div>
          {todayLog?.notificationBriefing && (
            <p className="tasks-page-briefing">{todayLog.notificationBriefing}</p>
          )}
        </header>

        {error && (
          <div className="error-card animate-fade-in">
            <div className="error-card-content">
              <AlertTriangle size={16} />
              <p>{error}</p>
            </div>
            <div className="error-card-actions">
              {hasActivePlan && (
                <button className="btn btn-primary btn-sm" onClick={() => { setError(null); loadTodayTasks(); }}>
                  <RefreshCw size={13} />
                  Retry
                </button>
              )}
              <button className="btn btn-ghost btn-sm" onClick={() => setError(null)}>
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
            <span>{vacationMode.startDate} — {vacationMode.endDate}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setVacationMode(null)}>
              {t.goalTypes?.endVacation || "End"}
            </button>
          </div>
        ) : showVacationInput ? (
          <div className="vacation-input-row animate-fade-in">
            <input type="date" className="input input-sm" value={vacStartDate} onChange={(e) => setVacStartDate(e.target.value)} />
            <span className="vacation-sep">—</span>
            <input type="date" className="input input-sm" value={vacEndDate} onChange={(e) => setVacEndDate(e.target.value)} />
            <button className="btn btn-primary btn-sm" disabled={!vacStartDate || !vacEndDate} onClick={() => {
              setVacationMode({ active: true, startDate: vacStartDate, endDate: vacEndDate });
              setShowVacationInput(false);
            }}>
              {t.common.confirm}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowVacationInput(false)}>
              <X size={14} />
            </button>
          </div>
        ) : null}

        {/* ── Big Goal Progress Summary ── */}
        <BigGoalProgress rows={bigGoalProgress} />

        {/* ── Tasks Section ── */}
        <section className="tasks-section animate-slide-up">
          <div className="tasks-header">
            <h3>{t.dashboard.today}</h3>
            <div className="tasks-header-right">
              {todayLog && todayLog.tasks.length > 0 && (() => {
                const totalWeight = todayLog.tasks.reduce((sum, t) => sum + (t.cognitiveWeight || 3), 0);
                const maxBudget = 12; // visual reference
                return (
                  <span className="tasks-weight-summary" title={t.dashboard.cognitiveWeight}>
                    🧠 {totalWeight}/{maxBudget} {t.dashboard.weightPts}
                  </span>
                );
              })()}
              {hasActivePlan && (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={loadTodayTasks}
                  disabled={isLoading}
                >
                  <RefreshCw size={14} />
                  {t.dashboard.generateDaily}
                </button>
              )}
            </div>
          </div>

          {/* Adaptive reasoning — explain WHY this many tasks */}
          {todayLog && (todayLog as any).adaptiveReasoning && (
            <div className="adaptive-reasoning">
              <span className="adaptive-reasoning-label">🎯</span>
              <span className="adaptive-reasoning-text">{(todayLog as any).adaptiveReasoning}</span>
            </div>
          )}

          {/* Today's AI-curated tasks (THE primary task list) */}
          {todayLog && (() => {
            const dailyTasks = todayLog.tasks.filter((task) => task.priority === "must-do" || task.priority === "should-do");
            const bonusTasks = todayLog.tasks.filter((task) => task.priority === "bonus");
            return (
              <>
                {/* Daily Tasks */}
                {dailyTasks.length > 0 && (
                  <div className="tasks-list">
                    {dailyTasks.map((task, i) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        isOneThing={task.id === (todayLog as { one_thing?: string }).one_thing}
                        onToggle={() => toggleTask(task.id)}
                        onSnooze={() => snoozeTask(task.id)}
                        onSkip={() => skipTask(task.id)}
                        onStartTimer={() => startTaskTimer(task.id)}
                        onStopTimer={() => stopTaskTimer(task.id)}
                        index={i}
                      />
                    ))}
                  </div>
                )}

                {/* Bonus Tasks — extra tasks if energy allows */}
                {bonusTasks.length > 0 && (
                  <>
                    <div className="bonus-tasks-divider">
                      <span>✨ {t.dashboard.bonusTasks || "Bonus — if you have extra energy"}</span>
                    </div>
                    <div className="tasks-list tasks-list-bonus">
                      {bonusTasks.map((task, i) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          isOneThing={false}
                          onToggle={() => toggleTask(task.id)}
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
                  task={task}
                  goalTitle={task.goalTitle}
                  onToggle={() => {
                    const goal = goals.find((g) => g.id === task.goalId);
                    if (!goal) return;
                    if (goal.plan && Array.isArray(goal.plan.years) && task.weekId && task.dayId) {
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
                                    tasks: dy.tasks.map((t) =>
                                      t.id === task.id
                                        ? { ...t, completed: !t.completed, completedAt: !t.completed ? new Date().toISOString() : undefined }
                                        : t
                                    ),
                                  };
                                }),
                              };
                            }),
                          })),
                        })),
                      };
                      useStore.getState().updateGoal(task.goalId, { plan: updatedPlan });
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
          reminders={todayReminders}
          onAcknowledge={acknowledgeReminder}
        />

        {/* ── All Tasks (collapsible) ── */}
        {allTasksByDate.length > 0 && (
          <section className="all-tasks-section animate-slide-up">
            <button
              className="all-tasks-toggle"
              onClick={() => setShowAllTasks(!showAllTasks)}
            >
              {showAllTasks ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <span>All Tasks</span>
              {totalIncompleteTasks > 0 && (
                <span className="all-tasks-badge">{totalIncompleteTasks} incomplete</span>
              )}
            </button>
            {showAllTasks && (
              <div className="all-tasks-list">
                {allTasksByDate.map((group) => (
                  <div key={group.date} className="all-tasks-date-group">
                    <div className="all-tasks-date-label">
                      {new Date(group.date + "T00:00:00").toLocaleDateString(undefined, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })}
                    </div>
                    {group.tasks.map((task) => (
                      <div
                        key={task.id}
                        className={`all-tasks-item ${task.completed ? "all-tasks-item-done" : ""} ${task.skipped ? "all-tasks-item-skipped" : ""}`}
                      >
                        <span className={`all-tasks-check ${task.completed ? "checked" : ""}`}>
                          {task.completed ? <Check size={12} /> : null}
                        </span>
                        <span className="all-tasks-item-title">{task.title}</span>
                        <span className="all-tasks-item-meta">
                          {task.category} · {task.durationMinutes}m
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
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
                  todayLog.heatmapEntry.totalActiveDays
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

// ── Task card component ──

function TaskCard({
  task,
  isOneThing,
  onToggle,
  onSnooze,
  onSkip,
  onStartTimer,
  onStopTimer,
  index,
}: {
  task: DailyTask;
  isOneThing: boolean;
  onToggle: () => void;
  onSnooze: () => void;
  onSkip: () => void;
  onStartTimer: () => void;
  onStopTimer: () => void;
  index: number;
}) {
  const [elapsed, setElapsed] = useState(0);
  const isTimerRunning = !!task.startedAt;
  const t = useT();

  useEffect(() => {
    if (!task.startedAt) {
      setElapsed(0);
      return;
    }
    const start = new Date(task.startedAt).getTime();
    const tick = () => setElapsed(Math.round((Date.now() - start) / 1000));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [task.startedAt]);

  const formatElapsed = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const priorityColors: Record<string, string> = {
    "must-do": "badge-red",
    "should-do": "badge-yellow",
    bonus: "badge-blue",
  };

  const categoryColors: Record<string, string> = {
    learning: "badge-accent",
    building: "badge-green",
    networking: "badge-yellow",
    reflection: "badge-blue",
  };

  const isSkipped = !!task.skipped;

  return (
    <div
      className={`task-card ${task.completed ? "completed" : ""} ${isOneThing ? "one-thing" : ""} ${isSkipped ? "skipped" : ""} ${isTimerRunning ? "timer-active" : ""}`}
      style={{ animationDelay: `${index * 0.04}s` }}
    >
      <div
        className={`task-checkbox ${task.completed ? "checked" : ""}`}
        onClick={onToggle}
      >
        {task.completed && <Check size={14} />}
      </div>

      <div className="task-content">
        <div className="task-title-row">
          <span className="task-title">{task.title}</span>
          {isOneThing && <span className="badge badge-accent">{t.dashboard.priority}</span>}
          {isSkipped && <span className="badge badge-red">{t.dashboard.skipped}</span>}
        </div>
        <p className="task-description">{task.description}</p>
        <div className="task-meta">
          <span className="task-duration">
            <Clock size={11} />
            {task.actualMinutes
              ? `${task.actualMinutes}/${task.durationMinutes}m`
              : `${task.durationMinutes}m`}
          </span>
          <span className="task-meta-sep" />
          <span className="task-meta-label">{task.category}</span>
          {isTimerRunning && (
            <span className="task-timer-badge">
              <Play size={10} />
              {formatElapsed(elapsed)}
            </span>
          )}
        </div>

        {!task.completed && !isSkipped && (
          <div className="task-actions">
            {isTimerRunning ? (
              <button className="btn btn-ghost btn-xs task-action-btn" onClick={onStopTimer}>
                <Pause size={12} /> {t.dashboard.stop}
              </button>
            ) : (
              <button className="btn btn-ghost btn-xs task-action-btn" onClick={onStartTimer}>
                <Play size={12} /> {t.dashboard.timer}
              </button>
            )}
            <button className="btn btn-ghost btn-xs task-action-btn" onClick={onSnooze}>
              <AlarmClock size={12} /> {t.dashboard.snooze}
            </button>
            <button className="btn btn-ghost btn-xs task-action-btn task-action-skip" onClick={onSkip}>
              <SkipForward size={12} /> {t.dashboard.skip}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Goal Task card ──

function GoalTaskCard({
  task,
  goalTitle,
  onToggle,
}: {
  task: { id: string; title: string; description: string; durationMinutes: number; completed: boolean; dueDate: string };
  goalTitle: string;
  onToggle: () => void;
}) {
  const t = useT();
  const lang = useStore((s) => s.user?.settings?.language || "en");
  return (
    <div className={`task-card goal-task ${task.completed ? "completed" : ""}`}>
      <div className={`task-checkbox ${task.completed ? "checked" : ""}`} onClick={onToggle}>
        {task.completed && <Check size={14} />}
      </div>
      <div className="task-content">
        <div className="task-title-row">
          <span className="task-title">{task.title}</span>
        </div>
        {task.description && <p className="task-description">{task.description}</p>}
        <div className="task-meta">
          <span className="badge badge-accent">{goalTitle}</span>
          <span className="task-duration">
            <Clock size={12} /> {task.durationMinutes}m
          </span>
          {task.dueDate && (
            <span className="task-duration">
              {t.common.due} {new Date(task.dueDate).toLocaleDateString(getDateLocale(lang), { month: "short", day: "numeric" })}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

