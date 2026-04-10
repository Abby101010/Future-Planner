/* ──────────────────────────────────────────────────────────
   NorthStar — Goal Plan Page (Hierarchical Timeline)
   A dedicated page for each "big" goal showing milestones,
   years → months → weeks → days hierarchy, with locked
   future sections, planning chat, and task progress.
   ────────────────────────────────────────────────────────── */

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Send,
  Loader2,
  Target,
  CheckCircle2,
  Circle,
  ChevronDown,
  ChevronRight,
  Clock,
  Sparkles,
  Edit3,
  MessageSquare,
  ArrowLeft,
  Lock,
  Flag,
  Calendar,
  Unlock,
  AlertTriangle,
  FileText,
  RefreshCw,
} from "lucide-react";
import useStore from "../store/useStore";
import { useT, getDateLocale } from "../i18n";
import { sendGoalPlanMessage, generateGoalPlan, submitGoalPlanJob, pollJobUntilDone, reallocateGoalPlan } from "../services/ai";
import {
  getPlanJobId as readStoredJobId,
  setPlanJobId as storeJobId,
  clearPlanJobId as clearStoredJobId,
  hasPlanJobId,
} from "../services/jobPersistence";
import AgentProgress from "../components/AgentProgress";
import RichTextToolbar, { IconPicker } from "../components/RichTextToolbar";
import type {
  GoalPlanMessage,
  GoalPlan,
  GoalPlanWeek,
  GoalPlanTask,
  GoalPlanMilestone,
} from "../types";
import "./GoalPlanPage.css";

interface GoalPlanPageProps {
  goalId: string;
}

// ── Helper: flatten all tasks from the plan in order ──
function flattenPlanTasks(plan: GoalPlan): GoalPlanTask[] {
  const tasks: GoalPlanTask[] = [];
  for (const yr of plan.years) {
    for (const mo of yr.months) {
      for (const wk of mo.weeks) {
        for (const dy of wk.days) {
          tasks.push(...dy.tasks);
        }
      }
    }
  }
  return tasks;
}

// ── Helper: count all tasks in the plan ──
function countPlanTasks(plan: GoalPlan): { total: number; completed: number } {
  const tasks = flattenPlanTasks(plan);
  return {
    total: tasks.length,
    completed: tasks.filter((t) => t.completed).length,
  };
}

// ── Helper: compute milestone progress from task completion ──
// Distributes tasks evenly across milestones (milestone i owns tasks from
// segment i of the total). Each milestone gets a progressPercent [0-100].
function computeMilestoneProgress(
  plan: GoalPlan
): Array<GoalPlanMilestone & { progressPercent: number; segmentCompleted: number; segmentTotal: number }> {
  const allTasks = flattenPlanTasks(plan);
  const milestones = plan.milestones;
  if (milestones.length === 0) return [];

  const totalTasks = allTasks.length;
  const perMilestone = totalTasks > 0 ? Math.ceil(totalTasks / milestones.length) : 0;

  return milestones.map((ms, i) => {
    const start = i * perMilestone;
    const end = Math.min(start + perMilestone, totalTasks);
    const segment = allTasks.slice(start, end);
    const segmentTotal = segment.length;
    const segmentCompleted = segment.filter((t) => t.completed).length;
    const progressPercent = segmentTotal > 0 ? Math.round((segmentCompleted / segmentTotal) * 100) : 0;
    const isFullyDone = segmentTotal > 0 && segmentCompleted === segmentTotal;

    return {
      ...ms,
      completed: ms.completed || isFullyDone,
      progressPercent,
      segmentCompleted,
      segmentTotal,
    };
  });
}

// ── Helper: auto-mark milestones as completed in the plan when their tasks are all done ──
function syncMilestoneCompletion(plan: GoalPlan): GoalPlan {
  const progress = computeMilestoneProgress(plan);
  const updatedMilestones = plan.milestones.map((ms, i) => ({
    ...ms,
    completed: progress[i]?.completed ?? ms.completed,
    totalTasks: progress[i]?.segmentTotal ?? 0,
    completedTasks: progress[i]?.segmentCompleted ?? 0,
  }));
  return { ...plan, milestones: updatedMilestones };
}

