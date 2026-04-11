/* ──────────────────────────────────────────────────────────
   NorthStar — Goal Plan Page (Phase 6b rewrite)
   Hierarchical timeline for a single "big" goal. Reads
   `view:goal-plan` via useQuery; mutations via useCommand.
   Plan-chat streaming wired through useAiStream.
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
import { useQuery } from "../hooks/useQuery";
import { useCommand } from "../hooks/useCommand";
import { postSseStream } from "../services/transport";
import GoalPlanMilestoneTimeline from "../components/GoalPlanMilestoneTimeline";
import GoalPlanHeader from "../components/GoalPlanHeader";
import GoalPlanHierarchy from "../components/GoalPlanHierarchy";
import GoalPlanChat from "../components/GoalPlanChat";
import type {
  Goal,
  GoalPlan,
  GoalPlanMessage,
  CalendarEvent,
} from "@northstar/core";
import { computeMilestoneProgress } from "../lib/goalPlanHelpers";
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

  // ── Ephemeral UI state ──
  const [chatInput, setChatInput] = useState("");
  const [streamedText, setStreamedText] = useState("");
  const [streamRunning, setStreamRunning] = useState(false);

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

  const gpChatInputRef = useRef<HTMLTextAreaElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const handleInsertTextToGpChat = useCallback((text: string) => {
    setChatInput((prev) => prev + text);
    gpChatInputRef.current?.focus();
  }, []);

  // Sync local notes field with fetched goal.notes (one-way: server → input
  // when the server value changes OR when the user hasn't typed anything
  // for this goal yet).
  useEffect(() => {
    setNotesValue(goal?.notes || "");
  }, [goal?.notes, goalId]);

  // Auto-scroll the chat panel whenever new messages arrive (persisted
  // history or streaming tokens).
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [planChat, streamedText]);

  // Auto-expand unlocked weeks on first render of a given goal.
  useEffect(() => {
    if (plan && Array.isArray(plan.years)) {
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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goalId]);


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
    overdueTasks > 5 &&
    !rescheduleDismissed &&
    needsRescheduling &&
    !isRescheduling &&
    goal?.planConfirmed;

  const handleReschedule = useCallback(async () => {
    if (!goal || !plan) return;
    setIsRescheduling(true);
    setLocalError(null);
    try {
      await runCommand("command:reallocate-goal-plan", {
        payload: {
          goalId: goal.id,
          breakdown: plan,
          reason: `User has ${overdueTasks} incomplete tasks and is falling behind schedule. Redistribute remaining tasks to realistic future dates.`,
          inAppEvents: data?.calendarEvents ?? [],
        },
      });
      refetch();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Failed to reschedule");
    } finally {
      setIsRescheduling(false);
    }
  }, [goal, plan, overdueTasks, data?.calendarEvents, runCommand, refetch]);

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

  const handleSendMessage = useCallback(async () => {
    if (!goal || !chatInput.trim()) return;
    const userMsg: GoalPlanMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: chatInput.trim(),
      timestamp: new Date().toISOString(),
    };
    setChatInput("");
    if (gpChatInputRef.current) gpChatInputRef.current.style.height = "auto";
    setLocalError(null);
    setStreamedText("");
    setStreamRunning(true);

    try {
      await postSseStream("/ai/goal-plan-chat/stream", {
        goalId: goal.id,
        userMessageId: userMsg.id,
        goalTitle: goal.title,
        targetDate: goal.targetDate,
        importance: goal.importance,
        isHabit: goal.isHabit,
        description: goal.description,
        chatHistory: [...planChat, userMsg],
        userMessage: userMsg.content,
        currentPlan: plan,
      }, {
        onDelta: (text) => setStreamedText((prev) => prev + text),
        onError: (msg) => setLocalError(msg),
      });
      refetch();
    } catch (err) {
      setLocalError(
        err instanceof Error ? err.message : "Failed to send message",
      );
    } finally {
      setStreamRunning(false);
      setStreamedText("");
    }
  }, [goal, chatInput, planChat, plan, refetch]);

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
            <button className="btn btn-primary" onClick={() => setView("dashboard")}>
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
            <button className="btn btn-primary" onClick={() => setView("dashboard")}>
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

  // Chat shown in UI = persisted history plus any in-flight streaming
  // assistant message. While a stream is running we append a transient
  // GoalPlanMessage built from the accumulated tokens.
  const chatForRender: GoalPlanMessage[] = streamRunning && streamedText
    ? [
        ...planChat,
        {
          id: "stream-pending",
          role: "assistant",
          content: streamedText,
          timestamp: new Date().toISOString(),
        },
      ]
    : planChat;

  const isGenerating = commandRunning || streamRunning;
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

        <GoalPlanChat
          planChat={chatForRender}
          isLoading={isGenerating}
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
            <p>Redistributing tasks based on your progress and schedule.</p>
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
