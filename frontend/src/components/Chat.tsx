/* Chat — bare HTML AI stream harness.
 *
 * Posts to /ai/chat/stream via the existing SSE transport and dumps token
 * deltas into a <pre>. The stripped UI is just a textarea + submit.
 */

import { useState } from "react";
import { postSseStream } from "../services/transport";
import { useCommand } from "../hooks/useCommand";
import { dispatchChatIntent } from "../utils/dispatchChatIntent";

type StreamResult = {
  reply?: string;
  intents?: unknown[];
  [k: string]: unknown;
};

type ChatChannel = "chat-stream" | "home-chat-stream" | "goal-plan-chat-stream";

const CHANNEL_PATHS: Record<ChatChannel, string> = {
  "chat-stream": "/ai/chat/stream",
  "home-chat-stream": "/ai/home-chat/stream",
  "goal-plan-chat-stream": "/ai/goal-plan-chat/stream",
};

export default function Chat() {
  const [input, setInput] = useState("");
  const [stream, setStream] = useState("");
  const [result, setResult] = useState<StreamResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [channel, setChannel] = useState<ChatChannel>("chat-stream");
  const [goalId, setGoalId] = useState("");
  const { run } = useCommand();

  async function send() {
    if (!input.trim()) return;
    setBusy(true);
    setStream("");
    setResult(null);
    setErr(null);
    const body: Record<string, unknown> =
      channel === "chat-stream"
        ? { userInput: input, chatHistory: [], context: {}, goals: [], todayTasks: [], activeReminders: [] }
        : channel === "home-chat-stream"
          ? { userInput: input, chatHistory: [] }
          : { userInput: input, goalId, chatHistory: [] };
    try {
      await postSseStream<StreamResult>(
        CHANNEL_PATHS[channel],
        body,
        {
          onDelta: (t) => setStream((s) => s + t),
          onDone: (r) => {
            setResult(r);
            if (r?.intents && Array.isArray(r.intents)) {
              for (const intent of r.intents) {
                void dispatchChatIntent(intent as never, run as never);
              }
            }
          },
          onError: (m) => setErr(m),
        },
      );
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function clearHome() {
    try {
      await run("command:clear-home-chat", {});
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <aside className="chat-panel" data-testid="chat-panel">
      <h2>AI chat</h2>
      <label data-testid="chat-channel-label">
        channel:
        <select
          className="chat-channel-select"
          data-testid="chat-channel-select"
          value={channel}
          onChange={(e) => setChannel(e.target.value as ChatChannel)}
        >
          <option value="chat-stream">chat-stream</option>
          <option value="home-chat-stream">home-chat-stream</option>
          <option value="goal-plan-chat-stream">goal-plan-chat-stream</option>
        </select>
      </label>
      {channel === "goal-plan-chat-stream" && (
        <label data-testid="chat-goal-id-label">
          goalId:
          <input
            className="chat-goal-id-input"
            data-testid="chat-goal-id-input"
            value={goalId}
            onChange={(e) => setGoalId(e.target.value)}
            placeholder="goal-…"
          />
        </label>
      )}
      <textarea
        className="chat-input-textarea"
        data-testid="chat-input"
        rows={4}
        cols={40}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="message…"
      />
      <div className="chat-buttons" data-testid="chat-buttons">
        <button className="chat-send-button" data-testid="chat-send" disabled={busy} onClick={send}>
          send
        </button>
        <button className="chat-clear-home-button" data-testid="chat-clear-home" onClick={clearHome}>
          clear-home-chat
        </button>
      </div>
      <h3>stream</h3>
      <pre className="chat-stream-output" data-testid="chat-stream-output">{stream}</pre>
      <h3>done payload</h3>
      <pre className="chat-stream-done" data-testid="chat-stream-done">
        {result ? JSON.stringify(result, null, 2) : "(pending)"}
      </pre>
      {err && <pre className="chat-error" data-testid="chat-error">error: {err}</pre>}
    </aside>
  );
}