// ── Helper: toggle a task deep in the plan tree ──
function toggleTaskInPlan(plan: GoalPlan, weekId: string, dayId: string, taskId: string): GoalPlan {
  return {
    ...plan,
    years: plan.years.map((yr) => ({
      ...yr,
      months: yr.months.map((mo) => ({
        ...mo,
        weeks: mo.weeks.map((wk) => {
          if (wk.id !== weekId) return wk;
          return {
            ...wk,
            days: wk.days.map((dy) => {
              if (dy.id !== dayId) return dy;
              return {
                ...dy,
                tasks: dy.tasks.map((t) =>
                  t.id === taskId
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
}

// ── Helper: unlock the next locked week ──
function unlockNextWeek(plan: GoalPlan): GoalPlan {
  let unlocked = false;
  return {
    ...plan,
    years: plan.years.map((yr) => ({
      ...yr,
      months: yr.months.map((mo) => ({
        ...mo,
        weeks: mo.weeks.map((wk) => {
          if (!unlocked && wk.locked) {
            unlocked = true;
            return { ...wk, locked: false };
          }
          return wk;
        }),
      })),
    })),
  };
}

// ── Helper: apply a plan patch (merge partial updates from AI chat) ──
function applyPlanPatch(
  plan: GoalPlan,
  patch: Record<string, unknown>
): GoalPlan {
  const patchYears = patch.years as Array<Record<string, unknown>> | null;
  const patchMilestones = patch.milestones as Array<Record<string, unknown>> | null;

  let updated = { ...plan };

  // Patch milestones if provided
  if (patchMilestones) {
    updated = {
      ...updated,
      milestones: updated.milestones.map((ms) => {
        const p = patchMilestones.find((pm) => pm.id === ms.id);
        return p ? { ...ms, ...p } as typeof ms : ms;
      }),
    };
  }

  // Patch years → months → weeks deep merge
  if (patchYears) {
    updated = {
      ...updated,
      years: updated.years.map((yr) => {
        const pYr = patchYears.find((py) => py.id === yr.id) as Record<string, unknown> | undefined;
        if (!pYr) return yr;

        const patchMonths = (pYr.months || []) as Array<Record<string, unknown>>;
        return {
          ...yr,
          ...(pYr.objective ? { objective: pYr.objective as string } : {}),
          ...(pYr.label ? { label: pYr.label as string } : {}),
          months: yr.months.map((mo) => {
            const pMo = patchMonths.find((pm) => pm.id === mo.id) as Record<string, unknown> | undefined;
            if (!pMo) return mo;

            const patchWeeks = (pMo.weeks || []) as Array<Record<string, unknown>>;
            return {
              ...mo,
              ...(pMo.objective ? { objective: pMo.objective as string } : {}),
              ...(pMo.label ? { label: pMo.label as string } : {}),
              weeks: mo.weeks.map((wk) => {
                const pWk = patchWeeks.find((pw) => pw.id === wk.id) as Record<string, unknown> | undefined;
                if (!pWk) return wk;
                // Merge week-level fields; if days are provided, replace them
                const merged = { ...wk, ...pWk } as typeof wk;
                return merged;
              }),
            };
          }),
        };
      }),
    };
  }

  return updated;
}

export default function GoalPlanPage({ goalId }: GoalPlanPageProps) {
  const {
    goals,
    updateGoal,
    addGoalPlanMessage,
    setGoalPlan,
    confirmGoalPlan,
    setView,
    isLoading,
    setLoading,
    setError,
  } = useStore();

  const goal = goals.find((g) => g.id === goalId);
  const [chatInput, setChatInput] = useState("");
  // Initialize from persisted job-id so an in-flight job's progress reattaches on re-entry
  const [planJobId, setPlanJobId] = useState<string | null>(
    () => readStoredJobId(goalId)
  );
  const [showAgentProgress, setShowAgentProgress] = useState<boolean>(
    () => hasPlanJobId(goalId)
  );
  const [isRescheduling, setIsRescheduling] = useState(false);
  const [rescheduleDismissed, setRescheduleDismissed] = useState(false);
  const [expandedYears, setExpandedYears] = useState<Set<string>>(new Set());
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());
  const [expandedWeeks, setExpandedWeeks] = useState<Set<string>>(new Set());

  // Goal icon picker state
  const [showIconPicker, setShowIconPicker] = useState(false);

  // Notes state
  const [showNotes, setShowNotes] = useState(false);
  const [notesValue, setNotesValue] = useState(goal?.notes || "");
  const [notesSaved, setNotesSaved] = useState(false);

  // Chat input ref for emoji/text insertion
  const gpChatInputRef = useRef<HTMLInputElement>(null);

  const handleInsertTextToGpChat = useCallback((text: string) => {
    setChatInput((prev) => prev + text);
    gpChatInputRef.current?.focus();
  }, []);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const t = useT();
  const lang = useStore((s) => s.user?.settings?.language || "en");

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [goal?.planChat]);

  // Auto-expand unlocked weeks on first render
  useEffect(() => {
    if (goal?.plan && Array.isArray(goal.plan.years)) {
      const unlockedWeekIds = new Set<string>();
      const yearIds = new Set<string>();
      const monthIds = new Set<string>();
      for (const yr of goal.plan.years) {
        for (const mo of yr.months) {
          for (const wk of mo.weeks) {
            if (!wk.locked) {
              unlockedWeekIds.add(wk.id);
              monthIds.add(mo.id);
              yearIds.add(yr.id);
            }
          }
        }
      }
      setExpandedWeeks(unlockedWeekIds);
      setExpandedMonths(monthIds);
      setExpandedYears(yearIds);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goalId]);

  // Count overdue tasks (unlocked, past date, incomplete)
  const overdueTasks = (() => {
    if (!goal?.plan) return 0;
    const today = new Date().toISOString().split("T")[0];
    let count = 0;
    for (const yr of goal.plan.years) {
      for (const mo of yr.months) {
        for (const wk of mo.weeks) {
          if (wk.locked) continue;
          for (const dy of wk.days) {
            // Try to parse the day label as a date
            const dayDate = dy.label; // e.g., "Jan 6" or "Monday"
            // Count incomplete tasks in unlocked past weeks
            for (const task of dy.tasks) {
              if (!task.completed) count++;
            }
          }
        }
      }
    }
    // Only show if there are significant incomplete tasks
    return count;
  })();

  const showRescheduleBanner = overdueTasks > 5 && !rescheduleDismissed && !isRescheduling && goal?.planConfirmed;

  const handleReschedule = useCallback(async () => {
    if (!goal?.plan) return;
    setIsRescheduling(true);
    try {
      const calendarEvents = useStore.getState().calendarEvents;
      const updatedPlan = await reallocateGoalPlan(
        goal.plan,
        `User has ${overdueTasks} incomplete tasks and is falling behind schedule. Redistribute remaining tasks to realistic future dates.`,
        calendarEvents
      );
      if (updatedPlan && updatedPlan.years) {
        updateGoal(goal.id, { plan: updatedPlan });
        addGoalPlanMessage(goal.id, {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "I've adjusted your timeline to be more realistic based on your current progress. The remaining tasks have been redistributed.",
          timestamp: new Date().toISOString(),
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reschedule");
    } finally {
      setIsRescheduling(false);
    }
  }, [goal, overdueTasks, updateGoal, addGoalPlanMessage, setError]);

  // Generate initial plan if none exists. If a job is already in flight (jobId
  // persisted in localStorage from a previous mount), reattach to it instead of
  // submitting a new one — that way the AI's progress display picks up where it
  // left off when the user navigates away and back.
  useEffect(() => {
    if (!goal) return;

    const storedJobId = readStoredJobId(goal.id);
    if (storedJobId && !goal.plan) {
      // Reattach to in-flight job
      setLoading(true);
      setShowAgentProgress(true);
      setPlanJobId(storedJobId);
      (async () => {
        try {
          const result = await pollJobUntilDone<{ reply: string; plan: import("../types").GoalPlan }>(storedJobId);
          const aiMsg: GoalPlanMessage = {
            id: crypto.randomUUID(),
            role: "assistant",
            content: result.reply,
            timestamp: new Date().toISOString(),
          };
          addGoalPlanMessage(goal.id, aiMsg);
          if (result.plan) setGoalPlan(goal.id, result.plan);

          // Success — clean up
          setLoading(false);
          setShowAgentProgress(false);
          setPlanJobId(null);
          clearStoredJobId(goal.id);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Failed to generate plan");
          // Keep progress + jobId so the user can still see the AI's partial
          // thought process and retry from the empty state below.
          setLoading(false);
        }
      })();
      return;
    }

    if (!goal.plan && (goal.planChat?.length ?? 0) === 0 && goal.status === "pending") {
      handleGenerateInitialPlan();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goalId]);

  const handleGenerateInitialPlan = useCallback(async () => {
    if (!goal) return;
    setLoading(true);
    setShowAgentProgress(true);
    setPlanJobId(null);
    clearStoredJobId(goal.id);
    updateGoal(goal.id, { status: "planning" });

    try {
      // Submit job and capture jobId for progress tracking
      const jobId = await submitGoalPlanJob(goal.title, goal.targetDate, goal.importance, goal.isHabit, goal.description);
      setPlanJobId(jobId);
      // Persist so progress reattaches if the user navigates away and back
      storeJobId(goal.id, jobId);

      // Poll until done — AgentProgress will display live progress via jobId
      const result = await pollJobUntilDone<{ reply: string; plan: import("../types").GoalPlan }>(jobId);

      const aiMsg: GoalPlanMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: result.reply,
        timestamp: new Date().toISOString(),
      };
      addGoalPlanMessage(goal.id, aiMsg);

      if (result.plan) {
        setGoalPlan(goal.id, result.plan);
      }

      // Success — clean up progress display and persisted job id
      setLoading(false);
      setShowAgentProgress(false);
      setPlanJobId(null);
      localStorage.removeItem(`planJobId:${goal.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate plan");
      // Keep showAgentProgress + planJobId around on failure so the user can
      // still see the AI's partial thought process, and so a re-mount can
      // reattach if the backend job is still running.
      setLoading(false);
    }
  }, [goal, setLoading, updateGoal, addGoalPlanMessage, setGoalPlan, setError]);

  const handleSendMessage = useCallback(async () => {
    if (!goal || !chatInput.trim()) return;

    const userMsg: GoalPlanMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: chatInput.trim(),
      timestamp: new Date().toISOString(),
    };
    addGoalPlanMessage(goal.id, userMsg);
    setChatInput("");
    setLoading(true);

    try {
      const result = await sendGoalPlanMessage(
        goal.title,
        goal.targetDate,
        goal.importance,
        goal.isHabit,
        goal.description,
        [...(goal.planChat ?? []), userMsg],
        userMsg.content,
        goal.plan    // pass current plan so AI can reference it
      );

      const aiMsg: GoalPlanMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: result.reply,
        timestamp: new Date().toISOString(),
      };
      addGoalPlanMessage(goal.id, aiMsg);

      if (result.planReady && result.plan) {
        setGoalPlan(goal.id, result.plan);
      } else if (result.planPatch && goal.plan) {
        // Apply targeted patch to existing plan
        const patched = applyPlanPatch(goal.plan, result.planPatch);
        updateGoal(goal.id, { plan: patched });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setLoading(false);
    }
  }, [goal, chatInput, addGoalPlanMessage, setLoading, setError, setGoalPlan]);

  const handleConfirmPlan = useCallback(() => {
    if (!goal) return;
    confirmGoalPlan(goal.id);
  }, [goal, confirmGoalPlan]);

  const handleToggleTask = useCallback(
    (weekId: string, dayId: string, taskId: string) => {
      if (!goal?.plan) return;
      const toggled = toggleTaskInPlan(goal.plan, weekId, dayId, taskId);
      // Sync milestone completion based on new task state
      const updated = syncMilestoneCompletion(toggled);
      updateGoal(goal.id, { plan: updated });
    },
    [goal, updateGoal]
  );

  const handleUnlockNext = useCallback(() => {
    if (!goal?.plan) return;
    const updated = unlockNextWeek(goal.plan);
    updateGoal(goal.id, { plan: updated });
  }, [goal, updateGoal]);

  const toggleSet = (set: Set<string>, id: string, setter: React.Dispatch<React.SetStateAction<Set<string>>>) => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (!goal) {
    return (
      <div className="goal-plan-page">
        <div className="goal-plan-scroll">
          <div className="goal-plan-empty">
            <p>{t.goalPlan.notFound}</p>
            <button className="btn btn-primary" onClick={() => setView("dashboard")}>
              <ArrowLeft size={16} />
              {t.goalPlan.backToHome}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Defensive default — old goals saved before the planChat field existed
  // can have it as undefined, which would crash the chat render below.
  const planChat = goal.planChat ?? [];

  const importanceColors: Record<string, string> = {
    low: "badge-blue",
    medium: "badge-yellow",
    high: "badge-red",
    critical: "badge-red",
  };

  const { total: totalTasks, completed: completedTasks } = goal.plan && Array.isArray(goal.plan.years)
    ? countPlanTasks(goal.plan)
    : { total: 0, completed: 0 };
  const progressPercent = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const hasLockedWeeks = Array.isArray(goal.plan?.years) && goal.plan?.years.some((yr) =>
    yr.months.some((mo) => mo.weeks.some((wk) => wk.locked))
  );

  return (
    <div className="goal-plan-page">
      <div className="goal-plan-scroll">
        {/* Header */}
        <header className="gp-header animate-fade-in">
          <button className="btn btn-ghost btn-sm gp-back" onClick={() => setView("planning")}>
            <ArrowLeft size={16} />
            Planning
          </button>
          <div className="gp-header-main">
            <div className="gp-header-info">
              <button
                className={`goal-icon-btn gp-header-icon-btn ${goal.icon ? "has-icon" : ""}`}
                onClick={() => setShowIconPicker(!showIconPicker)}
                title="Choose icon"
              >
                {goal.icon || <Target size={24} />}
              </button>
              {showIconPicker && (
                <IconPicker
                  currentIcon={goal.icon}
                  onSelect={(icon) => updateGoal(goal.id, { icon })}
                  onClose={() => setShowIconPicker(false)}
                />
              )}
              <div>
                <h2>{goal.title}</h2>
                {goal.description && (
                  <p className="gp-header-description">{goal.description}</p>
                )}
                <div className="gp-header-meta">
                  <span className={`badge ${importanceColors[goal.importance]}`}>
                    {goal.importance}
                  </span>
                  {goal.isHabit && (
                    <span className="badge badge-purple">
                      {t.common.habit}
                    </span>
                  )}
                  {goal.targetDate && !goal.isHabit && (
                    <span className="gp-meta-item">
                      <Clock size={14} />
                      {new Date(goal.targetDate).toLocaleDateString(getDateLocale(lang), {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </span>
                  )}
                  <span className={`badge ${goal.planConfirmed ? "badge-green" : "badge-yellow"}`}>
                    {goal.planConfirmed ? t.common.active : t.common.planning}
                  </span>
                </div>
              </div>
            </div>
            {totalTasks > 0 && (
              <div className="gp-progress">
                <div className="gp-progress-label">
                  {t.goalPlan.tasksProgress(completedTasks, totalTasks, progressPercent)}
                </div>
                <div className="gp-progress-bar">
                  <div
                    className="gp-progress-fill"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </header>

        {/* AI thought process — rendered right after the header while the
            plan is being generated so the user actually sees the agents
            working (previously it was at the bottom of the page, below the
            fold on small windows). The spinner + heading always show so
            there's something visible before the first progress event arrives. */}
        {(showAgentProgress || isLoading) && !goal.plan && (
          <div className="gp-generating animate-fade-in">
            <Loader2 size={32} className="spin" />
            <h3>{t.goalPlan.creatingPlan}</h3>
            <p>{t.goalPlan.creatingPlanDesc}</p>
            {showAgentProgress && (
              <AgentProgress visible={true} title={t.goalPlan.creatingPlan} jobId={planJobId} />
            )}
          </div>
        )}

        {/* ── Milestone Timeline ── */}
        {goal.plan && goal.plan.milestones.length > 0 && (() => {
          const milestoneProgress = computeMilestoneProgress(goal.plan!);
          return (
            <section className="gp-milestones animate-slide-up">
              <h3 className="gp-section-heading">
                <Flag size={16} />
                {t.goalPlan.milestoneTimeline}
              </h3>
              <div className="gp-milestone-track">
                {milestoneProgress.map((ms, i) => {
                  const isInProgress = ms.progressPercent > 0 && !ms.completed;
                  return (
                    <div
                      key={ms.id}
                      className={`gp-milestone ${ms.completed ? "completed" : ""} ${isInProgress ? "in-progress" : ""}`}
                    >
                      <div className="gp-milestone-dot">
                        {ms.completed ? <CheckCircle2 size={16} /> : <Circle size={16} />}
                      </div>
                      {i < milestoneProgress.length - 1 && (
                        <div className="gp-milestone-line">
                          <div
                            className="gp-milestone-line-fill"
                            style={{ height: `${ms.completed ? 100 : ms.progressPercent}%` }}
                          />
                        </div>
                      )}
                      <div className="gp-milestone-info">
                        <span className="gp-milestone-title">{ms.title}</span>
                        <span className="gp-milestone-desc">{ms.description}</span>
                        <span className="gp-milestone-date">{ms.targetDate}</span>
                        {ms.segmentTotal > 0 && (
                          <div className="gp-milestone-progress">
                            <div className="gp-milestone-progress-bar">
                              <div
                                className="gp-milestone-progress-fill"
                                style={{ width: `${ms.progressPercent}%` }}
                              />
                            </div>
                            <span className="gp-milestone-progress-label">
                              {t.goalPlan.milestoneProgress(ms.segmentCompleted, ms.segmentTotal, ms.progressPercent)}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })()}

        {/* ── Hierarchical Plan: Years → Months → Weeks → Days ── */}
        {goal.plan && Array.isArray(goal.plan.years) && goal.plan.years.length > 0 && (
          <section className="gp-hierarchy animate-slide-up">
            {goal.plan.years.map((year) => (
              <div key={year.id} className="gp-year">
                <div className="gp-year-header-row">
                  <button
                    className="gp-year-header"
                    onClick={() => toggleSet(expandedYears, year.id, setExpandedYears)}
                  >
                    <div className="gp-level-left">
                      {expandedYears.has(year.id) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      <Calendar size={16} className="gp-level-icon year-icon" />
                      <span className="gp-level-label">{year.label}</span>
                    </div>
                    <span className="gp-level-objective">{year.objective}</span>
                  </button>
                </div>

                {expandedYears.has(year.id) && (
                  <div className="gp-year-body">
                    {year.months.map((month) => (
                      <div key={month.id} className="gp-month">
                        <div className="gp-month-header-row">
                          <button
                            className="gp-month-header"
                            onClick={() => toggleSet(expandedMonths, month.id, setExpandedMonths)}
                          >
                            <div className="gp-level-left">
                              {expandedMonths.has(month.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                              <span className="gp-level-label">{month.label}</span>
                            </div>
                            <span className="gp-level-objective">{month.objective}</span>
                          </button>
                        </div>

                        {expandedMonths.has(month.id) && (
                          <div className="gp-month-body">
                            {month.weeks.map((week) => (
                              <WeekCard
                                key={week.id}
                                week={week}
                                isExpanded={expandedWeeks.has(week.id)}
                                onToggle={() => toggleSet(expandedWeeks, week.id, setExpandedWeeks)}
                                onToggleTask={handleToggleTask}
                                lang={lang}
                                t={t}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {/* Unlock next week button */}
            {hasLockedWeeks && (
              <button className="btn btn-ghost gp-unlock-btn" onClick={handleUnlockNext}>
                <Unlock size={14} />
                {t.goalPlan.unlockNextWeek}
              </button>
            )}
          </section>
        )}

        {/* Chat — always visible, primary way to discuss/modify the plan.
            Positioned after the generated tasks and before the confirm bar. */}
        <div className="gp-chat gp-chat-prominent animate-slide-up">
          <div className="gp-chat-header-static">
            <MessageSquare size={16} />
            <h3>{t.goalPlan.planningChat}</h3>
            {planChat.length > 0 && (
              <span className="gp-chat-count">{planChat.length}</span>
            )}
          </div>

          {planChat.length > 0 && (
            <div className="gp-chat-messages">
              {planChat.map((msg) => (
                <div key={msg.id} className={`gp-chat-msg ${msg.role}`}>
                  <div className="gp-chat-msg-avatar">
                    {msg.role === "assistant" ? (
                      <Sparkles size={14} />
                    ) : (
                      <Edit3 size={14} />
                    )}
                  </div>
                  <div className="gp-chat-msg-content">
                    <p>{msg.content}</p>
                    <span className="gp-chat-msg-time">
                      {new Date(msg.timestamp).toLocaleTimeString(getDateLocale(lang), {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="gp-chat-msg assistant">
                  <div className="gp-chat-msg-avatar">
                    <Loader2 size={14} className="spin" />
                  </div>
                  <div className="gp-chat-msg-content">
                    <p className="gp-typing">{t.goalPlan.thinking}</p>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
          )}

          {planChat.length === 0 && (
            <div className="gp-chat-empty">
              <p>Ask the AI to adjust your plan, change timelines, add tasks, or discuss strategy.</p>
            </div>
          )}

          <div className="gp-chat-input-area">
            <RichTextToolbar
              onInsertText={handleInsertTextToGpChat}
              compact
            />
            <div className="gp-chat-input-row">
              <input
                ref={gpChatInputRef}
                className="input gp-chat-input"
                placeholder={t.goalPlan.chatPlaceholder}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                disabled={isLoading}
              />
              <button
                className="btn btn-primary btn-sm"
                onClick={handleSendMessage}
                disabled={isLoading || !chatInput.trim()}
              >
                {isLoading ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
              </button>
            </div>
          </div>
        </div>

        {/* Reschedule banner — too many incomplete tasks */}
        {showRescheduleBanner && (
          <div className="gp-reschedule-banner animate-slide-up">
            <div className="gp-reschedule-content">
              <AlertTriangle size={16} />
              <div>
                <strong>You have {overdueTasks} incomplete tasks.</strong>
                <p>Want me to adjust the timeline to be more realistic?</p>
              </div>
            </div>
            <div className="gp-reschedule-actions">
              <button className="btn btn-primary btn-sm" onClick={handleReschedule}>
                <RefreshCw size={13} />
                Adjust Timeline
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setRescheduleDismissed(true)}>
                Dismiss
              </button>
            </div>
          </div>
        )}

        {isRescheduling && (
          <div className="gp-generating animate-fade-in">
            <Loader2 size={32} className="spin" />
            <h3>Adjusting your timeline...</h3>
            <p>Redistributing tasks based on your progress and schedule.</p>
          </div>
        )}

        {/* Confirm plan button */}
        {goal.plan && !goal.planConfirmed && (
          <div className="gp-confirm-bar animate-slide-up">
            <p>{t.goalPlan.reviewPlan}</p>
            <div className="gp-confirm-actions">
              <button
                className="btn btn-primary"
                onClick={handleConfirmPlan}
              >
                <CheckCircle2 size={16} />
                {t.goalPlan.confirmStart}
              </button>
            </div>
          </div>
        )}

        {/* Notes section */}
        <div className="gp-notes animate-slide-up">
          <div className="gp-notes-header" onClick={() => setShowNotes(!showNotes)}>
            <FileText size={16} />
            <h3>Notes</h3>
            {showNotes ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </div>
          {showNotes && (
            <div className="gp-notes-body">
              <textarea
                className="input gp-notes-textarea"
                placeholder="Add your thoughts, research, links, or anything related to this goal..."
                value={notesValue}
                onChange={(e) => {
                  setNotesValue(e.target.value);
                  setNotesSaved(false);
                }}
                onBlur={() => {
                  if (notesValue !== (goal.notes || "")) {
                    updateGoal(goal.id, { notes: notesValue });
                    setNotesSaved(true);
                    setTimeout(() => setNotesSaved(false), 2000);
                  }
                }}
                rows={6}
              />
              {notesSaved && <span className="gp-notes-saved">Saved</span>}
            </div>
          )}
        </div>


        {/* Empty / retry state — plan failed, timed out, or was interrupted.
            Shows below the AgentProgress so the user can both see the partial
            thought process and retry. */}
        {!isLoading && !goal.plan && (
          <div className="gp-empty-state animate-fade-in">
            <RefreshCw size={32} />
            <h3>No plan yet</h3>
            <p>The plan may not have finished generating. Hit the button below to try again.</p>
            <button
              className="btn btn-primary"
              onClick={handleGenerateInitialPlan}
            >
              <RefreshCw size={14} />
              Generate Plan
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Week Card ──

function WeekCard({
  week,
  isExpanded,
  onToggle,
  onToggleTask,
  lang,
  t,
}: {
  week: GoalPlanWeek;
  isExpanded: boolean;
  onToggle: () => void;
  onToggleTask: (weekId: string, dayId: string, taskId: string) => void;
  lang: string;
  t: any;
}) {
  if (week.locked) {
    return (
      <div className="gp-week locked">
        <div className="gp-week-header locked-header">
          <div className="gp-level-left">
            <Lock size={14} className="gp-lock-icon" />
            <span className="gp-level-label">{week.label}</span>
          </div>
          <span className="gp-locked-hint">{t.goalPlan.lockedHint}</span>
        </div>
      </div>
    );
  }

  const totalTasks = week.days.reduce((sum, d) => sum + d.tasks.length, 0);
  const completedTasks = week.days.reduce(
    (sum, d) => sum + d.tasks.filter((tk) => tk.completed).length,
    0
  );
  const allDone = totalTasks > 0 && completedTasks === totalTasks;

  return (
    <div className={`gp-week ${isExpanded ? "expanded" : ""} ${allDone ? "all-done" : ""}`}>
      <div className="gp-week-header-row">
        <button className="gp-week-header" onClick={onToggle}>
          <div className="gp-level-left">
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span className="gp-level-label">{week.label}</span>
          </div>
          <div className="gp-week-right">
            <span className="gp-level-objective">{week.objective}</span>
            <span className="gp-section-count">
              {completedTasks}/{totalTasks}
            </span>
          </div>
        </button>
      </div>

      {isExpanded && (
        <div className="gp-week-body animate-slide-up">
          {week.days.map((day) => (
            <div key={day.id} className="gp-day">
              <div className="gp-day-label">{day.label}</div>
              <div className="gp-day-tasks">
                {day.tasks.map((task) => (
                    <div
                      key={task.id}
                      className={`gp-task ${task.completed ? "completed" : ""}`}
                    >
                      <div
                        className={`gp-task-check ${task.completed ? "checked" : ""}`}
                        onClick={() => onToggleTask(week.id, day.id, task.id)}
                      >
                        {task.completed && <CheckCircle2 size={14} />}
                      </div>
                      <div className="gp-task-info">
                        <span className="gp-task-title">{task.title}</span>
                        {task.description && (
                          <p className="gp-task-desc">{task.description}</p>
                        )}
                        <div className="gp-task-meta">
                          <span className="gp-task-duration">
                            <Clock size={11} />
                            {task.durationMinutes}m
                          </span>
                          <span className={`gp-task-priority priority-${task.priority}`}>
                            {task.priority}
                          </span>
                        </div>
                      </div>
                    </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
