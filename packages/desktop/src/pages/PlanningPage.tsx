/* ──────────────────────────────────────────────────────────
   NorthStar — Planning page
   Goal entry, goal overview, everyday tasks, repeating events,
   and monthly context configuration.

   Phase 6a: reads goals + monthlyContexts from `view:planning`.
   Goal mutations route through command:create-goal /
   command:update-goal / command:delete-goal. Monthly context
   mutations route through command:save-monthly-context /
   command:delete-monthly-context.
   ────────────────────────────────────────────────────────── */

import { useState, useCallback } from "react";
import {
  Loader2,
  RefreshCw,
  Plus,
  X,
  Calendar,
  Trash2,
  AlertTriangle,
  Sparkles,
} from "lucide-react";
import useStore from "../store/useStore";
import { useT, getDateLocale } from "../i18n";
import { classifyGoal, generateGoalPlan } from "../services/ai";
import { recordSignal } from "../services/memory";
import { entitiesRepo } from "../repositories";
import { useQuery } from "../hooks/useQuery";
import { useCommand } from "../hooks/useCommand";
import AgentProgress from "../components/AgentProgress";
import MonthlyContext from "../components/MonthlyContext";
import { IconPicker } from "../components/RichTextToolbar";
import type {
  GoalImportance,
  GoalType,
  Goal,
  GoalPlanMessage,
  MonthlyContext as MonthlyContextType,
} from "@northstar/core";
import "./PlanningPage.css";

// MUST match packages/server/src/views/planningView.ts
interface PlanProgress {
  completed: number;
  total: number;
  percent: number;
}
interface PlanningView {
  goals: Goal[];
  monthlyContexts: MonthlyContextType[];
  currentMonthContext: MonthlyContextType | null;
  goalsNeedingPlanReview: Goal[];
  bigGoals: Goal[];
  everydayGoals: Goal[];
  repeatingGoals: Goal[];
  bigGoalProgressById: Record<string, PlanProgress>;
}

