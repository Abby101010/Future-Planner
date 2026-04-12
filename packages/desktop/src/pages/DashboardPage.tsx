/* ──────────────────────────────────────────────────────────
   NorthStar — Dashboard page (Home)

   Phase 7: read-side consumes `view:dashboard`; mutations dispatch
   via `useCommand().run`. The home-chat orchestration flow still
   calls the legacy `sendHomeChatMessage` because the existing
   `command:send-chat-message` returns a plain reply, not the
   structured `HomeChatIntent` this page needs to drive entity
   creation. Follow-up: expand command:send-chat-message to return
   the full HomeChatResult so this file can drop the services/ai.ts
   import entirely.
   ────────────────────────────────────────────────────────── */

import { useEffect, useState, useCallback, useRef } from "react";
import { CalendarDays, ArrowRight, Loader2, AlertTriangle, RefreshCw } from "lucide-react";
import useStore from "../store/useStore";
import { useT } from "../i18n";
import { analyzeQuickTask, sendHomeChatMessage, generateGoalPlan } from "../services/ai";
// TODO(phase8): wire plan-job tracking via WS
const setPlanJobId = (_goalId: string, _jobId: string): void => {};
import { chatRepo } from "../repositories";
import type {
  PendingTask,
  CalendarEvent,
  ContextualNudge,
  Goal,
  ChatSession,
  HomeChatMessage,
  MonthlyContext,
  Reminder,
  DailyTask,
  GoalPlanMessage,
} from "@northstar/core";
import ChatListPanel from "../components/ChatListPanel";
import { PendingTaskCard, PendingEventCard } from "../components/PendingCards";
import HomeChatHistory from "../components/HomeChatHistory";
import HomeInputSection, { type HomeAttachment } from "../components/HomeInputSection";
import { useQuery } from "../hooks/useQuery";
import { useCommand } from "../hooks/useCommand";
import "./DashboardPage.css";

type Attachment = HomeAttachment;

// MUST match packages/server/src/views/dashboardView.ts
interface DashboardTodaySummary {
  completedTasks: number;
  totalTasks: number;
  streak: number;
}

interface DashboardVacationMode {
  active: boolean;
  startDate: string | null;
  endDate: string | null;
}

interface DashboardDailyLoad {
  currentWeight: number;
  currentMinutes: number;
  activeTaskCount: number;
  todayEventCount: number;
}

interface DashboardView {
  todayDate: string;
  greetingName: string;
  todaySummary: DashboardTodaySummary;
  activeGoals: Goal[];
  todayTasks: DailyTask[];
  todayEvents: CalendarEvent[];
  pendingTasks: PendingTask[];
  activePendingTasks: PendingTask[];
  dailyLoad: DashboardDailyLoad;
  homeChatMessages: HomeChatMessage[];
  activeReminders: Reminder[];
  recentNudges: ContextualNudge[];
  vacationMode: DashboardVacationMode;
  currentMonthContext: MonthlyContext | null;
  needsMonthlyContext: boolean;
}

