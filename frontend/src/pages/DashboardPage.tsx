/* ──────────────────────────────────────────────────────────
   NorthStar — Dashboard page (Home)
   Minimalistic single-query interface: input at top,
   AI response beneath, pending tasks below.
   ────────────────────────────────────────────────────────── */

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Check,
  Loader2,
  Clock,
  Send,
  Calendar,
  CalendarDays,
  CheckCircle2,
  XCircle,
  Pencil,
  ArrowRight,
  AlertTriangle,
  Plus,
  MessageSquare,
  Trash2,
  Paperclip,
  X,
  FileText,
  Image as ImageIcon,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import useStore from "../store/useStore";
import { useT } from "../i18n";
import { analyzeQuickTask, sendHomeChatMessage, generateGoalPlan } from "../services/ai";
import { setPlanJobId } from "../services/jobPersistence";
import { chatRepo } from "../repositories";
import type { PendingTask, HomeChatMessage, CalendarEvent, Goal, Reminder, GoalPlanMessage } from "../types";
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

interface Attachment {
  id: string;
  file: File;
  name: string;
  type: "image" | "pdf";
  previewUrl?: string; // data URL for image thumbnails
  base64: string;
  mediaType: string;
}

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
  const inputRef = useRef<HTMLInputElement>(null);
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
        <div className="chat-list-panel">
          <div className="chat-list-header">
            <span className="chat-list-title">Chats</span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setShowChatList(false)}
              title="Close"
            >
              &times;
            </button>
          </div>
          <button
            className="chat-list-new-btn"
            onClick={() => { startNewChat(); setShowChatList(false); }}
          >
            <Plus size={14} /> New chat
          </button>
          <div className="chat-list-items">
            {chatSessions.length === 0 && (
              <p className="chat-list-empty">No previous chats</p>
            )}
            {chatSessions.map((session) => (
              <div
                key={session.id}
                className={`chat-list-item ${session.id === activeChatId ? "chat-list-item-active" : ""}`}
                onClick={() => { switchChat(session.id); setShowChatList(false); }}
              >
                <MessageSquare size={13} />
                <div className="chat-list-item-content">
                  <span className="chat-list-item-title">{session.title}</span>
                  <span className="chat-list-item-date">
                    {new Date(session.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  </span>
                </div>
                <button
                  className="chat-list-item-delete"
                  onClick={(e) => { e.stopPropagation(); deleteChat(session.id); }}
                  title="Delete chat"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="dashboard-home">
        {/* ── Input at top ── */}
        <div className="home-input-section">
          <div className="home-input-row">
            <button
              className="btn btn-ghost home-chat-list-btn"
              onClick={() => setShowChatList(!showChatList)}
              title="Chat history"
            >
              <MessageSquare size={16} />
            </button>
            <input
              ref={inputRef}
              className="home-input"
              type="text"
              placeholder="Ask anything, add a task, or check your progress..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && input.trim()) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              disabled={isLoading}
            />
            <input
              ref={fileInputRef}
              type="file"
              className="home-file-input-hidden"
              accept="image/*,.pdf"
              multiple
              onChange={handleFileSelect}
            />
            <button
              className="btn btn-ghost home-attach-btn"
              onClick={() => fileInputRef.current?.click()}
              title="Attach image or PDF"
            >
              <Plus size={16} />
            </button>
            <button
              className="btn btn-primary home-send-btn"
              onClick={handleSend}
              disabled={isLoading || (!input.trim() && attachments.length === 0)}
            >
              {isLoading ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
            </button>
          </div>
          {/* ── Attachment previews ── */}
          {attachments.length > 0 && (
            <div className="home-attachments">
              {attachments.map((att) => (
                <div key={att.id} className="home-attachment-chip">
                  {att.type === "image" ? (
                    att.previewUrl ? (
                      <img src={att.previewUrl} alt={att.name} className="home-attachment-thumb" />
                    ) : (
                      <ImageIcon size={14} />
                    )
                  ) : (
                    <FileText size={14} />
                  )}
                  <span className="home-attachment-name">{att.name}</span>
                  <button
                    className="home-attachment-remove"
                    onClick={() => removeAttachment(att.id)}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

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
        {(homeChatMessages.length > 0 || isLoading) && (
          <div className="home-chat-history">
            {homeChatMessages.map((msg) => (
              <div key={msg.id} className={`home-chat-msg home-chat-${msg.role}`}>
                <div className="home-chat-bubble">
                  {msg.role === "assistant" ? (
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  ) : (
                    msg.content
                  )}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="home-chat-msg home-chat-assistant">
                <div className="home-chat-bubble home-chat-loading">
                  <Loader2 size={14} className="spin" />
                  <span>Thinking...</span>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
        )}

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

// ── Overload warning helper ──

interface DailyLoad {
  currentWeight: number;
  currentMinutes: number;
  activeTaskCount: number;
  todayEventCount: number;
}

function getOverloadWarnings(load: DailyLoad, addWeight = 0, addMinutes = 0): string[] {
  const warnings: string[] = [];
  const newWeight = load.currentWeight + addWeight;
  const newMinutes = load.currentMinutes + addMinutes;

  if (newWeight > 12) {
    warnings.push(`Cognitive load will hit ${newWeight}/12 — over your daily limit`);
  } else if (newWeight >= 10) {
    warnings.push(`Cognitive load will reach ${newWeight}/12 — near your limit`);
  }

  if (newMinutes > 180) {
    warnings.push(`Total time will exceed the 3-hour deep work ceiling (${newMinutes} min)`);
  } else if (newMinutes >= 150) {
    warnings.push(`You're approaching the 3-hour ceiling (${newMinutes} min scheduled)`);
  }

  if (load.activeTaskCount >= 5) {
    warnings.push(`You already have ${load.activeTaskCount} active tasks — decision fatigue risk`);
  } else if (load.activeTaskCount >= 4) {
    warnings.push(`Adding this gives you ${load.activeTaskCount + 1} active tasks — near the limit`);
  }

  if (load.todayEventCount >= 3) {
    warnings.push(`Packed day — ${load.todayEventCount} calendar events already`);
  }

  return warnings;
}

// ── Pending Task Card ──

function PendingTaskCard({
  pendingTask,
  dailyLoad,
  onConfirm,
  onReject,
  onUpdateAnalysis,
}: {
  pendingTask: PendingTask;
  dailyLoad: DailyLoad;
  onConfirm: () => void;
  onReject: () => void;
  onUpdateAnalysis: (updates: Partial<NonNullable<PendingTask["analysis"]>>) => void;
}) {
  const t = useT();
  const [editingDesc, setEditingDesc] = useState(false);
  const [editDesc, setEditDesc] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState("");

  if (pendingTask.status === "analyzing") {
    return (
      <div className="pending-card pending-card-analyzing">
        <div className="pending-card-header">
          <Loader2 size={14} className="spin" />
          <span className="pending-card-input">"{pendingTask.userInput}"</span>
        </div>
        <p className="pending-card-status">{t.home.analyzing}</p>
      </div>
    );
  }

  if (!pendingTask.analysis) return null;
  const a = pendingTask.analysis;

  const isForToday = a.suggestedDate === new Date().toISOString().split("T")[0];
  const overloadWarnings = isForToday
    ? getOverloadWarnings(dailyLoad, a.cognitiveWeight, a.durationMinutes)
    : [];

  const weightColors: Record<number, string> = {
    1: "badge-weight-1", 2: "badge-weight-2", 3: "badge-weight-3",
    4: "badge-weight-4", 5: "badge-weight-5",
  };

  return (
    <div className="pending-card pending-card-ready">
      <div className="pending-card-header">
        <CheckCircle2 size={14} className="pending-ready-icon" />
        {editingTitle ? (
          <input
            className="input pending-edit-input pending-edit-title"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onBlur={() => {
              if (editTitle.trim()) onUpdateAnalysis({ title: editTitle.trim() });
              setEditingTitle(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (editTitle.trim()) onUpdateAnalysis({ title: editTitle.trim() });
                setEditingTitle(false);
              }
              if (e.key === "Escape") setEditingTitle(false);
            }}
            autoFocus
          />
        ) : (
          <span
            className="pending-card-title pending-editable"
            onClick={() => { setEditTitle(a.title); setEditingTitle(true); }}
            title="Click to edit"
          >
            {a.title}
            <Pencil size={11} className="pending-edit-icon" />
          </span>
        )}
      </div>
      {a.description && (
        editingDesc ? (
          <textarea
            className="input pending-edit-input pending-edit-desc"
            value={editDesc}
            onChange={(e) => setEditDesc(e.target.value)}
            onBlur={() => {
              onUpdateAnalysis({ description: editDesc.trim() });
              setEditingDesc(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onUpdateAnalysis({ description: editDesc.trim() });
                setEditingDesc(false);
              }
              if (e.key === "Escape") setEditingDesc(false);
            }}
            rows={2}
            autoFocus
          />
        ) : (
          <p
            className="pending-card-desc pending-editable"
            onClick={() => { setEditDesc(a.description); setEditingDesc(true); }}
            title="Click to edit"
          >
            {a.description}
            <Pencil size={11} className="pending-edit-icon" />
          </p>
        )
      )}
      <div className="pending-card-meta">
        <span className="badge badge-accent">{a.category}</span>
        <span className={`badge ${weightColors[a.cognitiveWeight] || ""}`}>
          {a.cognitiveWeight}/5
        </span>
        <span className="pending-card-duration">
          <Clock size={12} /> {a.durationMinutes}m
        </span>
        <span className="pending-card-date">
          <Calendar size={12} /> {a.suggestedDate}
        </span>
      </div>
      {a.conflictsWithExisting.length > 0 && (
        <p className="pending-card-conflict">
          {t.home.conflicts}: {a.conflictsWithExisting.join(", ")}
        </p>
      )}
      {overloadWarnings.length > 0 && (
        <div className="pending-overload-warning">
          <AlertTriangle size={13} />
          <div>
            {overloadWarnings.map((w, i) => (
              <p key={i}>{w}</p>
            ))}
          </div>
        </div>
      )}
      <div className="pending-card-actions">
        <button className="btn btn-primary btn-sm" onClick={onConfirm}>
          <Check size={14} /> {overloadWarnings.length > 0 ? "Add anyway" : t.home.confirmTask}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onReject}>
          <XCircle size={14} /> {t.home.rejectTask}
        </button>
      </div>
    </div>
  );
}

// ── Pending Event Card ──

function PendingEventCard({
  event,
  dailyLoad,
  onConfirm,
  onReject,
  onUpdate,
}: {
  event: CalendarEvent;
  dailyLoad: DailyLoad;
  onConfirm: () => void;
  onReject: () => void;
  onUpdate: (updates: Partial<CalendarEvent>) => void;
}) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState(event.title);

  const isForToday = event.startDate.split("T")[0] === new Date().toISOString().split("T")[0];
  const overloadWarnings = isForToday
    ? getOverloadWarnings(dailyLoad, 0, event.durationMinutes)
    : [];

  const startDate = new Date(event.startDate);
  const dateStr = startDate.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const timeStr = event.isAllDay
    ? "All day"
    : startDate.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      });

  return (
    <div className="pending-card pending-event-card">
      <div className="pending-card-header">
        <Calendar size={14} className="pending-event-icon" />
        {editingTitle ? (
          <input
            className="input pending-edit-input pending-edit-title"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onBlur={() => {
              if (editTitle.trim()) onUpdate({ title: editTitle.trim() });
              setEditingTitle(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (editTitle.trim()) onUpdate({ title: editTitle.trim() });
                setEditingTitle(false);
              }
              if (e.key === "Escape") setEditingTitle(false);
            }}
            autoFocus
          />
        ) : (
          <span
            className="pending-card-title pending-editable"
            onClick={() => {
              setEditTitle(event.title);
              setEditingTitle(true);
            }}
            title="Click to edit"
          >
            {event.title}
            <Pencil size={11} className="pending-edit-icon" />
          </span>
        )}
      </div>
      <div className="pending-card-meta">
        <span className="badge badge-accent">{event.category}</span>
        <span className="pending-card-date">
          <CalendarDays size={12} /> {dateStr}
        </span>
        <span className="pending-card-duration">
          <Clock size={12} /> {timeStr}
          {!event.isAllDay && ` · ${event.durationMinutes}m`}
        </span>
      </div>
      {event.notes && (
        <p className="pending-card-desc">{event.notes}</p>
      )}
      {overloadWarnings.length > 0 && (
        <div className="pending-overload-warning">
          <AlertTriangle size={13} />
          <div>
            {overloadWarnings.map((w, i) => (
              <p key={i}>{w}</p>
            ))}
          </div>
        </div>
      )}
      <div className="pending-card-actions">
        <button className="btn btn-primary btn-sm" onClick={onConfirm}>
          <Check size={14} /> {overloadWarnings.length > 0 ? "Add anyway" : "Add to calendar"}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onReject}>
          <XCircle size={14} /> Discard
        </button>
      </div>
    </div>
  );
}