export default function PlanningPage() {
  // Ephemeral UI concerns only — language for date formatting + nav.
  const lang = useStore((s) => s.language);
  const setView = useStore((s) => s.setView);

  const { data, loading, error, refetch } =
    useQuery<PlanningView>("view:planning");
  const { run, running } = useCommand();

  const t = useT();

  // Goal entry state
  const [goalTitle, setGoalTitle] = useState("");
  const [goalDate, setGoalDate] = useState("");
  const [goalDescription, setGoalDescription] = useState("");
  const [goalIsHabit, setGoalIsHabit] = useState(false);
  const [goalImportance, setGoalImportance] = useState<GoalImportance>("medium");
  const [isClassifying, setIsClassifying] = useState(false);
  const [showGoalForm, setShowGoalForm] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Agent progress state
  const [showAgentProgress, setShowAgentProgress] = useState(false);

  // Delete/icon state
  const [confirmDeleteGoalId, setConfirmDeleteGoalId] = useState<string | null>(null);
  const [iconPickerGoalId, setIconPickerGoalId] = useState<string | null>(null);

  const goals = data?.goals ?? [];
  const currentMonthContext = data?.currentMonthContext ?? null;

  const handleDeleteGoal = useCallback(
    async (goalId: string) => {
      await run("command:delete-goal", { goalId });
      setConfirmDeleteGoalId(null);
    },
    [run],
  );

  const handleUpdateGoal = useCallback(
    async (goalId: string, patch: Partial<Goal>) => {
      const existing = goals.find((g) => g.id === goalId);
      if (!existing) return;
      await run("command:update-goal", { goal: { ...existing, ...patch } });
    },
    [goals, run],
  );

  // ── Handle goal submission ──
  const handleGoalSubmit = useCallback(async () => {
    if (!goalTitle.trim()) return;
    setIsClassifying(true);
    setShowAgentProgress(true);
    setSubmitError(null);

    try {
      const classification = await classifyGoal(
        goalTitle.trim(),
        goalIsHabit ? "" : goalDate,
        goalImportance,
        goalIsHabit,
        goalDescription.trim()
      );

      const goalType: GoalType = classification.goalType || (classification.scope === "big" ? "big" : "everyday");
      recordSignal("goal_classified", goalType, `${goalTitle.trim()} → ${goalType}`).catch(() => {});

      // Backend owns ID assignment, timestamps, default status,
      // planConfirmed, and the everyday-goal flatPlan construction.
      const newGoal = (await entitiesRepo.newGoal({
        title: goalTitle.trim(),
        description: goalDescription.trim(),
        targetDate: goalIsHabit ? "" : goalDate || "",
        isHabit: goalIsHabit,
        importance: goalImportance,
        scope: classification.scope,
        goalType,
        scopeReasoning: classification.reasoning,
        suggestedTasks: classification.suggestedTasks || [],
        repeatSchedule: classification.repeatSchedule || null,
        suggestedTimeSlot: classification.suggestedTimeSlot || undefined,
      })) as Goal;

      await run("command:create-goal", { goal: newGoal });

      if (goalType === "big") {
        try {
          const planResult = await generateGoalPlan(
            goalTitle.trim(),
            goalIsHabit ? "" : goalDate,
            goalImportance,
            goalIsHabit,
            goalDescription.trim()
          );
          const aiMsg = (await entitiesRepo.newChatMessage({
            role: "assistant",
            content: planResult.reply,
          })) as GoalPlanMessage;
          const nextPlanChat = [...(newGoal.planChat || []), aiMsg];
          await run("command:update-goal", {
            goal: {
              ...newGoal,
              plan: planResult.plan ?? newGoal.plan ?? null,
              planChat: nextPlanChat,
            },
          });
        } catch {
          // Plan generation failed — user can still chat from GoalPlanPage.
        }
        setView(`goal-plan-${newGoal.id}` as never);
      }

      setGoalTitle("");
      setGoalDate("");
      setGoalDescription("");
      setGoalIsHabit(false);
      setGoalImportance("medium");
      setShowGoalForm(false);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to classify goal");
    } finally {
      setIsClassifying(false);
      setShowAgentProgress(false);
    }
  }, [goalTitle, goalDate, goalDescription, goalIsHabit, goalImportance, run, setView]);

  const handleSaveMonthlyContext = useCallback(
    async (ctx: MonthlyContextType) => {
      await run("command:save-monthly-context", { context: ctx });
    },
    [run],
  );

  const handleDeleteMonthlyContext = useCallback(
    async (month: string) => {
      await run("command:delete-monthly-context", { month });
    },
    [run],
  );

  if (loading && !data) {
    return (
      <div className="planning-page">
        <div className="planning-scroll">
          <Loader2 size={18} className="spin" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="planning-page">
        <div className="planning-scroll">
          <div className="error-card">
            <div className="error-card-content">
              <AlertTriangle size={16} />
              <p>{error.message}</p>
            </div>
            <div className="error-card-actions">
              <button className="btn btn-ghost btn-sm" onClick={refetch}>
                <RefreshCw size={13} /> Retry
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const bigGoals = data.bigGoals;
  const everydayGoals = data.everydayGoals;
  const repeatingGoals = data.repeatingGoals;
  const bigGoalProgressById = data.bigGoalProgressById;

  return (
    <div className="planning-page">
      <div className="planning-scroll">
        <header className="planning-header animate-fade-in">
          <h2>Planning</h2>
          <p className="planning-subtitle">Set goals, manage your monthly context, and organize your life.</p>
        </header>

        {submitError && (
          <div className="error-card animate-fade-in">
            <div className="error-card-content">
              <AlertTriangle size={16} />
              <p>{submitError}</p>
            </div>
            <div className="error-card-actions">
              <button className="btn btn-ghost btn-sm" onClick={() => setSubmitError(null)}>
                Dismiss
              </button>
            </div>
          </div>
        )}

        <AgentProgress visible={showAgentProgress || isClassifying} />

        {/* ── Monthly Context ── */}
        <MonthlyContext
          context={currentMonthContext}
          onSave={handleSaveMonthlyContext}
          onDelete={handleDeleteMonthlyContext}
        />

        {/* ── Goal Entry Section ── */}
        <section className="goal-entry-section animate-slide-up">
          {!showGoalForm ? (
            <button
              className="goal-entry-trigger"
              onClick={() => setShowGoalForm(true)}
            >
              <Plus size={18} />
              <span>{t.dashboard.addGoal}</span>
            </button>
          ) : (
            <div className="goal-entry-form card">
              <div className="goal-entry-main-row">
                <input
                  className="input goal-entry-input"
                  type="text"
                  placeholder={t.dashboard.goalPlaceholder}
                  value={goalTitle}
                  onChange={(e) => setGoalTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && goalTitle.trim()) {
                      e.preventDefault();
                      handleGoalSubmit();
                    }
                  }}
                  autoFocus
                />
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleGoalSubmit}
                  disabled={isClassifying || !goalTitle.trim() || running}
                >
                  {isClassifying ? (
                    <Loader2 size={14} className="spin" />
                  ) : (
                    <Sparkles size={14} />
                  )}
                </button>
              </div>

              <div className="goal-entry-bottom-row">
                <button
                  className="goal-entry-more-btn"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                >
                  {showAdvanced ? "Less options" : "More options"}
                </button>
                <button
                  className="goal-entry-cancel-btn"
                  onClick={() => {
                    setShowGoalForm(false);
                    setShowAdvanced(false);
                    setGoalTitle("");
                    setGoalDate("");
                    setGoalDescription("");
                    setGoalIsHabit(false);
                    setGoalImportance("medium");
                  }}
                >
                  <X size={14} />
                </button>
              </div>

              {showAdvanced && (
                <div className="goal-entry-advanced">
                  <textarea
                    className="input goal-entry-textarea"
                    placeholder={t.dashboard.descriptionPlaceholder}
                    value={goalDescription}
                    onChange={(e) => setGoalDescription(e.target.value)}
                    rows={2}
                  />

                  <div className="goal-entry-row">
                    <div className="goal-entry-field">
                      <div className="timeline-selector">
                        <button
                          className={`timeline-toggle ${!goalIsHabit ? "active" : ""}`}
                          onClick={() => setGoalIsHabit(false)}
                        >
                          <Calendar size={13} /> {t.dashboard.targetDate}
                        </button>
                        <button
                          className={`timeline-toggle ${goalIsHabit ? "active" : ""}`}
                          onClick={() => { setGoalIsHabit(true); setGoalDate(""); }}
                        >
                          <RefreshCw size={13} /> {t.dashboard.habitLabel}
                        </button>
                      </div>
                      {!goalIsHabit && (
                        <input
                          type="date"
                          className="input goal-date-input"
                          value={goalDate}
                          onChange={(e) => setGoalDate(e.target.value)}
                        />
                      )}
                    </div>

                    <div className="goal-entry-field">
                      <div className="importance-selector">
                        {(["low", "medium", "high", "critical"] as GoalImportance[]).map((level) => (
                          <button
                            key={level}
                            className={`importance-btn ${goalImportance === level ? "active" : ""} importance-${level}`}
                            onClick={() => setGoalImportance(level)}
                          >
                            {level}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* ── Big Goals ── */}
        {bigGoals.length > 0 && (
          <section className="goals-overview animate-slide-up">
            <h3>{t.goalTypes?.bigGoals || "Big Goals"}</h3>
            <div className="goals-grid">
              {bigGoals.map((goal) => {
                const progress = bigGoalProgressById[goal.id] ?? { completed: 0, total: 0, percent: 0 };
                const gCompleted = progress.completed;
                const gTotal = progress.total;
                const gPercent = progress.percent;
                const isConfirmingDelete = confirmDeleteGoalId === goal.id;
                return (
                  <div
                    key={goal.id}
                    className="goal-card card goal-card-big"
                    onClick={() => !isConfirmingDelete && setView(`goal-plan-${goal.id}` as never)}
                  >
                    {isConfirmingDelete && (
                      <div className="goal-card-confirm-overlay" onClick={(e) => e.stopPropagation()}>
                        <p>{t.common.delete} "{goal.title}"?</p>
                        <div className="goal-card-confirm-actions">
                          <button className="btn btn-sm btn-danger" onClick={() => handleDeleteGoal(goal.id)}>
                            <Trash2 size={13} /> {t.common.delete}
                          </button>
                          <button className="btn btn-sm btn-ghost" onClick={() => setConfirmDeleteGoalId(null)}>
                            {t.common.cancel}
                          </button>
                        </div>
                      </div>
                    )}
                    <div className="goal-card-top">
                      <button
                        className={`goal-icon-btn ${goal.icon ? "has-icon" : ""}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setIconPickerGoalId(iconPickerGoalId === goal.id ? null : goal.id);
                        }}
                        title="Choose icon"
                      >
                        {goal.icon || "+"}
                      </button>
                      {iconPickerGoalId === goal.id && (
                        <IconPicker
                          currentIcon={goal.icon}
                          onSelect={(icon) => handleUpdateGoal(goal.id, { icon })}
                          onClose={() => setIconPickerGoalId(null)}
                        />
                      )}
                      <h4>{goal.title}</h4>
                      <button
                        className="goal-card-close-btn"
                        onClick={(e) => { e.stopPropagation(); setConfirmDeleteGoalId(goal.id); }}
                        title={t.common.delete}
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <div className="goal-card-progress">
                      <div className="goal-card-progress-bar">
                        <div
                          className={`goal-card-progress-fill ${gPercent >= 100 ? "complete" : gPercent >= 50 ? "halfway" : ""}`}
                          style={{ width: `${gPercent}%` }}
                        />
                      </div>
                      <span className="goal-card-progress-text">{gPercent}%</span>
                    </div>
                    {goal.isHabit ? (
                      <span className="goal-card-meta"><RefreshCw size={11} /> {t.common.habit}</span>
                    ) : goal.targetDate ? (
                      <span className="goal-card-meta">
                        {new Date(goal.targetDate).toLocaleDateString(getDateLocale(lang), {
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Everyday Tasks ── */}
        {everydayGoals.length > 0 && (
          <section className="goals-overview everyday-section animate-slide-up">
            <h3>{t.goalTypes?.everydayTasks || "Everyday Tasks"}</h3>
            <div className="everyday-list">
              {everydayGoals.map((goal) => {
                const flatTasks = goal.flatPlan?.flatMap((s) => s.tasks) || [];
                const allDone = flatTasks.length > 0 && flatTasks.every((ft) => ft.completed);
                return (
                  <div key={goal.id} className={`everyday-card ${allDone ? "everyday-done" : ""}`}>
                    <div className="everyday-card-header">
                      <span className="everyday-card-title">{goal.title}</span>
                      {goal.suggestedTimeSlot && (
                        <span className="everyday-time-slot">{goal.suggestedTimeSlot}</span>
                      )}
                      <button
                        className="everyday-close-btn"
                        onClick={() => handleDeleteGoal(goal.id)}
                      >
                        <X size={13} />
                      </button>
                    </div>
                    {flatTasks.length > 0 && (
                      <div className="everyday-tasks">
                        {flatTasks.map((task) => (
                          <div key={task.id} className={`everyday-task ${task.completed ? "done" : ""}`}>
                            <span className="everyday-task-check">{task.completed ? "done" : "o"}</span>
                            <span>{task.title}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Repeating Events ── */}
        {repeatingGoals.length > 0 && (
          <section className="goals-overview repeating-section animate-slide-up">
            <h3>{t.goalTypes?.repeatingEvents || "Repeating Events"}</h3>
            <div className="repeating-list">
              {repeatingGoals.map((goal) => {
                const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
                const schedule = goal.repeatSchedule;
                return (
                  <div key={goal.id} className="repeating-card">
                    <div className="repeating-card-header">
                      <span className="repeating-card-title">{goal.title}</span>
                      <button
                        className="everyday-close-btn"
                        onClick={() => handleDeleteGoal(goal.id)}
                      >
                        <X size={13} />
                      </button>
                    </div>
                    {schedule && (
                      <div className="repeating-schedule">
                        <span className="repeating-days">
                          {schedule.daysOfWeek.map((d) => dayNames[d]).join(", ")}
                        </span>
                        {schedule.timeOfDay && <span className="repeating-time">{schedule.timeOfDay}</span>}
                        <span className="repeating-duration">{schedule.durationMinutes}m</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