export default function DashboardPage() {
  const setView = useStore((s) => s.setView);
  const activeChatId = useStore((s) => s.activeChatId);
  const setActiveChatId = useStore((s) => s.setActiveChatId);

  const t = useT();
  const { data, loading, error, refetch } = useQuery<DashboardView>("view:dashboard");
  const { run } = useCommand();

  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [monthNudgeDismissed, setMonthNudgeDismissed] = useState(false);
  const [pendingEvent, setPendingEvent] = useState<CalendarEvent | null>(null);
  const [showChatList, setShowChatList] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  // Chat sessions list: one-shot fetch via the legacy chat repo on
  // mount, held locally so the store never has to know about it.
  // TODO(phase8): once `view:dashboard` carries the session list, drop
  // this fetch and read from data.homeChatSessions directly.
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  useEffect(() => {
    let cancelled = false;
    chatRepo
      .listSessions()
      .then((sessions) => {
        if (!cancelled) setChatSessions(sessions);
      })
      .catch(() => {
        /* sessions are optional */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Optimistic home-chat message buffer. The server owns the canonical
  // transcript (returned by view:dashboard.homeChatMessages); we append
  // optimistically so the UI feels instant, then refetch.
  const [optimisticMessages, setOptimisticMessages] = useState<HomeChatMessage[]>([]);
  const addHomeChatMessage = useCallback((msg: HomeChatMessage) => {
    setOptimisticMessages((prev) => [...prev, msg]);
  }, []);

  const startNewChat = useCallback(async () => {
    // Archive-then-clear: command:clear-home-chat snapshots the current
    // home_chat_messages into chat_sessions on the server, then wipes
    // home_chat_messages. We optimistically clear first, then refetch
    // the session list so the newly archived chat appears in the sidebar.
    setActiveChatId(null);
    setOptimisticMessages([]);
    try {
      await run("command:clear-home-chat", {});
      refetch();
      try {
        const sessions = await chatRepo.listSessions();
        setChatSessions(sessions);
      } catch {
        /* sidebar refresh is best-effort */
      }
    } catch (err) {
      console.warn("[dashboard] clear-home-chat failed", err);
    }
  }, [setActiveChatId, run, refetch]);
  const switchChat = useCallback(
    (sessionId: string) => {
      setActiveChatId(sessionId);
      const session = chatSessions.find((s) => s.id === sessionId);
      setOptimisticMessages(session?.messages ?? []);
    },
    [chatSessions, setActiveChatId],
  );
  const deleteChat = useCallback(
    (sessionId: string) => {
      setChatSessions((prev) => prev.filter((s) => s.id !== sessionId));
      chatRepo.deleteSession(sessionId).catch(() => {});
      if (activeChatId === sessionId) {
        setActiveChatId(null);
        setOptimisticMessages([]);
      }
    },
    [activeChatId, setActiveChatId],
  );

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Derived server-owned state. All defensive defaults so the first
  // render (before data arrives) is still safe.
  const goals = data?.activeGoals ?? [];
  const todayEvents = data?.todayEvents ?? [];
  const pendingTasks = data?.pendingTasks ?? [];
  const serverMessages = data?.homeChatMessages ?? [];
  // Merge server transcript with optimistic in-flight messages, de-duped
  // by id so a refetch after send transparently replaces the optimistic row.
  const homeChatMessages: HomeChatMessage[] = (() => {
    const seen = new Set(serverMessages.map((m) => m.id));
    const optimisticExtras = optimisticMessages.filter((m) => !seen.has(m.id));
    return [...serverMessages, ...optimisticExtras];
  })();
  const needsMonthlyContext = !!data?.needsMonthlyContext && !monthNudgeDismissed;
  const currentMonthLabel = new Date().toLocaleDateString(undefined, { month: "long" });

  // Used for AI-context payload and daily-load summary on pending cards.
  const todayFlatTasks: DailyTask[] = data?.todayTasks ?? [];

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newAttachments: Attachment[] = [];
    for (const file of Array.from(files)) {
      const isPdf = file.type === "application/pdf";
      const isImage = file.type.startsWith("image/");
      if (!isPdf && !isImage) continue;

      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(",")[1]); // strip data:...;base64, prefix
        };
        reader.readAsDataURL(file);
      });

      const attachment: Attachment = {
        id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        file,
        name: file.name,
        type: isPdf ? "pdf" : "image",
        base64,
        mediaType: file.type,
      };

      if (isImage) {
        attachment.previewUrl = URL.createObjectURL(file);
      }

      newAttachments.push(attachment);
    }

    setAttachments((prev) => [...prev, ...newAttachments]);
    // Reset input so the same file can be selected again
    e.target.value = "";
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const removed = prev.find((a) => a.id === id);
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [homeChatMessages, isLoading]);

  const handleSend = useCallback(async () => {
    if ((!input.trim() && attachments.length === 0) || isLoading) return;
    const query = input.trim();
    const currentAttachments = [...attachments];
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    setAttachments([]);
    setIsLoading(true);

    // Build display text for the user message
    const attachmentNames = currentAttachments.map((a) => a.name);
    const userContent = attachmentNames.length > 0
      ? `${query}${query ? "\n" : ""}Attached: ${attachmentNames.join(", ")}`
      : query;

    // Optimistically push the user message into local state so the UI
    // updates instantly. The next view refetch will replace it with the
    // server's canonical copy via the id merge above.
    const msgId = crypto.randomUUID();
    addHomeChatMessage({
      id: msgId,
      role: "user",
      content: userContent,
      timestamp: new Date().toISOString(),
    });

    const sessionId = activeChatId;
    if (sessionId && currentAttachments.length > 0) {
      for (const att of currentAttachments) {
        chatRepo.saveAttachment({
          id: att.id,
          sessionId,
          messageId: msgId,
          filename: att.name,
          mimeType: att.mediaType,
          fileType: att.type,
          base64: att.base64,
        }).catch(() => {});
        if (att.previewUrl) URL.revokeObjectURL(att.previewUrl);
      }
    }

    const attachmentData = currentAttachments.map((a) => ({
      type: a.type,
      name: a.name,
      base64: a.base64,
      mediaType: a.mediaType,
    }));

    try {
      const result = await sendHomeChatMessage(
        query || "Please analyze the attached file(s).",
        homeChatMessages.map((m) => ({ role: m.role, content: m.content })),
        goals,
        todayFlatTasks,
        todayEvents,
        attachmentData.length > 0 ? attachmentData : undefined,
        msgId,
      );

      // The backend parses the LLM reply, builds fully-populated entities
      // and returns a structured intent. This page dispatches the intent
      // via the command envelope (for persistence) and refetches the view.
      let displayText = result.reply;
      let pendingTaskToAnalyze: PendingTask | null = null;

      if (result.intent) {
        switch (result.intent.kind) {
          case "event": {
            const event = result.intent.entity;
            setPendingEvent(event);
            const dateStr = new Date(event.startDate).toLocaleDateString(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric",
            });
            const timeStr = event.isAllDay
              ? "all day"
              : new Date(event.startDate).toLocaleTimeString(undefined, {
                  hour: "numeric",
                  minute: "2-digit",
                });
            displayText = `Got it — I'll add "${event.title}" on ${dateStr} at ${timeStr} to your calendar.`;
            break;
          }
          case "goal": {
            const newGoal = result.intent.entity;
            await run("command:create-goal", { goal: newGoal });
            if (result.intent.planJobId) {
              setPlanJobId(newGoal.id, result.intent.planJobId);
            }
            displayText =
              newGoal.goalType === "big"
                ? `I've created "${newGoal.title}" and started planning it in the background. Open it in Planning to watch the AI work or see the result.`
                : `I've created "${newGoal.title}" as a ${newGoal.goalType} goal. Head to the Planning tab to build out the plan.`;
            break;
          }
          case "reminder": {
            const reminder = result.intent.entity;
            await run("command:upsert-reminder", { reminder });
            const timeStr = new Date(reminder.reminderTime).toLocaleTimeString(undefined, {
              hour: "numeric",
              minute: "2-digit",
            });
            const dateStr = new Date(reminder.date + "T12:00:00").toLocaleDateString(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric",
            });
            displayText = `I'll remind you: "${reminder.title}" on ${dateStr} at ${timeStr}.`;
            if (reminder.repeat) {
              displayText += ` This will repeat ${reminder.repeat}.`;
            }
            break;
          }
          case "task": {
            pendingTaskToAnalyze = result.intent.pendingTask;
            displayText = t.home.taskDetected;
            break;
          }
          case "manage-goal": {
            const intent = result.intent;
            const targetGoal = goals.find((g) => g.id === intent.goalId);
            if (!targetGoal) {
              displayText = `I couldn't find that goal. Could you clarify which goal you mean?`;
            } else if (intent.action === "refresh_plan") {
              displayText = `Regenerating the plan for "${targetGoal.title}"... This may take a moment.`;
              // Fire plan regeneration as an update-goal command. A full
              // background job still runs client-side for now; Phase 7
              // will move this behind command:regenerate-goal-plan.
              await run("command:update-goal", {
                goal: { ...targetGoal, plan: null, status: "planning", planChat: [] },
              });
              generateGoalPlan(
                targetGoal.title,
                targetGoal.targetDate,
                targetGoal.importance,
                targetGoal.isHabit,
                targetGoal.description,
              )
                .then(async (planResult) => {
                  if (planResult.plan) {
                    const aiMsg: GoalPlanMessage = {
                      id: crypto.randomUUID(),
                      role: "assistant",
                      content: planResult.reply,
                      timestamp: new Date().toISOString(),
                    };
                    await run("command:update-goal", {
                      goal: {
                        ...targetGoal,
                        plan: planResult.plan,
                        status: "active",
                        planChat: [...(targetGoal.planChat || []), aiMsg],
                      },
                    });
                    addHomeChatMessage({
                      id: crypto.randomUUID(),
                      role: "assistant",
                      content: `The plan for "${targetGoal.title}" has been refreshed! Check it out in the Planning tab.`,
                      timestamp: new Date().toISOString(),
                    });
                  }
                })
                .catch(() => {
                  addHomeChatMessage({
                    id: crypto.randomUUID(),
                    role: "assistant",
                    content: `I had trouble regenerating the plan for "${targetGoal.title}". You can try again later.`,
                    timestamp: new Date().toISOString(),
                  });
                });
            } else if (intent.action === "delete") {
              await run("command:delete-goal", { goalId: targetGoal.id });
              displayText = `I've removed "${targetGoal.title}" from your goals.`;
            } else if (intent.action === "archive") {
              await run("command:update-goal", {
                goal: { ...targetGoal, status: "archived" },
              });
              displayText = `I've archived "${targetGoal.title}".`;
            }
            break;
          }
          case "context-change": {
            displayText = result.intent.suggestion
              ? `I noticed a change in your situation. ${result.intent.suggestion}\n\nYou can update your monthly context in the Planning tab.`
              : "It sounds like things have changed. Update your monthly context in the Planning tab.";
            break;
          }
        }
      }

      addHomeChatMessage({
        // Reuse the server-assigned id so the optimistic entry gets
        // replaced by the canonical server row on the next refetch.
        id: result.assistantMessageId ?? crypto.randomUUID(),
        role: "assistant",
        content: displayText,
        timestamp: new Date().toISOString(),
      });

      if (pendingTaskToAnalyze) {
        try {
          const analysis = await analyzeQuickTask(
            pendingTaskToAnalyze.userInput,
            todayFlatTasks,
            goals,
            todayEvents,
          );
          pendingTaskToAnalyze = {
            ...pendingTaskToAnalyze,
            status: "ready",
            analysis: {
              title: analysis.title,
              description: analysis.description,
              suggestedDate: analysis.suggested_date,
              durationMinutes: analysis.duration_minutes,
              cognitiveWeight: analysis.cognitive_weight,
              priority: analysis.priority,
              category: analysis.category,
              reasoning: analysis.reasoning,
              conflictsWithExisting: analysis.conflicts_with_existing,
            },
          };
          // Persist the analyzed pending task so the dashboard shows
          // the confirmation card on refetch.
          await run("command:create-pending-task", {
            id: pendingTaskToAnalyze.id,
            userInput: pendingTaskToAnalyze.userInput,
            status: pendingTaskToAnalyze.status,
            analysis: pendingTaskToAnalyze.analysis,
          });
        } catch {
          pendingTaskToAnalyze = { ...pendingTaskToAnalyze, status: "rejected" };
        }
      }
      refetch();
    } catch {
      addHomeChatMessage({
        id: crypto.randomUUID(),
        role: "assistant",
        content: t.home.chatError,
        timestamp: new Date().toISOString(),
      });
    } finally {
      setIsLoading(false);
    }
  }, [
    input,
    isLoading,
    goals,
    todayFlatTasks,
    todayEvents,
    homeChatMessages,
    attachments,
    addHomeChatMessage,
    activeChatId,
    t,
    run,
    refetch,
  ]);

  // ── Loading / error states ──
  if (loading && !data) {
    return (
      <div className="dashboard">
        <div className="dashboard-home">
          <div className="home-loading">
            <Loader2 size={18} className="spin" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dashboard">
        <div className="dashboard-home">
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

  const activePending = data.activePendingTasks;
  const dailyLoad = data.dailyLoad;

  return (
    <div className="dashboard">
      {/* ── Chat history sidebar ── */}
      {showChatList && (
        <ChatListPanel
          sessions={chatSessions}
          activeChatId={activeChatId}
          onClose={() => setShowChatList(false)}
          onNewChat={() => {
            startNewChat();
            setShowChatList(false);
          }}
          onSwitchChat={(id) => {
            switchChat(id);
            setShowChatList(false);
          }}
          onDeleteChat={deleteChat}
        />
      )}

      <div className="dashboard-home">
        <HomeInputSection
          input={input}
          onInputChange={setInput}
          isLoading={isLoading}
          inputRef={inputRef}
          fileInputRef={fileInputRef}
          attachments={attachments}
          onRemoveAttachment={removeAttachment}
          onFileSelect={handleFileSelect}
          onToggleChatList={() => setShowChatList(!showChatList)}
          onSend={handleSend}
        />

        {/* ── New month nudge ── */}
        {needsMonthlyContext && (
          <div className="home-month-nudge">
            <CalendarDays size={16} />
            <span>It's {currentMonthLabel} — how does this month look for you?</span>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => setView("planning")}
            >
              Set it up <ArrowRight size={12} />
            </button>
            <button
              className="home-month-nudge-dismiss"
              onClick={() => setMonthNudgeDismissed(true)}
              title="Dismiss"
            >
              &times;
            </button>
          </div>
        )}

        {/* ── Chat History ── */}
        <HomeChatHistory
          ref={chatEndRef}
          messages={homeChatMessages}
          isLoading={isLoading}
        />

        {/* ── Pending Event ── */}
        {pendingEvent && (
          <PendingEventCard
            event={pendingEvent}
            dailyLoad={dailyLoad}
            onConfirm={async () => {
              await run("command:upsert-calendar-event", { event: pendingEvent });
              setPendingEvent(null);
              refetch();
            }}
            onReject={() => setPendingEvent(null)}
            onUpdate={(updates) => setPendingEvent({ ...pendingEvent, ...updates })}
          />
        )}

        {/* ── Pending Tasks ── */}
        {activePending.length > 0 && (
          <div className="home-pending-section">
            {activePending.map((pt) => (
              <PendingTaskCard
                key={pt.id}
                pendingTask={pt}
                dailyLoad={dailyLoad}
                onConfirm={async () => {
                  await run("command:confirm-pending-task", { pendingId: pt.id });
                  refetch();
                }}
                onReject={async () => {
                  await run("command:reject-pending-task", { pendingId: pt.id });
                  refetch();
                }}
                onUpdateAnalysis={(_updates) => {
                  // No-op: editing a pending task's analysis before
                  // confirmation needs a dedicated server command
                  // (command:update-pending-task-analysis) which does
                  // not exist yet. Follow-up tracked in server/routes.
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
