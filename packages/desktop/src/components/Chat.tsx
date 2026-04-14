/* NorthStar — Unified slide-out chat panel
 *
 * Context-aware chat that works from any page. Uses the unified /chat/stream
 * SSE endpoint. The current page context is injected so the AI adapts its
 * behavior (e.g., plan refinement on goal-plan pages, weekly review on
 * tasks page when due).
 */

import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
} from "react";
import {
  X,
  Send,
  Loader2,
  Plus,
  FileText,
  Image as ImageIcon,
  ArrowRight,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import useStore from "../store/useStore";
import { postSseStream } from "../services/transport";
import { collectEnvironment } from "../services/environment";
import { useQuery } from "../hooks/useQuery";
import { useCommand } from "../hooks/useCommand";
import { dispatchChatIntent } from "../utils/dispatchChatIntent";
import { PendingGoalCard } from "../pages/dashboard/PendingCards";
import type {
  HomeChatMessage,
  GoalPlanMessage,
  Goal,
  GoalPlan,
  DailyTask,
  Reminder,
  CommandKind,
} from "@northstar/core";
import "./Chat.css";

/** Strip JSON envelope from an assistant message.
 *  Handles: entire-response JSON `{"reply":"..."}`, trailing JSON after
 *  conversational text, and markdown-fenced JSON blocks. */
function stripJsonEnvelope(text: string): string {
  if (!text) return text;
  const trimmed = text.trim();
  // If the entire message is a JSON envelope with a "reply" field, extract it
  if (trimmed.startsWith("{") && trimmed.includes('"reply"')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed.reply === "string") return parsed.reply;
    } catch { /* not valid JSON, try other strategies */ }
  }
  // Strip a trailing JSON block after conversational text
  const jsonStart = trimmed.indexOf('\n{');
  if (jsonStart >= 0) {
    const candidate = trimmed.slice(jsonStart + 1).trim();
    if (candidate.startsWith('{') && candidate.includes('"reply"')) {
      return trimmed.slice(0, jsonStart).trim();
    }
  }
  return text;
}

interface GoalPlanViewModel {
  planChat: GoalPlanMessage[];
  plan: GoalPlan | null;
}

interface ChatContext {
  currentPage: string;
  selectedGoalId?: string;
  selectedGoalPlan?: Record<string, unknown>;
  goalTitle?: string;
  targetDate?: string;
  importance?: string;
  isHabit?: boolean;
  description?: string;
  weeklyReviewDue?: boolean;
  activeGoals?: Array<Record<string, unknown>>;
}

interface DashboardView {
  homeChatMessages: HomeChatMessage[];
  activeGoals: Goal[];
  todayTasks: DailyTask[];
  todayDate: string;
  activeReminders: Reminder[];
}

interface StreamResult {
  reply: string;
  intent: unknown;
  intents: unknown[];
  planReady: boolean;
  plan: Record<string, unknown> | null;
  planPatch: Record<string, unknown> | null;
  userMessageId?: string;
  assistantMessageId?: string;
}

const MAX_VISIBLE = 20;

