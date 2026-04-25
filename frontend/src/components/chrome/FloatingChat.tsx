/* FloatingChat — always-available AI chat panel.
 *
 * Single endpoint, auto-routed by page context:
 *   POST /ai/chat/stream  (handleUnifiedChat on the backend)
 *
 * Mode is computed from `currentView`:
 *   - currentView starts with "goal-plan-<id>" → goal-plan mode, scoped
 *     to that goal. The backend reads context.currentPage="goal-plan"
 *     and switches to the plan-edit prompt + persistence path.
 *   - everything else → general mode. Home-chat persistence + intent
 *     dispatch (create-task / create-goal / set-vacation / etc.).
 *
 * The user can override the auto-route to "general" via a banner button
 * (e.g. when sitting on a Goal Plan page but wanting to ask the home
 * coach a general question). The override clears on the next navigation.
 *
 * The legacy /ai/home-chat/stream and /ai/goal-plan-chat/stream
 * endpoints are still live for backward compatibility but no FE caller
 * remains. */

import { useEffect, useMemo, useRef, useState } from "react";
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

const CHAT_API = "/ai/chat/stream";

interface Message {
  role: "user" | "assistant";
  text: string;
}

interface StreamResult {
  reply?: string;
  intents?: unknown[];
  [k: string]: unknown;
}

/** Extract the goalId from a `goal-plan-<id>` view, or null. */
function goalIdFromView(view: string | undefined): string | null {
  if (!view || !view.startsWith("goal-plan-")) return null;
  const id = view.slice("goal-plan-".length);
  return id.length > 0 ? id : null;
}

