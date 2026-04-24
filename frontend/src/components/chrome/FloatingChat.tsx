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
import useStore from "../../store/useStore";
import { postSseStream } from "../../services/transport";
import { useCommand } from "../../hooks/useCommand";
import { dispatchChatIntent } from "../../utils/dispatchChatIntent";
import Icon from "../primitives/Icon";
import Button from "../primitives/Button";
import ChatSessionsWindow from "./ChatSessionsWindow";

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
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const { run } = useCommand();

  const ch = CHANNEL_META[channel];

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 99999 });
  }, [messages, streaming]);

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

    let acc = "";
    const body: Record<string, unknown> =
      channel === "chat"
        ? { userInput: text, chatHistory: [], context: {}, goals: [], todayTasks: [], activeReminders: [] }
        : channel === "home"
          ? { userInput: text, chatHistory: [] }
          : { userInput: text, goalId, chatHistory: [] };

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
        onDone: (result) => {
          const finalText = (result?.reply as string | undefined) || acc;
          setMessages((m) => {
            const last = m[m.length - 1];
            if (last?.role === "assistant" && last.text.startsWith("∟streaming∟")) {
              return [...m.slice(0, -1), { role: "assistant", text: finalText }];
            }
            return [...m, { role: "assistant", text: finalText }];
          });
          if (result?.intents && Array.isArray(result.intents)) {
            for (const intent of result.intents) {
              void dispatchChatIntent(intent as never, run as never);
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