export default function Chat() {
  const isOpen = useStore((s) => s.isChatOpen);
  const setChatOpen = useStore((s) => s.setChatOpen);
  const setView = useStore((s) => s.setView);
  const currentView = useStore((s) => s.currentView);

  const { data: dashData } = useQuery<DashboardView>("view:dashboard");
  const { run: runCommand } = useCommand();

  // Derive goalId early — needed for the goal-plan query below.
  const goalPlanGoalId = currentView.startsWith("goal-plan-")
    ? currentView.replace("goal-plan-", "")
    : undefined;

  // Query goal-specific planChat when on a goal-plan page.
  const { data: goalPlanData, refetch: refetchGoalPlan } = useQuery<GoalPlanViewModel>(
    "view:goal-plan",
    goalPlanGoalId ? { goalId: goalPlanGoalId } : undefined,
    { enabled: !!goalPlanGoalId },
  );

  const [messages, setMessages] = useState<HomeChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [pendingGoal, setPendingGoal] = useState<Partial<Goal> | null>(null);
  const [attachments, setAttachments] = useState<
    Array<{
      id: string;
      file: File;
      name: string;
      type: "image" | "pdf";
      base64: string;
      mediaType: string;
      previewUrl?: string;
    }>
  >([]);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Track chat context to detect switches between goal-plan and home.
  const chatContextKey = goalPlanGoalId ?? "home";
  const prevChatContextRef = useRef(chatContextKey);

  // Reset messages when switching between contexts (goal ↔ home ↔ different goal).
  useEffect(() => {
    if (chatContextKey !== prevChatContextRef.current) {
      prevChatContextRef.current = chatContextKey;
      setMessages([]);
      setStreamingText("");
    }
  }, [chatContextKey]);

  // Sync messages from goal planChat when on a goal-plan page.
  // Sanitize assistant messages: strip any JSON envelope that leaked into
  // the stored content (from earlier bugs where the AI response wasn't
  // properly parsed before persistence).
  // Only sync when the server has messages — avoids overwriting pending
  // local messages (e.g. from auto-trigger) with an empty planChat.
  useEffect(() => {
    if (goalPlanGoalId && goalPlanData?.planChat && goalPlanData.planChat.length > 0) {
      setMessages(
        goalPlanData.planChat.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.role === "assistant" ? stripJsonEnvelope(m.content) : m.content,
          timestamp: m.timestamp,
        })),
      );
    }
  }, [goalPlanGoalId, goalPlanData?.planChat]);

  // Sync messages from home chat when NOT on a goal-plan page.
  useEffect(() => {
    if (!goalPlanGoalId && dashData?.homeChatMessages) {
      setMessages(dashData.homeChatMessages);
    }
  }, [goalPlanGoalId, dashData?.homeChatMessages]);

  // Auto-scroll on new messages or pending card
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText, pendingGoal]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Derive page context
  const context = useMemo((): ChatContext => {
    const page = currentView.startsWith("goal-plan-")
      ? "goal-plan"
      : currentView;
    const ctx: ChatContext = { currentPage: page };

    if (page === "goal-plan" && currentView.startsWith("goal-plan-")) {
      const goalId = currentView.replace("goal-plan-", "");
      ctx.selectedGoalId = goalId;
      const goal = dashData?.activeGoals?.find((g) => g.id === goalId);
      if (goal) {
        ctx.goalTitle = goal.title;
        ctx.targetDate = goal.targetDate;
        ctx.importance = goal.importance;
        ctx.isHabit = goal.isHabit;
        ctx.description = goal.description;
      }
      // Prefer the fresh plan from the goal-plan view query (auto-refreshes
      // on invalidation) over the dashboard's potentially stale copy.
      const freshPlan = goalPlanData?.plan ?? goal?.plan;
      if (freshPlan) {
        ctx.selectedGoalPlan = freshPlan as unknown as Record<string, unknown>;
      }
    }

    return ctx;
  }, [currentView, dashData?.activeGoals, goalPlanData?.plan]);

  const sendMessageText = useCallback(async (text: string) => {
    if (!text || isStreaming) return;

    const userMsg: HomeChatMessage = {
      id: `temp-${Date.now()}`,
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsStreaming(true);
    setStreamingText("");

    const goals = dashData?.activeGoals ?? [];
    const todayTasks = dashData?.todayTasks ?? [];
    const reminders = dashData?.activeReminders ?? [];
    const todayDate = dashData?.todayDate ?? new Date().toISOString().split("T")[0];

    const chatHistory = [...messages, userMsg]
      .slice(-16)
      .map((m) => ({ role: m.role, content: m.content }));

    const payload: Record<string, unknown> = {
      userInput: text,
      userMessageId: userMsg.id,
      chatHistory,
      context,
      goals: goals.map((g) => ({
        id: g.id,
        title: g.title,
        scope: g.scope,
        goalType: g.goalType,
        status: g.status,
        hasPlan: !!g.plan,
        planConfirmed: g.planConfirmed,
      })),
      todayTasks: todayTasks.map((t) => ({
        id: t.id,
        title: t.title,
        completed: t.completed,
        skipped: !!t.skipped,
        cognitiveWeight: t.cognitiveWeight,
        durationMinutes: t.durationMinutes,
      })),
      activeReminders: reminders.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        reminderTime: r.reminderTime,
        date: r.date,
        acknowledged: r.acknowledged,
        repeat: r.repeat,
      })),
      attachments: attachments.map((a) => ({
        type: a.type,
        name: a.name,
        base64: a.base64,
        mediaType: a.mediaType,
      })),
    };

    // Goal plan mode passes goalId for plan persistence
    if (context.currentPage === "goal-plan" && context.selectedGoalId) {
      payload.goalId = context.selectedGoalId;
    }

    try {
      const env = await collectEnvironment();
      payload._environmentContext = env;
    } catch {
      // best-effort
    }

    try {
      await postSseStream<StreamResult>("/ai/chat/stream", payload, {
        onDelta: (text) => {
          setStreamingText((prev) => prev + text);
        },
        onDone: async (result) => {
          const assistantMsg: HomeChatMessage = {
            id: result.assistantMessageId ?? `asst-${Date.now()}`,
            role: "assistant",
            content: result.reply || "",
            timestamp: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, assistantMsg]);
          setStreamingText("");
          setIsStreaming(false);

          // If the server applied a plan change, force-refetch the goal
          // plan view so the UI updates immediately. The WebSocket
          // invalidation should also trigger this, but explicitly refetching
          // here ensures we don't rely on the WS timing.
          if (result.planReady || result.planPatch || result.plan) {
            setTimeout(() => refetchGoalPlan(), 300);
          }

          // Dispatch intents if any
          if (result.intents && result.intents.length > 0) {
            for (const rawIntent of result.intents) {
              try {
                const signal = await dispatchChatIntent(rawIntent, {
                  run: runCommand,
                  goals,
                  todayTasks,
                  activeReminders: reminders,
                  todayDate,
                });
                // Goal intents are NOT auto-dispatched — show a
                // confirmation card so the user can review first.
                if (signal === "pending-goal") {
                  const i = rawIntent as { entity?: Partial<Goal> };
                  if (i.entity) {
                    setPendingGoal(i.entity);
                  }
                }
              } catch (err) {
                console.warn("[Chat] intent dispatch error:", err);
              }
            }
          }
        },
        onError: (msg) => {
          console.error("[Chat] stream error:", msg);
          const isCreditError = /credit|balance|billing|too low|insufficient|quota/i.test(msg);
          const isRateLimit = /rate.limit|too many requests|429/i.test(msg);
          const isOverloaded = /overloaded|529|capacity/i.test(msg);
          let content: string;
          if (isCreditError) {
            content = "You've run out of AI credits. Please purchase more to continue using this feature.";
          } else if (isRateLimit) {
            content = "Too many requests — please wait a moment and try again.";
          } else if (isOverloaded) {
            content = "The AI service is currently overloaded. Please try again in a few minutes.";
          } else {
            content = `Sorry, something went wrong: ${msg}`;
          }
          const errorMsg: HomeChatMessage = {
            id: `err-${Date.now()}`,
            role: "assistant",
            content,
            timestamp: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, errorMsg]);
          setStreamingText("");
          setIsStreaming(false);
        },
      });
    } catch (err) {
      console.error("[Chat] stream failed:", err);
      const errMsg = err instanceof Error ? err.message : String(err);
      const isCreditError = /credit|balance|billing|too low|insufficient|quota/i.test(errMsg);
      const errorContent = isCreditError
        ? "You've run out of AI credits. Please purchase more to continue using this feature."
        : `Sorry, something went wrong: ${errMsg}`;
      const errorMsg: HomeChatMessage = {
        id: `err-${Date.now()}`,
        role: "assistant",
        content: errorContent,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMsg]);
      setIsStreaming(false);
      setStreamingText("");
    }
  }, [isStreaming, messages, dashData, context, runCommand]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text && attachments.length === 0) return;
    setInput("");
    setAttachments([]);
    if (inputRef.current) inputRef.current.style.height = "auto";
    await sendMessageText(text);
  }, [input, attachments, sendMessageText]);

  // Auto-start planning conversation when chat opens on a goal-plan page
  // with no existing plan and no chat history. Sends a single kickoff
  // message so the AI begins its clarification cycle immediately.
  const autoSentRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      isOpen &&
      !isStreaming &&
      context.currentPage === "goal-plan" &&
      context.selectedGoalId &&
      context.goalTitle &&
      !context.selectedGoalPlan &&
      messages.length === 0 &&
      autoSentRef.current !== context.selectedGoalId
    ) {
      autoSentRef.current = context.selectedGoalId;
      void sendMessageText(`Help me plan my goal: "${context.goalTitle}"`);
    }
  }, [isOpen, isStreaming, context, messages.length, sendMessageText]);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files) return;
      for (const file of Array.from(files)) {
        const reader = new FileReader();
        reader.onload = () => {
          const base64 = (reader.result as string).split(",")[1];
          const type: "image" | "pdf" = file.type.startsWith("image/")
            ? "image"
            : "pdf";
          setAttachments((prev) => [
            ...prev,
            {
              id: `att-${Date.now()}-${Math.random()}`,
              file,
              name: file.name,
              type,
              base64,
              mediaType: file.type,
              previewUrl:
                type === "image" ? URL.createObjectURL(file) : undefined,
            },
          ]);
        };
        reader.readAsDataURL(file);
      }
      e.target.value = "";
    },
    [],
  );

  const visibleMessages = useMemo(
    () => messages.slice(-MAX_VISIBLE),
    [messages],
  );

  const isGoalContext = context.currentPage === "goal-plan" && !!context.goalTitle;

  if (!isOpen) return null;

  return (
      <aside className="chat-panel">

        <div className="chat-panel-header">
          <span className="chat-panel-title">Chat</span>
          <div className="chat-panel-header-actions">
            {!isGoalContext && (
              <button
                className="btn btn-ghost chat-panel-new"
                onClick={async () => {
                  setMessages([]);
                  await runCommand("command:clear-home-chat" as CommandKind, {});
                }}
                title="New chat"
                disabled={isStreaming}
              >
                <Plus size={16} />
              </button>
            )}
            <button
              className="btn btn-ghost chat-panel-close"
              onClick={async () => {
                if (!isGoalContext && messages.length > 0) {
                  setMessages([]);
                  await runCommand("command:clear-home-chat" as CommandKind, {});
                }
                setChatOpen(false);
              }}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="chat-panel-messages">
          {isGoalContext && (
            <div className="chat-goal-context-banner">
              <p className="chat-goal-context-text">
                Chatting about <strong>{context.goalTitle}</strong>
              </p>
              <button
                className="chat-goal-context-general-btn"
                onClick={() => setView("tasks")}
              >
                General chat <ArrowRight size={12} />
              </button>
            </div>
          )}
          {visibleMessages.length === 0 && !isStreaming && (
            <div className="chat-panel-empty">
              {isGoalContext
                ? `Ask anything about "${context.goalTitle}" — edit the plan, check progress, or get suggestions.`
                : "Ask anything, add a task, manage your goals..."}
            </div>
          )}
          {visibleMessages.map((msg) => (
            <div
              key={msg.id}
              className={`chat-msg chat-msg-${msg.role}`}
            >
              <div className="chat-bubble">
                {msg.role === "assistant" ? (
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                ) : (
                  msg.content
                )}
              </div>
            </div>
          ))}
          {isStreaming && streamingText && (() => {
            // In plan-edit mode, strip any JSON that leaked into the stream
            const display = context.currentPage === "goal-plan"
              ? stripJsonEnvelope(streamingText)
              : streamingText;
            if (!display) return null;
            return (
              <div className="chat-msg chat-msg-assistant">
                <div className="chat-bubble">
                  <ReactMarkdown>{display}</ReactMarkdown>
                </div>
              </div>
            );
          })()}
          {isStreaming && !streamingText && (
            <div className="chat-msg chat-msg-assistant">
              <div className="chat-bubble chat-loading">
                <Loader2 size={14} className="spin" />
                <span>Thinking...</span>
              </div>
            </div>
          )}
          {pendingGoal && (
            <PendingGoalCard
              goal={pendingGoal}
              onConfirm={async () => {
                const goalToCreate = { ...pendingGoal };
                setPendingGoal(null);
                try {
                  await runCommand("command:create-goal" as CommandKind, {
                    goal: goalToCreate,
                  });
                  if (goalToCreate.id) {
                    setView(`goal-plan-${goalToCreate.id}`);
                  }
                } catch (err) {
                  console.error("[Chat] goal creation failed:", err);
                }
              }}
              onReject={() => setPendingGoal(null)}
              onUpdate={(updates) =>
                setPendingGoal((prev) => (prev ? { ...prev, ...updates } : prev))
              }
            />
          )}
          <div ref={chatEndRef} />
        </div>

        <div className="chat-panel-input">
          {attachments.length > 0 && (
            <div className="chat-attachments">
              {attachments.map((att) => (
                <div key={att.id} className="chat-attachment-chip">
                  {att.type === "image" ? (
                    att.previewUrl ? (
                      <img
                        src={att.previewUrl}
                        alt={att.name}
                        className="chat-attachment-thumb"
                      />
                    ) : (
                      <ImageIcon size={14} />
                    )
                  ) : (
                    <FileText size={14} />
                  )}
                  <span className="chat-attachment-name">{att.name}</span>
                  <button
                    className="chat-attachment-remove"
                    onClick={() =>
                      setAttachments((prev) =>
                        prev.filter((a) => a.id !== att.id),
                      )
                    }
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="chat-input-row">
            <input
              ref={fileInputRef}
              type="file"
              className="chat-file-hidden"
              accept="image/*,.pdf"
              multiple
              onChange={handleFileSelect}
            />
            <button
              className="btn btn-ghost chat-attach-btn"
              onClick={() => fileInputRef.current?.click()}
              title="Attach image or PDF"
            >
              <Plus size={16} />
            </button>
            <textarea
              ref={inputRef}
              className="chat-input"
              placeholder="Message..."
              value={input}
              rows={1}
              onChange={(e) => {
                setInput(e.target.value);
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = Math.min(el.scrollHeight, 120) + "px";
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && input.trim()) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              disabled={isStreaming}
            />
            <button
              className="btn btn-primary chat-send-btn"
              onClick={handleSend}
              disabled={isStreaming || (!input.trim() && attachments.length === 0)}
            >
              {isStreaming ? (
                <Loader2 size={16} className="spin" />
              ) : (
                <Send size={16} />
              )}
            </button>
          </div>
        </div>
      </aside>
  );
}

