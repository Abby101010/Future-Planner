/* FloatingChat — always-available AI chat panel.
 *
 * Three SSE channels per contract:
 *   - home      → POST /ai/home-chat/stream
 *   - chat      → POST /ai/chat/stream
 *   - goal-plan → POST /ai/goal-plan-chat/stream  (requires goalId)
 *
 * Plus the `clear-home-chat` command (home channel only) and a toggleable
 * ChatSessionsWindow (list / save / delete sessions + attachments).
 *
 * Absorbs the logic that lived in components/Chat.tsx. */

import { useEffect, useRef, useState } from "react";
import type { AppView, Goal } from "@starward/core";
import useStore from "../../store/useStore";
import { useQuery } from "../../hooks/useQuery";
import { postSseStream } from "../../services/transport";
import { useCommand } from "../../hooks/useCommand";
import { dispatchChatIntent } from "../../utils/dispatchChatIntent";
import Icon from "../primitives/Icon";
import Button from "../primitives/Button";
import ChatSessionsWindow from "./ChatSessionsWindow";
import PendingGoalCard from "./PendingGoalCard";
import { startJob } from "./JobStatusDock";

type ChatChannel = "home" | "chat" | "goal-plan";

const CHANNEL_META: Record<
  ChatChannel,
  { label: string; api: string; clearCmd?: "command:clear-home-chat"; needsGoalId?: boolean }
> = {
  home: { label: "Home chat", api: "/ai/home-chat/stream", clearCmd: "command:clear-home-chat" },
  chat: { label: "General chat", api: "/ai/chat/stream" },
  "goal-plan": { label: "Goal plan chat", api: "/ai/goal-plan-chat/stream", needsGoalId: true },
};

interface Message {
  role: "user" | "assistant";
  text: string;
}

interface StreamResult {
  reply?: string;
  intents?: unknown[];
  [k: string]: unknown;
}

