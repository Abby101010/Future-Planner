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
import type {
  HomeChatMessage,
  Goal,
  DailyTask,
  CalendarEvent,
  Reminder,
  CommandKind,
} from "@northstar/core";
import "./Chat.css";

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
  todayEvents: CalendarEvent[];
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

  const [messages, setMessages] = useState<HomeChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
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

  // Sync messages from server on load
  useEffect(() => {
    if (dashData?.homeChatMessages) {
      setMessages(dashData.homeChatMessages);
    }
  }, [dashData?.homeChatMessages]);

  // Auto-scroll on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

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
        if (goal.plan) {
          ctx.selectedGoalPlan = goal.plan as unknown as Record<string, unknown>;
        }
      }
    }

    return ctx;
  }, [currentView, dashData?.activeGoals]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text && attachments.length === 0) return;
    if (isStreaming) return;

    const userMsg: HomeChatMessage = {
      id: `temp-${Date.now()}`,
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsStreaming(true);
    setStreamingText("");

    // Reset textarea height
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }

    const goals = dashData?.activeGoals ?? [];
    const todayTasks = dashData?.todayTasks ?? [];
    const todayEvents = dashData?.todayEvents ?? [];
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
      todayCalendarEvents: todayEvents.map((e) => ({
        id: e.id,
        title: e.title,
        startDate: e.startDate,
        endDate: e.endDate,
        category: e.category,
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

    setAttachments([]);

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

          // Dispatch intents if any
          if (result.intents && result.intents.length > 0) {
            for (const rawIntent of result.intents) {
              try {
                await dispatchChatIntent(rawIntent, {
                  run: runCommand,
                  goals,
                  todayTasks,
                  todayEvents,
                  activeReminders: reminders,
                  todayDate,
                });
              } catch (err) {
                console.warn("[Chat] intent dispatch error:", err);
              }
            }
          }
        },
        onError: (msg) => {
          console.error("[Chat] stream error:", msg);
          const errorMsg: HomeChatMessage = {
            id: `err-${Date.now()}`,
            role: "assistant",
            content: "Sorry, something went wrong. Please try again.",
            timestamp: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, errorMsg]);
          setStreamingText("");
          setIsStreaming(false);
        },
      });
    } catch (err) {
      console.error("[Chat] stream failed:", err);
      setIsStreaming(false);
      setStreamingText("");
    }
  }, [input, attachments, isStreaming, messages, dashData, context, runCommand]);

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
            <button
              className="btn btn-ghost chat-panel-close"
              onClick={async () => {
                if (messages.length > 0) {
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
                onClick={async () => {
                  if (messages.length > 0) {
                    setMessages([]);
                    await runCommand("command:clear-home-chat" as CommandKind, {});
                  }
                  setView("dashboard");
                }}
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
          {isStreaming && streamingText && (
            <div className="chat-msg chat-msg-assistant">
              <div className="chat-bubble">
                <ReactMarkdown>{streamingText}</ReactMarkdown>
              </div>
            </div>
          )}
          {isStreaming && !streamingText && (
            <div className="chat-msg chat-msg-assistant">
              <div className="chat-bubble chat-loading">
                <Loader2 size={14} className="spin" />
                <span>Thinking...</span>
              </div>
            </div>
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

