/* ──────────────────────────────────────────────────────────
   NorthStar — Dashboard page (Home)
   Minimalistic single-query interface: input at top,
   AI response beneath, pending tasks below.
   ────────────────────────────────────────────────────────── */

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Check,
  CalendarDays,
  ArrowRight,
} from "lucide-react";
import useStore from "../store/useStore";
import { useT } from "../i18n";
import { analyzeQuickTask, sendHomeChatMessage, generateGoalPlan } from "../services/ai";
import { setPlanJobId } from "../services/jobPersistence";
import { chatRepo } from "../repositories";
import type { PendingTask, CalendarEvent, Goal, Reminder, GoalPlanMessage } from "../types";
import ChatListPanel from "../components/ChatListPanel";
import { PendingTaskCard, PendingEventCard } from "../components/PendingCards";
import HomeChatHistory from "../components/HomeChatHistory";
import HomeInputSection, { type HomeAttachment } from "../components/HomeInputSection";
import "./DashboardPage.css";

/** Strip emojis and stray unicode symbols from AI text */
function sanitizeAIText(text: string): string {
  return text
    // Remove emoji characters (broad Unicode ranges)
    .replace(/[\u{1F600}-\u{1F64F}]/gu, "")   // emoticons
    .replace(/[\u{1F300}-\u{1F5FF}]/gu, "")   // misc symbols & pictographs
    .replace(/[\u{1F680}-\u{1F6FF}]/gu, "")   // transport & map symbols
    .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, "")   // flags
    .replace(/[\u{2600}-\u{26FF}]/gu, "")      // misc symbols
    .replace(/[\u{2700}-\u{27BF}]/gu, "")      // dingbats
    .replace(/[\u{FE00}-\u{FE0F}]/gu, "")      // variation selectors
    .replace(/[\u{1F900}-\u{1F9FF}]/gu, "")    // supplemental symbols
    .replace(/[\u{1FA00}-\u{1FA6F}]/gu, "")    // chess symbols
    .replace(/[\u{1FA70}-\u{1FAFF}]/gu, "")    // symbols extended-A
    .replace(/[\u{200D}]/gu, "")               // zero-width joiner
    .replace(/  +/g, " ")                       // collapse double spaces
    .trim();
}

type Attachment = HomeAttachment;

