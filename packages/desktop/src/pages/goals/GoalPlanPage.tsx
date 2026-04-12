/* ──────────────────────────────────────────────────────────
   NorthStar — Goal Plan Page (Phase 6b rewrite)
   Hierarchical timeline for a single "big" goal. Reads
   `view:goal-plan` via useQuery; mutations via useCommand.
   Plan-chat streaming wired through useAiStream.
   ────────────────────────────────────────────────────────── */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Loader2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ArrowLeft,
  AlertTriangle,
  FileText,
  RefreshCw,
  MessageCircle,
  Sparkles,
  Edit3,
  X,
} from "lucide-react";
import useStore from "../../store/useStore";
import { useT } from "../../i18n";
import { useQuery } from "../../hooks/useQuery";
import { useCommand } from "../../hooks/useCommand";
import GoalPlanMilestoneTimeline from "./GoalPlanMilestoneTimeline";
import GoalPlanHeader from "./GoalPlanHeader";
import GoalPlanHierarchy from "./GoalPlanHierarchy";
import type {
  Goal,
  GoalPlan,
  GoalPlanMessage,
  CalendarEvent,
} from "@northstar/core";
import { computeMilestoneProgress } from "../../lib/goalPlanHelpers";
import "./GoalPlanPage.css";

// MUST match packages/server/src/views/goalPlanView.ts
interface GoalPlanProgress {
  total: number;
  completed: number;
  percent: number;
}

interface GoalPlanViewModel {
  goal: Goal | null;
  plan: GoalPlan | null;
  planChat: GoalPlanMessage[];
  progress: GoalPlanProgress;
  overdueTaskCount: number;
  needsRescheduling: boolean;
  calendarEvents: CalendarEvent[];
  paceMismatch: import("@northstar/core").PaceMismatch | null;
}

interface GoalPlanPageProps {
  goalId: string;
}

// MUST match packages/server/src/views/onboardingView.ts — we only need
// the user.settings.language slice for date/number locales.
interface OnboardingSlimView {
  user: { settings?: { language?: "en" | "zh" } } | null;
}

