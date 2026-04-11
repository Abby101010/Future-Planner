/* ──────────────────────────────────────────────────────────
   NorthStar — Goal Plan Page (Hierarchical Timeline)
   A dedicated page for each "big" goal showing milestones,
   years → months → weeks → days hierarchy, with locked
   future sections, planning chat, and task progress.
   ────────────────────────────────────────────────────────── */

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Loader2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ArrowLeft,
  AlertTriangle,
  FileText,
  RefreshCw,
} from "lucide-react";
import useStore from "../store/useStore";
import { useT } from "../i18n";
import { sendGoalPlanMessage, generateGoalPlan, reallocateGoalPlan } from "../services/ai";
import {
  getPlanJobId as readStoredJobId,
  clearPlanJobId as clearStoredJobId,
  hasPlanJobId,
} from "../services/jobPersistence";
import AgentProgress from "../components/AgentProgress";
import GoalPlanMilestoneTimeline from "../components/GoalPlanMilestoneTimeline";
import GoalPlanHeader from "../components/GoalPlanHeader";
import GoalPlanHierarchy from "../components/GoalPlanHierarchy";
import GoalPlanChat from "../components/GoalPlanChat";
import type { GoalPlanMessage } from "../types";
import {
  countPlanTasks,
  computeMilestoneProgress,
  syncMilestoneCompletion,
  toggleTaskInPlan,
  unlockNextWeek,
  mergePlanPreservingProgress,
  applyPlanPatch,
} from "../lib/goalPlanHelpers";
import "./GoalPlanPage.css";

interface GoalPlanPageProps {
  goalId: string;
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
  const gpChatInputRef = useRef<HTMLTextAreaElement>(null);

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

  // Count *truly overdue* tasks: incomplete tasks in unlocked weeks that
  // are strictly behind the user's current week relative to goal.createdAt.
  // Day labels are free-text ("Monday" / "Jan 6"), so we use week-index math
  // off createdAt instead of trying to parse them.
  const overdueTasks = (() => {
    if (!goal?.plan || !goal?.createdAt) return 0;
    const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;
    const elapsedWeeks = Math.floor(
      (Date.now() - new Date(goal.createdAt).getTime()) / MS_PER_WEEK
    );
    // currentWeekIndex = how many full weeks have passed since plan creation;
    // any unlocked week with index < currentWeekIndex is "in the past".
    if (elapsedWeeks < 1) return 0;

    let weekIndex = 0;
    let count = 0;
    for (const yr of goal.plan.years) {
      for (const mo of yr.months) {
        for (const wk of mo.weeks) {
          if (wk.locked) {
            weekIndex += 1;
            continue;
          }
          if (weekIndex < elapsedWeeks) {
            for (const dy of wk.days) {
              for (const task of dy.tasks) {
                if (!task.completed) count++;
              }
            }
          }
          weekIndex += 1;
        }
      }
    }
    return count;
  })();

  const showRescheduleBanner =
    overdueTasks > 5 &&
    !rescheduleDismissed &&
    !goal?.rescheduleBannerDismissed &&
    !isRescheduling &&
    goal?.planConfirmed;

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
        const merged = mergePlanPreservingProgress(goal.plan, updatedPlan);
        updateGoal(goal.id, { plan: merged });
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

    // Slice 6: the local job queue is gone, so there is nothing to "reattach"
    // to on remount. Clean up any stale jobId left over from a previous build
    // and proceed to fresh generation if needed.
    clearStoredJobId(goal.id);

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
      // Slice 6: cloud-only — single round-trip, no job/poll loop.
      const result = await generateGoalPlan(
        goal.title,
        goal.targetDate,
        goal.importance,
        goal.isHabit,
        goal.description,
      );

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
    if (gpChatInputRef.current) gpChatInputRef.current.style.height = "auto";
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
        const merged = mergePlanPreservingProgress(goal.plan, result.plan);
        setGoalPlan(goal.id, merged);
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
    // User-facing confirmation: drop a message into the plan chat so they
    // see exactly what just happened and what to expect next.
    addGoalPlanMessage(goal.id, {
      id: crypto.randomUUID(),
      role: "assistant",
      content:
        "Plan locked in. Tasks from your unlocked weeks will start showing up on your Tasks page automatically — check there tomorrow morning. As you complete tasks, future weeks will unlock progressively. You can keep refining the plan in this chat anytime.",
      timestamp: new Date().toISOString(),
    });
  }, [goal, confirmGoalPlan, addGoalPlanMessage]);

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
        <GoalPlanHeader
          goal={goal}
          showIconPicker={showIconPicker}
          onToggleIconPicker={() => setShowIconPicker(!showIconPicker)}
          onSelectIcon={(icon) => updateGoal(goal.id, { icon })}
          onCloseIconPicker={() => setShowIconPicker(false)}
          totalTasks={totalTasks}
          completedTasks={completedTasks}
          progressPercent={progressPercent}
          lang={lang}
          t={t}
          onBack={() => setView("planning")}
        />

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
        {goal.plan && goal.plan.milestones.length > 0 && (
          <GoalPlanMilestoneTimeline
            milestones={computeMilestoneProgress(goal.plan)}
            t={t}
          />
        )}

        {goal.plan && (
          <GoalPlanHierarchy
            plan={goal.plan}
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

        <GoalPlanChat
          planChat={planChat}
          isLoading={isLoading}
          chatInput={chatInput}
          onChatInputChange={setChatInput}
          onSend={handleSendMessage}
          inputRef={gpChatInputRef}
          endRef={chatEndRef}
          onInsertText={handleInsertTextToGpChat}
          lang={lang}
          t={t}
        />

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
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setRescheduleDismissed(true);
                  if (goal) updateGoal(goal.id, { rescheduleBannerDismissed: true });
                }}
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