export default function FloatingChat() {
  const open = useStore((s) => s.isChatOpen);
  const close = () => useStore.getState().setChatOpen(false);
  const channel = useStore((s) => s.chatChannel);
  const setChannel = useStore((s) => s.setChatChannel);
  const goalId = useStore((s) => s.chatGoalId);
  const setGoalId = useStore((s) => s.setChatGoalId);
  const pendingMessage = useStore((s) => s.pendingChatMessage);
  const setPendingMessage = useStore((s) => s.setPendingChatMessage);

  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      text: "Hi — I'm your Starward coach. Ask me to reshuffle tasks, break down a goal, or reflect on your week.",
    },
  ]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSessions, setShowSessions] = useState(false);
  /** Goal the AI proposed in its reply. User must click "Create goal" to
   *  actually POST /commands/create-goal — matches the old planner flow. */
  const [pendingGoal, setPendingGoal] = useState<Partial<Goal> | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const { run } = useCommand();
  const setView = useStore((s) => s.setView);
  const setResearchTopic = useStore((s) => s.setResearchTopic);

  // Read current goals so manage-* intents can resolve a goal by id.
  const { data: planningView } = useQuery<{ goals?: Goal[] }>("view:planning");
  const goals = planningView?.goals ?? [];

  const ch = CHANNEL_META[channel];

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 99999 });
  }, [messages, streaming, pendingGoal]);

  // Auto-send any pre-seeded message from the store when the panel opens.
  useEffect(() => {
    if (!open) return;
    if (!pendingMessage) return;
    void send(pendingMessage);
    setPendingMessage(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pendingMessage]);

  async function send(override?: string) {
    const text = (override ?? input).trim();
    if (!text || streaming) return;
    if (ch.needsGoalId && !goalId) {
      setError("goalId required for goal-plan channel");
      return;
    }
    setError(null);
    setMessages((m) => [...m, { role: "user", text }]);
    setInput("");
    setStreaming(true);

    // Build chatHistory for the API — all three backend handlers
    // (chat, home-chat, goal-plan-chat) map `chatHistory` directly into the
    // Claude messages array, so the current user message MUST be included as
    // the last entry (see backend/core/src/ai/handlers/{chat,homeChat,goalPlanChat}.ts).
    // Strip the local "∟streaming∟" placeholder prefix we use for in-flight
    // assistant deltas — the history must only contain clean turns. Cap at
    // 50 turns; the goalPlanChat handler further trims to 8 on its side.
    const cleanHistory = messages
      .filter((m) => !(m.role === "assistant" && m.text.startsWith("∟streaming∟")))
      .map((m) => ({ role: m.role, content: m.text }));
    const chatHistory = [...cleanHistory, { role: "user" as const, content: text }].slice(-50);

    let acc = "";
    const body: Record<string, unknown> =
      channel === "chat"
        ? { userInput: text, chatHistory, context: {}, goals: [], todayTasks: [], activeReminders: [] }
        : channel === "home"
          ? { userInput: text, chatHistory }
          : { userInput: text, goalId, chatHistory };

    try {
      await postSseStream<StreamResult>(ch.api, body, {
        onDelta: (delta) => {
          acc += delta;
          setMessages((m) => {
            const last = m[m.length - 1];
            if (last?.role === "assistant" && last.text.startsWith("∟streaming∟")) {
              return [...m.slice(0, -1), { role: "assistant", text: `∟streaming∟${acc}` }];
            }
            return [...m, { role: "assistant", text: `∟streaming∟${acc}` }];
          });
        },
        onDone: async (result) => {
          const finalText = (result?.reply as string | undefined) || acc;
          setMessages((m) => {
            const last = m[m.length - 1];
            if (last?.role === "assistant" && last.text.startsWith("∟streaming∟")) {
              return [...m.slice(0, -1), { role: "assistant", text: finalText }];
            }
            return [...m, { role: "assistant", text: finalText }];
          });
          if (result?.intents && Array.isArray(result.intents)) {
            const todayDate = new Date().toISOString().slice(0, 10);
            for (const rawIntent of result.intents) {
              try {
                const signal = await dispatchChatIntent(rawIntent, {
                  run,
                  goals,
                  todayTasks: [],
                  activeReminders: [],
                  todayDate,
                  setView: (v) => setView(v as AppView),
                  setResearchTopic,
                });
                // Goal intents aren't auto-dispatched — show a confirmation
                // card so the user can review/edit before committing. This
                // mirrors the old planner's Chat.tsx behavior.
                if (signal === "pending-goal") {
                  const i = rawIntent as { entity?: Partial<Goal> };
                  if (i.entity) setPendingGoal(i.entity);
                }
              } catch (err) {
                console.warn("[FloatingChat] intent dispatch error:", err);
              }
            }
          }
        },
        onError: (m) => setError(m),
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStreaming(false);
    }
  }

  async function clearHome() {
    if (!ch.clearCmd) return;
    try {
      await run(ch.clearCmd, {});
      setMessages([]);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!open) return null;

  return (
    <>
      <aside
        data-testid="floating-chat"
        style={{
          position: "fixed",
          right: 20,
          bottom: 88,
          width: 380,
          height: 560,
          background: "var(--bg-elev)",
          border: "1px solid var(--border)",
          borderRadius: "var(--r-lg)",
          boxShadow: "var(--shadow-3)",
          zIndex: 65,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          animation: "ns-slide-up .18s ease",
        }}
      >
        <header
          style={{
            padding: "10px 14px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <div style={{ color: "var(--accent)", display: "flex" }}>
            <Icon name="sparkle" size={14} />
          </div>
          <select
            data-testid="chat-channel"
            value={channel}
            onChange={(e) => setChannel(e.target.value as ChatChannel)}
            style={{
              flex: 1,
              padding: "3px 6px",
              border: "1px solid var(--border)",
              borderRadius: 4,
              fontSize: "var(--t-sm)",
              fontWeight: 600,
              background: "var(--bg)",
            }}
          >
            <option value="home">{CHANNEL_META.home.label}</option>
            <option value="chat">{CHANNEL_META.chat.label}</option>
            <option value="goal-plan">{CHANNEL_META["goal-plan"].label}</option>
          </select>
          <button
            data-testid="chat-sessions-toggle"
            onClick={() => setShowSessions((s) => !s)}
            title="Chat sessions"
            style={{
              border: 0,
              background: "transparent",
              cursor: "pointer",
              color: "var(--fg-mute)",
              padding: 4,
            }}
          >
            <Icon name="tree" size={14} />
          </button>
          {ch.clearCmd && (
            <button
              data-testid="chat-clear-home"
              onClick={clearHome}
              title="Clear home chat"
              style={{
                border: 0,
                background: "transparent",
                cursor: "pointer",
                color: "var(--fg-mute)",
                padding: 4,
              }}
            >
              <Icon name="trash" size={13} />
            </button>
          )}
          <button
            data-testid="chat-close"
            onClick={close}
            style={{
              border: 0,
              background: "transparent",
              cursor: "pointer",
              color: "var(--fg-mute)",
              padding: 4,
            }}
          >
            <Icon name="x" size={14} />
          </button>
        </header>

        {ch.needsGoalId && (
          <div
            style={{
              padding: "8px 14px",
              borderBottom: "1px solid var(--border-soft)",
              background: "var(--bg-soft)",
            }}
          >
            <input
              data-testid="chat-goal-id-input"
              value={goalId}
              onChange={(e) => setGoalId(e.target.value)}
              placeholder="goalId (required)"
              style={{
                width: "100%",
                padding: "5px 8px",
                fontSize: "var(--t-sm)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                fontFamily: "var(--font-mono)",
              }}
            />
          </div>
        )}

        <div
          ref={scrollRef}
          className="no-scrollbar"
          style={{
            flex: 1,
            overflow: "auto",
            padding: "14px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {messages.map((m, i) => {
            const text = m.text.startsWith("∟streaming∟") ? m.text.slice("∟streaming∟".length) : m.text;
            return (
              <div
                key={i}
                data-testid={`chat-msg-${i}`}
                style={{
                  alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                  maxWidth: "85%",
                  background: m.role === "user" ? "var(--navy)" : "var(--bg-soft)",
                  color: m.role === "user" ? "var(--white)" : "var(--fg)",
                  padding: "8px 11px",
                  borderRadius: "var(--r-md)",
                  fontSize: "var(--t-sm)",
                  lineHeight: 1.5,
                  whiteSpace: "pre-wrap",
                }}
              >
                {text}
              </div>
            );
          })}
          {streaming && (
            <div
              style={{
                alignSelf: "flex-start",
                padding: "8px 11px",
                background: "var(--bg-soft)",
                borderRadius: "var(--r-md)",
                display: "flex",
                gap: 4,
              }}
            >
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: "50%",
                    background: "var(--fg-faint)",
                    animation: `ns-pulse 1s ${i * 0.15}s infinite`,
                  }}
                />
              ))}
            </div>
          )}
          {pendingGoal && (
            <PendingGoalCard
              goal={pendingGoal}
              onConfirm={async () => {
                const draft = { ...pendingGoal };
                setPendingGoal(null);
                try {
                  // Backend expects { goal: { id, ... } } with a
                  // pre-generated id (backend/src/routes/commands/goals.ts:13).
                  const id =
                    draft.id ??
                    (crypto as unknown as { randomUUID?: () => string }).randomUUID?.() ??
                    `goal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                  const goalToCreate = { ...draft, id, status: draft.status ?? "active" };
                  await run("command:create-goal", { goal: goalToCreate });

                  // Two-call sequence: `command:create-goal` is a pure
                  // upsert (see backend/src/routes/commands/goals.ts:9) —
                  // it does NOT auto-generate a plan. We enqueue the
                  // async plan-generation job explicitly so the Goal Plan
                  // page can surface a "Planning…" state via the
                  // `inFlight` field on view:goal-plan. The job worker
                  // picks this up and emits WS view:invalidate when done.
                  try {
                    const job = await run<{ jobId?: string; async?: boolean }>(
                      "command:regenerate-goal-plan",
                      { goalId: id },
                    );
                    if (job?.jobId) {
                      startJob(
                        job.jobId,
                        `Generating plan for ${goalToCreate.title ?? "new goal"}`,
                      );
                    }
                  } catch (jobErr) {
                    // Goal is already created — surface the plan-enqueue
                    // error but don't undo the create; user can click
                    // "Regenerate" on the Goal Plan page to retry.
                    console.warn(
                      "[FloatingChat] plan enqueue failed after create-goal:",
                      jobErr,
                    );
                  }

                  setView(`goal-plan-${id}` as AppView);
                } catch (err) {
                  setError((err as Error).message);
                  // Put the draft back so the user can retry.
                  setPendingGoal(draft);
                }
              }}
              onReject={() => setPendingGoal(null)}
              onUpdate={(updates) =>
                setPendingGoal((prev) => (prev ? { ...prev, ...updates } : prev))
              }
            />
          )}
        </div>

        {error && (
          <div
            data-testid="chat-error"
            style={{
              padding: "6px 12px",
              fontSize: 10,
              color: "var(--danger)",
              background: "color-mix(in srgb, var(--danger) 6%, transparent)",
              borderTop: "1px solid color-mix(in srgb, var(--danger) 20%, transparent)",
            }}
          >
            {error}
          </div>
        )}

        <footer
          style={{
            padding: "10px 12px",
            borderTop: "1px solid var(--border)",
            display: "flex",
            gap: 6,
          }}
        >
          <textarea
            data-testid="chat-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={1}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={ch.needsGoalId && !goalId ? "Set goalId above first…" : "Message Starward… (Enter to send)"}
            style={{
              flex: 1,
              resize: "none",
              border: "1px solid var(--border)",
              borderRadius: 4,
              padding: "6px 10px",
              fontSize: "var(--t-sm)",
              fontFamily: "inherit",
              lineHeight: 1.4,
            }}
          />
          <Button
            tone="primary"
            size="sm"
            onClick={() => void send()}
            data-api={`POST ${ch.api}`}
            data-testid="chat-send"
            disabled={streaming || (ch.needsGoalId && !goalId)}
          >
            <Icon name="arrow-right" size={13} />
          </Button>
        </footer>
      </aside>
      {showSessions && <ChatSessionsWindow onClose={() => setShowSessions(false)} />}
    </>
  );
}
