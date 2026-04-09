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
  Pencil,
  Check,
  X,
  AlertTriangle,
  Info,
  ShieldCheck,
  FileText,
} from "lucide-react";
import useStore from "../store/useStore";
import { useT, getDateLocale } from "../i18n";
import { sendGoalPlanMessage, generateGoalPlan, analyzeGoalPlanEdit } from "../services/ai";
import AgentProgress from "../components/AgentProgress";
import RichTextToolbar, { IconPicker } from "../components/RichTextToolbar";
import type {
  GoalPlanMessage,
  GoalPlan,
  GoalPlanWeek,
  GoalPlanTask,
  GoalPlanMilestone,
  PlanEdit,
  PlanEditSuggestion,
  PlanEditLevel,
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

// ── Helper: apply a targeted field edit deep in the plan tree ──
function applyFieldEdit(
  plan: GoalPlan,
  level: PlanEditLevel,
  targetId: string,
  field: string,
  value: string
): GoalPlan {
  if (level === "milestone") {
    return {
      ...plan,
      milestones: plan.milestones.map((ms) =>
        ms.id === targetId ? { ...ms, [field]: value } : ms
      ),
    };
  }

  return {
    ...plan,
    years: plan.years.map((yr) => {
      if (level === "year" && yr.id === targetId) {
        return { ...yr, [field]: value };
      }
      return {
        ...yr,
        months: yr.months.map((mo) => {
          if (level === "month" && mo.id === targetId) {
            return { ...mo, [field]: value };
          }
          return {
            ...mo,
            weeks: mo.weeks.map((wk) => {
              if (level === "week" && wk.id === targetId) {
                return { ...wk, [field]: value };
              }
              return {
                ...wk,
                days: wk.days.map((dy) => {
                  if (level === "day" && dy.id === targetId) {
                    return { ...dy, [field]: value };
                  }
                  return {
                    ...dy,
                    tasks: dy.tasks.map((tk) => {
                      if (level === "task" && tk.id === targetId) {
                        // Handle numeric fields
                        if (field === "durationMinutes") {
                          return { ...tk, [field]: parseInt(value, 10) || tk.durationMinutes };
                        }
                        return { ...tk, [field]: value };
                      }
                      return tk;
                    }),
                  };
                }),
              };
            }),
          };
        }),
      };
    }),
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
  const [showChat, setShowChat] = useState(false);
  const [showAgentProgress, setShowAgentProgress] = useState(false);
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

  // ── Inline editing state ──
  const [editingItem, setEditingItem] = useState<{
    level: PlanEditLevel;
    id: string;
    field: string;
    path: { yearId?: string; monthId?: string; weekId?: string; dayId?: string };
  } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editOriginalValue, setEditOriginalValue] = useState("");
  const [editSuggestion, setEditSuggestion] = useState<PlanEditSuggestion | null>(null);
  const [isAnalyzingEdit, setIsAnalyzingEdit] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const t = useT();
  const lang = useStore((s) => s.user?.settings?.language || "en");

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
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

  // Generate initial plan if none exists
  useEffect(() => {
    if (goal && !goal.plan && goal.planChat.length === 0 && goal.status === "pending") {
      handleGenerateInitialPlan();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goalId]);

  const handleGenerateInitialPlan = useCallback(async () => {
    if (!goal) return;
    setLoading(true);
    setShowAgentProgress(true);
    updateGoal(goal.id, { status: "planning" });

    try {
      const result = await generateGoalPlan(goal.title, goal.targetDate, goal.importance, goal.isHabit, goal.description);

      const aiMsg: GoalPlanMessage = {
        id: `msg-${Date.now()}`,
        role: "assistant",
        content: result.reply,
        timestamp: new Date().toISOString(),
      };
      addGoalPlanMessage(goal.id, aiMsg);

      if (result.plan) {
        setGoalPlan(goal.id, result.plan);
      }

      setShowChat(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate plan");
    } finally {
      setLoading(false);
      setShowAgentProgress(false);
    }
  }, [goal, setLoading, updateGoal, addGoalPlanMessage, setGoalPlan, setError]);

  const handleSendMessage = useCallback(async () => {
    if (!goal || !chatInput.trim()) return;

    const userMsg: GoalPlanMessage = {
      id: `msg-${Date.now()}`,
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
        [...goal.planChat, userMsg],
        userMsg.content,
        goal.plan    // pass current plan so AI can reference it
      );

      const aiMsg: GoalPlanMessage = {
        id: `msg-${Date.now() + 1}`,
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

  // ── Inline Editing Handlers ──

  /** Build a compact plan summary string for the AI */
  const buildPlanSummary = useCallback((): string => {
    if (!goal?.plan) return "No plan yet.";
    const lines: string[] = ["PLAN STRUCTURE:"];
    for (const ms of goal.plan.milestones) {
      lines.push(`  MS: [${ms.completed ? "✓" : " "}] ${ms.title} (${ms.targetDate})`);
    }
    for (const yr of goal.plan.years) {
      lines.push(`  Year: ${yr.label} — ${yr.objective}`);
      for (const mo of yr.months) {
        lines.push(`    Month: ${mo.label} — ${mo.objective}`);
        for (const wk of mo.weeks) {
          const taskCount = wk.days.reduce((s, d) => s + d.tasks.length, 0);
          lines.push(`      Week: ${wk.label} ${wk.locked ? "🔒" : "🔓"} — ${wk.objective} (${taskCount} tasks)`);
        }
      }
    }
    return lines.join("\n");
  }, [goal?.plan]);

  /** Start editing a field inline */
  const startEdit = useCallback((
    level: PlanEditLevel,
    id: string,
    field: string,
    currentValue: string,
    path: { yearId?: string; monthId?: string; weekId?: string; dayId?: string }
  ) => {
    setEditingItem({ level, id, field, path });
    setEditValue(currentValue);
    setEditOriginalValue(currentValue);
    setEditSuggestion(null);
    setTimeout(() => editInputRef.current?.focus(), 50);
  }, []);

  /** Cancel editing */
  const cancelEdit = useCallback(() => {
    setEditingItem(null);
    setEditValue("");
    setEditOriginalValue("");
    setEditSuggestion(null);
    setIsAnalyzingEdit(false);
  }, []);

  /** Submit edit for AI review (not yet committed) */
  const submitEditForReview = useCallback(async () => {
    if (!editingItem || !goal?.plan || editValue === editOriginalValue) {
      cancelEdit();
      return;
    }

    setIsAnalyzingEdit(true);

    try {
      const edit: PlanEdit = {
        level: editingItem.level,
        targetId: editingItem.id,
        field: editingItem.field,
        oldValue: editOriginalValue,
        newValue: editValue,
        path: editingItem.path,
      };

      const suggestion = await analyzeGoalPlanEdit(
        goal.title,
        edit,
        buildPlanSummary()
      );

      setEditSuggestion(suggestion);
    } catch (err) {
      // If AI analysis fails, still let user apply the edit
      setEditSuggestion({
        verdict: "approve",
        reason: "Unable to analyze — but this looks like a safe change.",
        requiresReplan: false,
      });
    } finally {
      setIsAnalyzingEdit(false);
    }
  }, [editingItem, goal, editValue, editOriginalValue, cancelEdit, buildPlanSummary]);

  /** Apply the confirmed edit to the plan (deep update) */
  const confirmEdit = useCallback(() => {
    if (!editingItem || !goal?.plan) return;

    let updatedPlan = applyFieldEdit(
      goal.plan,
      editingItem.level,
      editingItem.id,
      editingItem.field,
      editValue
    );

    // Apply AI-suggested cascading changes
    if (editSuggestion?.cascadingChanges) {
      for (const cascade of editSuggestion.cascadingChanges) {
        updatedPlan = applyFieldEdit(
          updatedPlan,
          cascade.level,
          cascade.targetId,
          cascade.field,
          cascade.suggestedValue
        );
      }
    }

    const synced = syncMilestoneCompletion(updatedPlan);
    updateGoal(goal.id, { plan: synced });
    cancelEdit();
  }, [editingItem, goal, editValue, editSuggestion, updateGoal, cancelEdit]);

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
                    {editingItem?.id !== year.id && (
                      <span className="gp-level-objective">{year.objective}</span>
                    )}
                  </button>
                  {editingItem?.id === year.id ? (
                    <InlineEditInput
                      value={editValue}
                      onChange={setEditValue}
                      onSubmit={submitEditForReview}
                      onCancel={cancelEdit}
                      isLoading={isAnalyzingEdit}
                      inputRef={editInputRef}
                    />
                  ) : (
                    <button
                      className="gp-edit-btn"
                      onClick={(e) => { e.stopPropagation(); startEdit("year", year.id, "objective", year.objective, { yearId: year.id }); }}
                      title={t.goalPlan.editObjective}
                    >
                      <Pencil size={12} />
                    </button>
                  )}
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
                            {editingItem?.id !== month.id && (
                              <span className="gp-level-objective">{month.objective}</span>
                            )}
                          </button>
                          {editingItem?.id === month.id ? (
                            <InlineEditInput
                              value={editValue}
                              onChange={setEditValue}
                              onSubmit={submitEditForReview}
                              onCancel={cancelEdit}
                              isLoading={isAnalyzingEdit}
                              inputRef={editInputRef}
                            />
                          ) : (
                            <button
                              className="gp-edit-btn"
                              onClick={(e) => { e.stopPropagation(); startEdit("month", month.id, "objective", month.objective, { yearId: year.id, monthId: month.id }); }}
                              title={t.goalPlan.editObjective}
                            >
                              <Pencil size={12} />
                            </button>
                          )}
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
                                onStartEdit={startEdit}
                                editingItem={editingItem}
                                editValue={editValue}
                                setEditValue={setEditValue}
                                submitEditForReview={submitEditForReview}
                                cancelEdit={cancelEdit}
                                isAnalyzingEdit={isAnalyzingEdit}
                                editInputRef={editInputRef}
                                parentPath={{ yearId: year.id, monthId: month.id }}
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

        {/* ── Edit suggestion overlay ── */}
        {editSuggestion && editingItem && (
          <div className="gp-edit-overlay animate-fade-in">
            <div className="gp-edit-overlay-card">
              <div className={`gp-edit-verdict gp-edit-verdict-${editSuggestion.verdict}`}>
                {editSuggestion.verdict === "approve" && <ShieldCheck size={18} />}
                {editSuggestion.verdict === "caution" && <Info size={18} />}
                {editSuggestion.verdict === "warn" && <AlertTriangle size={18} />}
                <span className="gp-edit-verdict-label">
                  {editSuggestion.verdict === "approve" && t.goalPlan.editApproved}
                  {editSuggestion.verdict === "caution" && t.goalPlan.editCaution}
                  {editSuggestion.verdict === "warn" && t.goalPlan.editWarning}
                </span>
              </div>

              <p className="gp-edit-reason">{editSuggestion.reason}</p>

              {editSuggestion.cascadingChanges && editSuggestion.cascadingChanges.length > 0 && (
                <div className="gp-edit-cascading">
                  <h4>{t.goalPlan.suggestedChanges}</h4>
                  {editSuggestion.cascadingChanges.map((c, i) => (
                    <div key={i} className="gp-edit-cascade-item">
                      <span className="gp-cascade-badge">{c.level}</span>
                      <span className="gp-cascade-field">{c.field}:</span>
                      <span className="gp-cascade-value">"{c.suggestedValue}"</span>
                      <span className="gp-cascade-reason">— {c.reason}</span>
                    </div>
                  ))}
                </div>
              )}

              {editSuggestion.requiresReplan && (
                <p className="gp-edit-replan-warning">
                  <AlertTriangle size={14} />
                  {t.goalPlan.requiresReplan}
                </p>
              )}

              <div className="gp-edit-overlay-actions">
                <button className="btn btn-ghost btn-sm" onClick={cancelEdit}>
                  {t.common.cancel}
                </button>
                {!editSuggestion.requiresReplan && (
                  <button className="btn btn-primary btn-sm" onClick={confirmEdit}>
                    <Check size={14} />
                    {t.goalPlan.applyEdit}
                  </button>
                )}
                {editSuggestion.requiresReplan && (
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      // Open chat with the edit as a message so AI can replan
                      setShowChat(true);
                      setChatInput(`I want to change the ${editingItem.level} "${editOriginalValue}" to "${editValue}". Can you adjust the plan?`);
                      cancelEdit();
                    }}
                  >
                    <MessageSquare size={14} />
                    {t.goalPlan.discussInChat}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Confirm plan button */}
        {goal.plan && !goal.planConfirmed && (
          <div className="gp-confirm-bar animate-slide-up">
            <p>{t.goalPlan.reviewPlan}</p>
            <div className="gp-confirm-actions">
              <button
                className="btn btn-ghost"
                onClick={() => setShowChat(true)}
              >
                <MessageSquare size={16} />
                {t.goalPlan.discussChanges}
              </button>
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

        {/* Chat section */}
        {(showChat || goal.planChat.length > 0) && (
          <div className="gp-chat animate-slide-up">
            <div className="gp-chat-header" onClick={() => setShowChat(!showChat)}>
              <MessageSquare size={16} />
              <h3>{t.goalPlan.planningChat}</h3>
              {showChat ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </div>

            {showChat && (
              <>
                <div className="gp-chat-messages">
                  {goal.planChat.map((msg) => (
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
              </>
            )}
          </div>
        )}

        {/* Loading state for initial plan generation — now shows agent progress */}
        {isLoading && !goal.plan && (
          <div className="gp-generating animate-fade-in">
            {showAgentProgress ? (
              <AgentProgress visible={true} title={t.goalPlan.creatingPlan} />
            ) : (
              <>
                <Loader2 size={32} className="spin" />
                <h3>{t.goalPlan.creatingPlan}</h3>
                <p>{t.goalPlan.creatingPlanDesc}</p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Inline Edit Input ──

function InlineEditInput({
  value,
  onChange,
  onSubmit,
  onCancel,
  isLoading,
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  isLoading: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="gp-inline-edit" onClick={(e) => e.stopPropagation()}>
      <input
        ref={inputRef as React.RefObject<HTMLInputElement>}
        className="input gp-inline-edit-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); onSubmit(); }
          if (e.key === "Escape") onCancel();
        }}
        disabled={isLoading}
      />
      {isLoading ? (
        <Loader2 size={14} className="spin gp-inline-edit-spinner" />
      ) : (
        <>
          <button className="gp-inline-edit-btn confirm" onClick={onSubmit} title="Submit for review">
            <Check size={13} />
          </button>
          <button className="gp-inline-edit-btn cancel" onClick={onCancel} title="Cancel">
            <X size={13} />
          </button>
        </>
      )}
    </div>
  );
}

// ── Week Card ──

function WeekCard({
  week,
  isExpanded,
  onToggle,
  onToggleTask,
  onStartEdit,
  editingItem,
  editValue,
  setEditValue,
  submitEditForReview,
  cancelEdit,
  isAnalyzingEdit,
  editInputRef,
  parentPath,
  lang,
  t,
}: {
  week: GoalPlanWeek;
  isExpanded: boolean;
  onToggle: () => void;
  onToggleTask: (weekId: string, dayId: string, taskId: string) => void;
  onStartEdit: (level: PlanEditLevel, id: string, field: string, currentValue: string, path: { yearId?: string; monthId?: string; weekId?: string; dayId?: string }) => void;
  editingItem: { level: PlanEditLevel; id: string; field: string; path: Record<string, string | undefined> } | null;
  editValue: string;
  setEditValue: (v: string) => void;
  submitEditForReview: () => void;
  cancelEdit: () => void;
  isAnalyzingEdit: boolean;
  editInputRef: React.RefObject<HTMLInputElement | null>;
  parentPath: { yearId: string; monthId: string };
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
  const weekPath = { ...parentPath, weekId: week.id };

  return (
    <div className={`gp-week ${isExpanded ? "expanded" : ""} ${allDone ? "all-done" : ""}`}>
      <div className="gp-week-header-row">
        <button className="gp-week-header" onClick={onToggle}>
          <div className="gp-level-left">
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span className="gp-level-label">{week.label}</span>
          </div>
          <div className="gp-week-right">
            {editingItem?.id !== week.id && (
              <span className="gp-level-objective">{week.objective}</span>
            )}
            <span className="gp-section-count">
              {completedTasks}/{totalTasks}
            </span>
          </div>
        </button>
        {editingItem?.id === week.id ? (
          <InlineEditInput
            value={editValue}
            onChange={setEditValue}
            onSubmit={submitEditForReview}
            onCancel={cancelEdit}
            isLoading={isAnalyzingEdit}
            inputRef={editInputRef}
          />
        ) : (
          <button
            className="gp-edit-btn"
            onClick={(e) => { e.stopPropagation(); onStartEdit("week", week.id, "objective", week.objective, weekPath); }}
            title={t.goalPlan.editObjective}
          >
            <Pencil size={12} />
          </button>
        )}
      </div>

      {isExpanded && (
        <div className="gp-week-body animate-slide-up">
          {week.days.map((day) => (
            <div key={day.id} className="gp-day">
              <div className="gp-day-label">{day.label}</div>
              <div className="gp-day-tasks">
                {day.tasks.map((task) => {
                  const isEditingThisTask = editingItem?.id === task.id;
                  const taskPath = { ...weekPath, dayId: day.id };
                  return (
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
                        {isEditingThisTask ? (
                          <InlineEditInput
                            value={editValue}
                            onChange={setEditValue}
                            onSubmit={submitEditForReview}
                            onCancel={cancelEdit}
                            isLoading={isAnalyzingEdit}
                            inputRef={editInputRef}
                          />
                        ) : (
                          <>
                            <div className="gp-task-title-row">
                              <span className="gp-task-title">{task.title}</span>
                              <button
                                className="gp-edit-btn gp-edit-btn-task"
                                onClick={(e) => { e.stopPropagation(); onStartEdit("task", task.id, "title", task.title, taskPath); }}
                                title={t.goalPlan.editTask}
                              >
                                <Pencil size={10} />
                              </button>
                            </div>
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
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
