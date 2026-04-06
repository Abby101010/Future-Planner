/* ──────────────────────────────────────────────────────────
   NorthStar — Tasks page
   All task displays, progress, heatmap, mood, nudges, recovery
   ────────────────────────────────────────────────────────── */

import { useEffect, useState, useCallback } from "react";
import {
  Check,
  Loader2,
  Flame,
  Target,
  Clock,
  ChevronRight,
  RefreshCw,
  Pause,
  Play,
  SkipForward,
  AlarmClock,
  MessageCircle,
  X,
  Globe,
  Palmtree,
  TrendingUp,
} from "lucide-react";
import useStore from "../store/useStore";
import { useT, getDateLocale } from "../i18n";
import { generateDailyTasks, fetchNewsBriefing } from "../services/ai";
import { shouldAutoReflect, triggerReflection, recordSignal } from "../services/memory";
import Heatmap from "../components/Heatmap";
import MoodLogger from "../components/MoodLogger";
import RecoveryModal from "../components/RecoveryModal";
import MilestoneCelebration from "../components/MilestoneCelebration";
import AgentProgress from "../components/AgentProgress";
import type { DailyTask, ContextualNudge } from "../types";
import type { NewsBriefing } from "../types/agents";
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
  } = useStore();

  const [showRecovery, setShowRecovery] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);
  const [showAgentProgress, setShowAgentProgress] = useState(false);
  const [newsBriefing, setNewsBriefing] = useState<NewsBriefing | null>(null);
  const [newsLoading, setNewsLoading] = useState(false);
  const [showVacationInput, setShowVacationInput] = useState(false);
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

  const hasActivePlan = !!(goalBreakdown || roadmap || goals.length > 0);

  const loadTodayTasks = useCallback(async () => {
    if (!goalBreakdown && !roadmap && goals.length === 0) return;
    setLoading(true);
    setShowAgentProgress(true);
    setError(null);
    try {
      const today = formatDate();
      const plan = goalBreakdown || roadmap;
      // Get any confirmed quick tasks that were added today
      const confirmedToday = todayLog?.tasks.filter((t) =>
        t.progressContribution === "Quick task added via chat"
      ) || [];
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

  // News briefing
  useEffect(() => {
    if (!user?.settings?.enableNewsFeed) return;
    if (goals.length === 0) return;
    let cancelled = false;
    (async () => {
      setNewsLoading(true);
      try {
        const goalTitles = goals.map(g => g.title);
        const result = await fetchNewsBriefing(goalTitles, []);
        if (!cancelled && result.ok && result.data) {
          setNewsBriefing(result.data);
        }
      } catch {
        // silent
      } finally {
        if (!cancelled) setNewsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.settings?.enableNewsFeed, goals.length]); // eslint-disable-line react-hooks/exhaustive-deps

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
          <div className="dashboard-error animate-fade-in">
            <p>{error}</p>
          </div>
        )}

        <AgentProgress visible={showAgentProgress} />

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
        {bigGoalProgress.length > 0 && (
          <section className="big-goal-progress-section animate-slide-up">
            {bigGoalProgress.map((g) => (
              <div key={g.title} className="big-goal-progress-row">
                <div className="big-goal-progress-label">
                  <TrendingUp size={14} />
                  <span>{g.title}</span>
                  <span className="big-goal-progress-pct">{g.percent}%</span>
                </div>
                <div className="progress-bar big-goal-bar">
                  <div
                    className={`progress-bar-fill ${g.percent >= 100 ? "complete" : g.percent >= 50 ? "green" : ""}`}
                    style={{ width: `${g.percent}%` }}
                  />
                </div>
              </div>
            ))}
          </section>
        )}

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
          {todayLog && (
            <div className="tasks-list">
              {todayLog.tasks.map((task, i) => (
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

        {/* Contextual nudges */}
        {nudges.filter((n) => !n.dismissed).length > 0 && (
          <section className="nudges-section animate-slide-up">
            {nudges
              .filter((n) => !n.dismissed)
              .slice(0, 3)
              .map((nudge) => (
                <NudgeCard
                  key={nudge.id}
                  nudge={nudge}
                  onDismiss={() => dismissNudge(nudge.id)}
                  onRespond={(feedbackValue, isPositive) =>
                    respondToNudge(nudge.id, feedbackValue, isPositive)
                  }
                />
              ))}
          </section>
        )}

        {/* Progress cards */}
        {todayLog && (
          <div className="progress-row animate-fade-in">
            <div className="progress-card">
              <div className="progress-card-label">
                <Target size={14} />
                {t.dashboard.overall}
              </div>
              <div className="progress-card-value">
                {todayLog.progress.overallPercent.toFixed(1)}%
              </div>
              <div className="progress-bar">
                <div
                  className="progress-bar-fill"
                  style={{ width: `${todayLog.progress.overallPercent}%` }}
                />
              </div>
            </div>

            <div className="progress-card">
              <div className="progress-card-label">
                <Flame size={14} />
                {t.dashboard.milestone}
              </div>
              <div className="progress-card-value">
                {todayLog.progress.milestonePercent.toFixed(1)}%
              </div>
              <div className="progress-bar">
                <div
                  className="progress-bar-fill green"
                  style={{ width: `${todayLog.progress.milestonePercent}%` }}
                />
              </div>
            </div>

            <div className="progress-card">
              <div className="progress-card-label">
                <Check size={14} />
                {t.dashboard.today}
              </div>
              <div className="progress-card-value">
                {completedCount}/{totalCount}
              </div>
              <div className="progress-bar">
                <div
                  className="progress-bar-fill"
                  style={{ width: `${completionRate}%` }}
                />
              </div>
            </div>
          </div>
        )}

        {/* News Briefing (opt-in) */}
        {user?.settings?.enableNewsFeed && (
          <section className="news-section animate-slide-up">
            <h3><Globe size={16} /> {t.agents.newsTitle}</h3>
            {newsLoading && (
              <div className="news-loading">
                <Loader2 size={14} className="spin" />
                <span>{t.agents.newsLoading}</span>
              </div>
            )}
            {!newsLoading && !newsBriefing && goals.length > 0 && (
              <p className="news-empty">{t.agents.newsEmpty}</p>
            )}
            {newsBriefing && newsBriefing.articles && newsBriefing.articles.length > 0 && (
              <div className="news-articles">
                {(newsBriefing.articles as Array<{title: string; source: string; url: string; summary: string; relevance: string}>).map((article, i) => (
                  <div key={i} className="news-article card">
                    <div className="news-article-header">
                      <span className="news-article-title">{article.title}</span>
                      <span className="news-article-source">{article.source}</span>
                    </div>
                    <p className="news-article-summary">{article.summary}</p>
                    <p className="news-article-relevance">{article.relevance}</p>
                  </div>
                ))}
                {newsBriefing.relevanceNote && (
                  <p className="news-relevance-note">{newsBriefing.relevanceNote}</p>
                )}
              </div>
            )}
          </section>
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

        {/* Mood logger (opt-in) */}
        {user?.settings.enableMoodLogging && (
          <section className="mood-section animate-slide-up">
            <MoodLogger />
          </section>
        )}

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

// ── Nudge card ──

function NudgeCard({
  nudge,
  onDismiss,
  onRespond,
}: {
  nudge: ContextualNudge;
  onDismiss: () => void;
  onRespond: (feedbackValue: string, isPositive: boolean) => void;
}) {
  const typeIcons: Record<string, string> = {
    early_finish: "🎯", snooze_probe: "😴", missed_deadline: "⏰",
    dead_zone: "🕳️", overwhelm: "😮‍💨", streak: "🔥", proactive: "💡",
  };
  const typeColors: Record<string, string> = {
    early_finish: "nudge-positive", streak: "nudge-positive",
    snooze_probe: "nudge-neutral", dead_zone: "nudge-neutral", proactive: "nudge-neutral",
    missed_deadline: "nudge-warning", overwhelm: "nudge-warning",
  };

  return (
    <div className={`nudge-card ${typeColors[nudge.type] ?? "nudge-neutral"}`}>
      <div className="nudge-header">
        <span className="nudge-icon">{typeIcons[nudge.type] ?? "💬"}</span>
        <p className="nudge-message">{nudge.message}</p>
        <button className="nudge-dismiss" onClick={onDismiss} title="Dismiss">
          <X size={14} />
        </button>
      </div>
      {(nudge.actions ?? []).length > 0 && (
        <div className="nudge-actions">
          {(nudge.actions ?? []).map((action, i) => (
            <button
              key={i}
              className={`btn btn-xs ${action.isPositive ? "btn-primary" : "btn-ghost"}`}
              onClick={() => onRespond(action.feedbackValue, action.isPositive)}
            >
              <MessageCircle size={10} /> {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