export default function GoalPlanPage({ goalId }: GoalPlanPageProps) {
  const setView = useStore((s) => s.setView);
  const t = useT();

  const { data, loading, error, refetch } = useQuery<GoalPlanViewModel>(
    "view:goal-plan",
    { goalId },
  );
  const { data: onboardingData } = useQuery<OnboardingSlimView>(
    "view:onboarding",
  );
  const lang = onboardingData?.user?.settings?.language || "en";
  const { run: runCommand, running: commandRunning, error: commandError } =
    useCommand();

  const goal = data?.goal ?? null;
  const plan = data?.plan ?? null;
  const planChat = data?.planChat ?? [];
  const progress = data?.progress ?? { total: 0, completed: 0, percent: 0 };
  const overdueTasks = data?.overdueTaskCount ?? 0;
  const needsRescheduling = data?.needsRescheduling ?? false;
  const paceMismatch = data?.paceMismatch ?? null;

  // ── Ephemeral UI state ──
  const [isRescheduling, setIsRescheduling] = useState(false);
  const [rescheduleDismissed, setRescheduleDismissed] = useState(false);
  const [expandedYears, setExpandedYears] = useState<Set<string>>(new Set());
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());
  const [expandedWeeks, setExpandedWeeks] = useState<Set<string>>(new Set());
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [notesValue, setNotesValue] = useState("");
  const [notesSaved, setNotesSaved] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const toggleChat = useStore((s) => s.toggleChat);

  // Ref-gated expansion: set to true on mount, goal change, or reschedule.
  // When plan data arrives and the flag is true, expand unlocked weeks and
  // clear the flag. This prevents re-collapsing on unrelated plan changes
  // (e.g. task toggles) while ensuring new plan IDs after reschedule expand.
  const shouldExpandRef = useRef(true);

  // Sync local notes field with fetched goal.notes (one-way: server → input
  // when the server value changes OR when the user hasn't typed anything
  // for this goal yet).
  useEffect(() => {
    setNotesValue(goal?.notes || "");
  }, [goal?.notes, goalId]);

  useEffect(() => {
    shouldExpandRef.current = true;
  }, [goalId]);

  useEffect(() => {
    if (plan && Array.isArray(plan.years) && shouldExpandRef.current) {
      const unlockedWeekIds = new Set<string>();
      const yearIds = new Set<string>();
      const monthIds = new Set<string>();
      for (const yr of plan.years) {
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
      shouldExpandRef.current = false;
    }
  }, [plan]);


  // Kick off initial plan generation the first time a pending goal
  // renders with no plan or chat history.
  const [initialTriggered, setInitialTriggered] = useState(false);
  useEffect(() => {
    if (!goal || initialTriggered) return;
    if (!plan && planChat.length === 0 && goal.status === "pending") {
      setInitialTriggered(true);
      void handleGenerateInitialPlan();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goal, plan, planChat.length, initialTriggered]);

  const showRescheduleBanner =
    !rescheduleDismissed &&
    !isRescheduling &&
    goal?.planConfirmed &&
    (
      (overdueTasks > 5 && needsRescheduling) ||
      (paceMismatch && paceMismatch.severity !== "mild")
    );

  const [rescheduleResult, setRescheduleResult] = useState<{
    overdueTasks: number;
    actualPace: number;
    summary: string | null;
  } | null>(null);

  const handleReschedule = useCallback(async () => {
    if (!goal || !plan) return;
    setIsRescheduling(true);
    setLocalError(null);
    setRescheduleResult(null);
    try {
      const result = await runCommand<{
        ok: boolean;
        planUpdated: boolean;
        overdueTasks: number;
        actualPace: number;
        summary: unknown;
      }>("command:adaptive-reschedule", { goalId: goal.id });
      if (result?.planUpdated === false) {
        setLocalError("Reschedule ran but couldn't produce an updated plan. Try again.");
        return;
      }
      setRescheduleResult({
        overdueTasks: result?.overdueTasks ?? 0,
        actualPace: result?.actualPace ?? 0,
        summary: typeof result?.summary === "string" ? result.summary : null,
      });
      setRescheduleDismissed(true);
      shouldExpandRef.current = true;
      refetch();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Failed to reschedule");
    } finally {
      setIsRescheduling(false);
    }
  }, [goal, plan, runCommand, refetch]);

  const handleGenerateInitialPlan = useCallback(async () => {
    if (!goal) return;
    setLocalError(null);
    try {
      await runCommand("command:regenerate-goal-plan", {
        payload: {
          goalId: goal.id,
          goalTitle: goal.title,
          targetDate: goal.targetDate,
          importance: goal.importance,
          isHabit: goal.isHabit,
          description: goal.description,
        },
      });
      refetch();
    } catch (err) {
      setLocalError(
        err instanceof Error ? err.message : "Failed to generate plan",
      );
    }
  }, [goal, runCommand, refetch]);


  const handleConfirmPlan = useCallback(async () => {
    if (!goal) return;
    setLocalError(null);
    try {
      await runCommand("command:confirm-goal-plan", { goalId: goal.id });
      refetch();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Failed to confirm plan");
    }
  }, [goal, runCommand, refetch]);

  const handleToggleTask = useCallback(
    async (weekId: string, dayId: string, taskId: string) => {
      if (!goal) return;
      void weekId;
      void dayId;
      setLocalError(null);
      try {
        await runCommand("command:toggle-task", { taskId });
        refetch();
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : "Failed to toggle task");
      }
    },
    [goal, runCommand, refetch],
  );

  const handleUnlockNext = useCallback(async () => {
    if (!goal || !plan) return;
    // Walk the plan, flip the first locked week, and persist via update-goal.
    let unlocked = false;
    const next: GoalPlan = {
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
    setLocalError(null);
    try {
      await runCommand("command:update-goal", {
        goal: { ...goal, plan: next },
      });
      refetch();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Failed to unlock week");
    }
  }, [goal, plan, runCommand, refetch]);

  const toggleSet = (
    set: Set<string>,
    id: string,
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
  ) => {
    void set;
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSaveNotes = useCallback(async () => {
    if (!goal) return;
    if (notesValue === (goal.notes || "")) return;
    try {
      await runCommand("command:update-goal", {
        goal: { ...goal, notes: notesValue },
      });
      setNotesSaved(true);
      setTimeout(() => setNotesSaved(false), 2000);
      refetch();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Failed to save notes");
    }
  }, [goal, notesValue, runCommand, refetch]);

  const handleDismissReschedule = useCallback(async () => {
    setRescheduleDismissed(true);
    if (!goal) return;
    try {
      await runCommand("command:update-goal", {
        goal: { ...goal, rescheduleBannerDismissed: true },
      });
      refetch();
    } catch {
      /* non-fatal: local dismiss stands */
    }
  }, [goal, runCommand, refetch]);

  const handleSelectIcon = useCallback(
    async (icon: string) => {
      if (!goal) return;
      try {
        await runCommand("command:update-goal", { goal: { ...goal, icon } });
        refetch();
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : "Failed to update icon");
      }
    },
    [goal, runCommand, refetch],
  );

  // ── Loading / error / not-found states ──

  if (loading && !data) {
    return (
      <div className="goal-plan-page">
        <div className="goal-plan-scroll">
          <div className="goal-plan-empty">
            <Loader2 size={24} className="spin" />
            <p>Loading...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="goal-plan-page">
        <div className="goal-plan-scroll">
          <div className="goal-plan-empty">
            <AlertTriangle size={24} />
            <p>{error.message}</p>
            <button className="btn btn-primary" onClick={() => setView("tasks")}>
              <ArrowLeft size={16} />
              {t.goalPlan.backToHome}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!goal) {
    return (
      <div className="goal-plan-page">
        <div className="goal-plan-scroll">
          <div className="goal-plan-empty">
            <p>{t.goalPlan.notFound}</p>
            <button className="btn btn-primary" onClick={() => setView("tasks")}>
              <ArrowLeft size={16} />
              {t.goalPlan.backToHome}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const totalTasks = progress.total;
  const completedTasks = progress.completed;
  const progressPercent = progress.percent;

  const hasLockedWeeks =
    plan &&
    Array.isArray(plan.years) &&
    plan.years.some((yr) =>
      yr.months.some((mo) => mo.weeks.some((wk) => wk.locked)),
    );


  const isGenerating = commandRunning;
  const errorMessage = localError ?? commandError?.message ?? null;

  return (
    <div className="goal-plan-page">
      <div className="goal-plan-scroll">
        <GoalPlanHeader
          goal={goal}
          showIconPicker={showIconPicker}
          onToggleIconPicker={() => setShowIconPicker(!showIconPicker)}
          onSelectIcon={handleSelectIcon}
          onCloseIconPicker={() => setShowIconPicker(false)}
          totalTasks={totalTasks}
          completedTasks={completedTasks}
          progressPercent={progressPercent}
          lang={lang}
          t={t}
          onBack={() => setView("planning")}
        />

        {errorMessage && (
          <div className="gp-error animate-fade-in">
            <AlertTriangle size={16} />
            <p>{errorMessage}</p>
          </div>
        )}

        {/* Plan generation spinner — shown while the regenerate command
            is running and we don't have a plan yet. */}
        {isGenerating && !plan && (
          <div className="gp-generating animate-fade-in">
            <Loader2 size={32} className="spin" />
            <h3>{t.goalPlan.creatingPlan}</h3>
            <p>{t.goalPlan.creatingPlanDesc}</p>
          </div>
        )}

        {/* ── Milestone Timeline ── */}
        {plan && plan.milestones.length > 0 && (
          <GoalPlanMilestoneTimeline
            milestones={computeMilestoneProgress(plan)}
            t={t}
          />
        )}

        {plan && (
          <GoalPlanHierarchy
            plan={plan}
            expandedYears={expandedYears}
            expandedMonths={expandedMonths}
            expandedWeeks={expandedWeeks}
            onToggleYear={(id) => toggleSet(expandedYears, id, setExpandedYears)}
            onToggleMonth={(id) => toggleSet(expandedMonths, id, setExpandedMonths)}
            onToggleWeek={(id) => toggleSet(expandedWeeks, id, setExpandedWeeks)}
            onToggleTask={handleToggleTask}
            hasLockedWeeks={!!hasLockedWeeks}
            onUnlockNext={handleUnlockNext}
            lang={lang}
            t={t}
          />
        )}

        {/* ── Plan Chat History + Refine Button ── */}
        <div className="gp-chat gp-chat-prominent animate-slide-up">
          <div className="gp-chat-header-static">
            <MessageCircle size={16} />
            <h3>{t.goalPlan.planningChat}</h3>
            {planChat.length > 0 && (
              <span className="gp-chat-count">{planChat.length}</span>
            )}
          </div>
          {planChat.length > 0 && (
            <div className="gp-chat-messages">
              {planChat.slice(-6).map((msg) => (
                <div key={msg.id} className={`gp-chat-msg ${msg.role}`}>
                  <div className="gp-chat-msg-avatar">
                    {msg.role === "assistant" ? <Sparkles size={14} /> : <Edit3 size={14} />}
                  </div>
                  <div className="gp-chat-msg-content">
                    <p>{msg.content}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
          <button className="btn btn-primary btn-sm gp-open-chat-btn" onClick={toggleChat}>
            <MessageCircle size={14} />
            Refine plan in Chat
          </button>
        </div>

        {/* Reschedule banner — too many incomplete tasks */}
        {showRescheduleBanner && (
          <div className="gp-reschedule-banner animate-slide-up">
            <div className="gp-reschedule-content">
              <AlertTriangle size={16} />
              <div>
                {paceMismatch ? (
                  <>
                    <strong>Falling behind pace</strong>
                    <p>
                      You're averaging ~{paceMismatch.actualTasksPerDay} tasks/day
                      but this plan needs ~{paceMismatch.requiredTasksPerDay}.
                      {paceMismatch.estimatedDelayDays > 0 &&
                        ` Estimated ${paceMismatch.estimatedDelayDays} days late.`}
                    </p>
                  </>
                ) : (
                  <>
                    <strong>You have {overdueTasks} incomplete tasks.</strong>
                    <p>Want me to adjust the timeline to be more realistic?</p>
                  </>
                )}
              </div>
            </div>
            <div className="gp-reschedule-actions">
              <button className="btn btn-primary btn-sm" onClick={handleReschedule}>
                <RefreshCw size={13} />
                Adjust Plan
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={handleDismissReschedule}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {isRescheduling && (
          <div className="gp-generating animate-fade-in">
            <Loader2 size={32} className="spin" />
            <h3>Adjusting your timeline...</h3>
            <p>Redistributing tasks based on your progress and schedule. This may take a minute.</p>
          </div>
        )}

        {rescheduleResult && !isRescheduling && (
          <div className="gp-reschedule-result animate-fade-in">
            <CheckCircle2 size={16} />
            <div>
              <strong>Plan adjusted</strong>
              <p>
                Redistributed {rescheduleResult.overdueTasks} overdue task{rescheduleResult.overdueTasks === 1 ? "" : "s"} at
                your pace of ~{rescheduleResult.actualPace} tasks/day.
              </p>
              {rescheduleResult.summary && (
                <p className="gp-reschedule-summary">{String(rescheduleResult.summary)}</p>
              )}
            </div>
            <button
              className="btn btn-ghost btn-xs"
              onClick={() => setRescheduleResult(null)}
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Confirm plan button */}
        {plan && !goal.planConfirmed && (
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
                onBlur={handleSaveNotes}
                rows={6}
              />
              {notesSaved && <span className="gp-notes-saved">Saved</span>}
            </div>
          )}
        </div>

        {/* Empty / retry state — plan failed, timed out, or interrupted. */}
        {!isGenerating && !plan && (
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