export default function FloatingChat() {
  const open = useStore((s) => s.isChatOpen);
  const close = () => useStore.getState().setChatOpen(false);
  const currentView = useStore((s) => s.currentView);
  const chatModeOverride = useStore((s) => s.chatModeOverride);
  const setChatModeOverride = useStore((s) => s.setChatModeOverride);
  const pendingMessage = useStore((s) => s.pendingChatMessage);
  const setPendingMessage = useStore((s) => s.setPendingChatMessage);

  // Auto-routed mode + goalId. The override flips a goal-plan view to
  // general mode without leaving the page; clearing it (or navigating)
  // returns to auto-routed.
  const viewGoalId = goalIdFromView(currentView);
  const isGoalScoped = !!viewGoalId && chatModeOverride !== "general";
  const goalId = isGoalScoped ? viewGoalId! : "";
  const mode: "goal-plan" | "general" = isGoalScoped ? "goal-plan" : "general";

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

  // Read current goals so manage-* intents can resolve a goal by id,
  // and so we can show the active goal title on the mode banner.
  const { data: planningView } = useQuery<{ goals?: Goal[] }>("view:planning");
  const goals = planningView?.goals ?? [];
  const activeGoal = useMemo(
    () => (goalId ? goals.find((g) => g.id === goalId) : undefined),
    [goalId, goals],
  );

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
    setError(null);
    setMessages((m) => [...m, { role: "user", text }]);
    setInput("");
    setStreaming(true);

    // Build chatHistory for the API — ONLY prior turns. The unified
    // handler appends the current userInput itself; including it here
    // produces a duplicate trailing user turn that Anthropic rejects
    // with "messages.N.content: Field required". Also strip local
    // "∟streaming∟" placeholders + empty-content messages (failed
    // streams). Capped at 50; the backend trims further.
    const chatHistory = messages
      .filter((m) => !(m.role === "assistant" && m.text.startsWith("∟streaming∟")))
      .filter((m) => typeof m.text === "string" && m.text.trim().length > 0)
      .map((m) => ({ role: m.role, content: m.text }))
      .slice(-50);

    let acc = "";
    // Unified body. context.currentPage drives the backend's mode
    // branching (handleUnifiedChat in backend/core/src/ai/handlers/
    // chat.ts) and goalId is read at the top level for the plan-fetch
    // step in /ai/chat/stream.
    const body: Record<string, unknown> = {
      userInput: text,
      chatHistory,
      context: {
        currentPage: mode === "goal-plan" ? "goal-plan" : currentView,
        ...(mode === "goal-plan" ? { selectedGoalId: goalId } : {}),
      },
      ...(mode === "goal-plan" ? { goalId } : {}),
      goals: [],
      todayTasks: [],
      activeReminders: [],
    };

    try {
      await postSseStream<StreamResult>(CHAT_API, body, {
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
            // Track per-turn dispatch failures so we can surface them
            // to the user. The AI sometimes replies "Done — created
            // your reminder!" even when the dispatch fails (deploy
            // mismatch, validation, schema drift, etc.). Letting that
            // lie stand silently is the worst possible UX. Append a
            // visible warning to the message instead.
            const dispatchErrors: string[] = [];
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
                const kind =
                  (rawIntent as { kind?: string })?.kind ?? "action";
                const detail = (err as Error)?.message ?? String(err);
                console.warn(
                  `[FloatingChat] intent dispatch error (${kind}):`,
                  err,
                );
                dispatchErrors.push(`${kind}: ${detail}`);
              }
            }
            if (dispatchErrors.length > 0) {
              // Augment the AI's reply (don't replace it — the prose
              // may still be useful). The user sees both the original
              // message and a truthful warning that the action didn't
              // land.
              setMessages((m) => {
                const last = m[m.length - 1];
                const warning =
                  `\n\n⚠ I couldn't actually save that — ` +
                  dispatchErrors.join("; ") +
                  `. Try again, or use the relevant page button directly.`;
                if (last?.role === "assistant") {
                  return [
                    ...m.slice(0, -1),
                    { role: "assistant", text: last.text + warning },
                  ];
                }
                return m;
              });
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
    // Only meaningful in general/home mode — that's the path that
    // persists to home_chat_messages. Goal-plan mode persists to
    // goal.planChat which is cleared via the goal lifecycle, not here.
    if (mode !== "general") return;
    try {
      await run("command:clear-home-chat", {});
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
          <span
            data-testid="chat-title"
            style={{
              flex: 1,
              fontSize: "var(--t-sm)",
              fontWeight: 600,
              color: "var(--fg)",
            }}
          >
            Starward
          </span>
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
          {mode === "general" && (
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

        {/* Mode banner. Auto-shown in goal-plan mode so the user knows
            the chat is scoped to a specific goal; one-click revert to
            general mode. Hidden in general mode (no banner = home). */}
        {mode === "goal-plan" && (
          <div
            data-testid="chat-mode-banner"
            style={{
              padding: "6px 14px",
              borderBottom: "1px solid var(--border-soft)",
              background: "var(--gold-faint)",
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 11,
              color: "var(--fg-mute)",
            }}
          >
            <Icon name="tree" size={11} style={{ color: "var(--accent)" }} />
            <span style={{ flex: 1 }}>
              Talking about{" "}
              <span style={{ color: "var(--fg)", fontWeight: 600 }}>
                {activeGoal?.title ?? `goal ${goalId.slice(0, 8)}`}
              </span>
            </span>
            <button
              data-testid="chat-back-to-general"
              onClick={() => setChatModeOverride("general")}
              title="Switch to general chat"
              style={{
                border: 0,
                background: "transparent",
                cursor: "pointer",
                color: "var(--fg-mute)",
                padding: "2px 6px",
                fontSize: 11,
              }}
            >
              ← general
            </button>
          </div>
        )}
        {mode === "general" && viewGoalId && (
          <div
            data-testid="chat-mode-banner-overridden"
            style={{
              padding: "6px 14px",
              borderBottom: "1px solid var(--border-soft)",
              background: "var(--bg-soft)",
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 11,
              color: "var(--fg-faint)",
            }}
          >
            <span style={{ flex: 1 }}>General mode</span>
            <button
              data-testid="chat-back-to-goal"
              onClick={() => setChatModeOverride(null)}
              title="Switch back to this goal"
              style={{
                border: 0,
                background: "transparent",
                cursor: "pointer",
                color: "var(--fg-mute)",
                padding: "2px 6px",
                fontSize: 11,
              }}
            >
              ← back to goal
            </button>
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
            placeholder={
              mode === "goal-plan"
                ? `Ask about "${activeGoal?.title ?? "this goal"}"… (Enter)`
                : "Message Starward… (Enter to send)"
            }
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
            data-api={`POST ${CHAT_API}`}
            data-testid="chat-send"
            disabled={streaming}
          >
            <Icon name="arrow-right" size={13} />
          </Button>
        </footer>
      </aside>
      {showSessions && <ChatSessionsWindow onClose={() => setShowSessions(false)} />}
    </>
  );
}
