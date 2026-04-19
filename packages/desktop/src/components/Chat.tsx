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

export default function Chat() {
  const [input, setInput] = useState("");
  const [stream, setStream] = useState("");
  const [result, setResult] = useState<StreamResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { run } = useCommand();

  async function send() {
    if (!input.trim()) return;
    setBusy(true);
    setStream("");
    setResult(null);
    setErr(null);
    try {
      await postSseStream<StreamResult>(
        "/ai/chat/stream",
        { userInput: input, chatHistory: [], context: {}, goals: [], todayTasks: [], activeReminders: [] },
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
    <aside style={{ borderLeft: "1px solid #ccc", padding: 8 }}>
      <h2>/ai/chat/stream</h2>
      <textarea
        rows={4}
        cols={40}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="message…"
      />
      <div>
        <button disabled={busy} onClick={send}>
          send
        </button>
        <button onClick={clearHome}>clear-home-chat</button>
      </div>
      <h3>stream</h3>
      <pre style={{ whiteSpace: "pre-wrap" }}>{stream}</pre>
      <h3>done payload</h3>
      <pre>{result ? JSON.stringify(result, null, 2) : "(pending)"}</pre>
      {err && <pre>error: {err}</pre>}
    </aside>
  );
}