export default function DashboardPage() {
  const {
    goals,
    todayLog,
    calendarEvents,
    pendingTasks,
    addPendingTask,
    updatePendingTask,
    removePendingTask,
    confirmPendingTask,
    homeChatMessages,
    addHomeChatMessage,
    clearHomeChat,
    chatSessions,
    activeChatId,
    startNewChat,
    switchChat,
    deleteChat,
    getCurrentMonthContext,
    setView,
    addCalendarEvent,
    addGoal,
    addReminder,
    removeGoal,
    updateGoal,
    setGoalPlan,
    addGoalPlanMessage,
  } = useStore();

  const t = useT();

  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [monthNudgeDismissed, setMonthNudgeDismissed] = useState(false);
  const [pendingEvent, setPendingEvent] = useState<CalendarEvent | null>(null);
  const [showChatList, setShowChatList] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const monthlyCtx = getCurrentMonthContext();
  const needsMonthlyContext = !monthlyCtx && !monthNudgeDismissed;
  const currentMonthLabel = new Date().toLocaleDateString(undefined, { month: "long" });

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

    // Add user message to store
    const msgId = crypto.randomUUID();
    addHomeChatMessage({
      id: msgId,
      role: "user",
      content: userContent,
      timestamp: new Date().toISOString(),
    });

    // Save attachment files to disk (persisted via IPC)
    // The session ID is set by addHomeChatMessage above
    const sessionId = useStore.getState().activeChatId;
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
        // Clean up object URLs
        if (att.previewUrl) URL.revokeObjectURL(att.previewUrl);
      }
    }

    // Prepare attachments for AI
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
        todayLog?.tasks || [],
        calendarEvents,
        attachmentData.length > 0 ? attachmentData : undefined
      );

      // The backend parses the LLM reply, builds fully-populated entities
      // (server-assigned UUIDs, defaulted fields, persisted or job-dispatched
      // as appropriate), and returns a structured intent. This page only
      // dispatches the intent to the existing store setters and formats a
      // user-facing confirmation sentence. No LLM output is parsed here,
      // no IDs are generated here, no domain fields are defaulted here.

      let displayText = result.reply;
      let pendingTaskToAnalyze: PendingTask | null = null;

      if (result.intent) {
        switch (result.intent.kind) {
          case "event": {
            const event = result.intent.entity;
            setPendingEvent(event);
            const dateStr = new Date(event.startDate).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
            const timeStr = event.isAllDay ? "all day" : new Date(event.startDate).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
            displayText = `Got it — I'll add "${event.title}" on ${dateStr} at ${timeStr} to your calendar.`;
            break;
          }
          case "goal": {
            const newGoal = result.intent.entity;
            addGoal(newGoal);
            // The backend already dispatched generate-goal-plan for big goals
            // and returned the jobId. Stash it under the same localStorage key
            // GoalPlanPage reads on mount so the in-flight job reattaches.
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
            addReminder(reminder);
            const timeStr = new Date(reminder.reminderTime).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
            const dateStr = new Date(reminder.date + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
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
              // Fire plan generation in background
              updateGoal(targetGoal.id, { plan: null, status: "planning", planChat: [] });
              generateGoalPlan(
                targetGoal.title,
                targetGoal.targetDate,
                targetGoal.importance,
                targetGoal.isHabit,
                targetGoal.description
              ).then((planResult) => {
                if (planResult.plan) {
                  setGoalPlan(targetGoal.id, planResult.plan);
                  const aiMsg: GoalPlanMessage = {
                    id: crypto.randomUUID(),
                    role: "assistant",
                    content: planResult.reply,
                    timestamp: new Date().toISOString(),
                  };
                  addGoalPlanMessage(targetGoal.id, aiMsg);
                  addHomeChatMessage({
                    id: crypto.randomUUID(),
                    role: "assistant",
                    content: sanitizeAIText(`The plan for "${targetGoal.title}" has been refreshed! Check it out in the Planning tab.`),
                    timestamp: new Date().toISOString(),
                  });
                }
              }).catch(() => {
                addHomeChatMessage({
                  id: crypto.randomUUID(),
                  role: "assistant",
                  content: `I had trouble regenerating the plan for "${targetGoal.title}". You can try again later.`,
                  timestamp: new Date().toISOString(),
                });
              });
            } else if (intent.action === "delete") {
              removeGoal(targetGoal.id);
              displayText = `I've removed "${targetGoal.title}" from your goals.`;
            } else if (intent.action === "archive") {
              updateGoal(targetGoal.id, { status: "archived" });
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

      // Add assistant message to store (sanitized — no emojis or stray symbols)
      addHomeChatMessage({
        id: crypto.randomUUID(),
        role: "assistant",
        content: sanitizeAIText(displayText),
        timestamp: new Date().toISOString(),
      });

      if (pendingTaskToAnalyze) {
        addPendingTask(pendingTaskToAnalyze);

        try {
          const analysis = await analyzeQuickTask(
            pendingTaskToAnalyze.userInput,
            todayLog?.tasks || [],
            goals,
            calendarEvents
          );
          updatePendingTask(pendingTaskToAnalyze.id, {
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
          });
        } catch {
          updatePendingTask(pendingTaskToAnalyze.id, { status: "rejected" });
        }
      }
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
  }, [input, isLoading, goals, todayLog, calendarEvents, homeChatMessages, attachments, addPendingTask, updatePendingTask, addHomeChatMessage, t]);

  const activePending = pendingTasks.filter((pt) => pt.status === "analyzing" || pt.status === "ready");

  // ── Daily load calculations for overload warnings ──
  const existingTasks = todayLog?.tasks || [];
  const currentWeight = existingTasks.reduce((sum, t) => sum + (t.cognitiveWeight || 3), 0);
  const currentMinutes = existingTasks.reduce((sum, t) => sum + (t.durationMinutes || 30), 0);
  const activeTaskCount = existingTasks.filter((t) => !t.completed).length;
  const today = new Date().toISOString().split("T")[0];
  const todayEventCount = calendarEvents.filter((e) => e.startDate.split("T")[0] === today).length;

  const dailyLoad = { currentWeight, currentMinutes, activeTaskCount, todayEventCount };

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
            onConfirm={() => {
              addCalendarEvent(pendingEvent);
              setPendingEvent(null);
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
                onConfirm={() => confirmPendingTask(pt.id)}
                onReject={() => removePendingTask(pt.id)}
                onUpdateAnalysis={(updates) => {
                  if (pt.analysis) {
                    updatePendingTask(pt.id, {
                      analysis: { ...pt.analysis, ...updates },
                    });
                  }
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

