/* ChatSessionsPage — raw controls for /chat/list-sessions,
 * /chat/save-session, /chat/delete-session. */

import { useState } from "react";
import { postJson } from "../../services/transport";

type Session = Record<string, unknown> & { id?: string; title?: string };

export default function ChatSessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [saveBody, setSaveBody] = useState(
    JSON.stringify({ id: "", title: "", messages: [] }, null, 2),
  );
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    setError("");
    try {
      const res = await postJson<{ sessions?: Session[] } | Session[]>("/chat/list-sessions", {});
      const list = Array.isArray(res) ? res : res?.sessions ?? [];
      setSessions(list);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function save() {
    setStatus("…");
    try {
      await postJson("/chat/save-session", JSON.parse(saveBody));
      setStatus("ok");
      await refresh();
    } catch (e) {
      setStatus(`error: ${(e as Error).message}`);
    }
  }

  async function del(id: string) {
    try {
      await postJson("/chat/delete-session", { id });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <section className="chat-sessions-page" data-testid="chat-sessions-page">
      <h1>chat sessions</h1>
      <div>
        <button data-testid="chat-sessions-refresh" onClick={refresh}>
          POST /chat/list-sessions
        </button>
      </div>
      {error && <pre data-testid="chat-sessions-error">error: {error}</pre>}
      <ul data-testid="chat-sessions-list">
        {sessions.map((s, i) => {
          const id = String(s.id ?? i);
          return (
            <li key={id} data-testid={`chat-session-${id}`}>
              <code>{id}</code> — {String(s.title ?? "")}
              <button
                data-testid={`chat-session-delete-${id}`}
                onClick={() => del(id)}
              >
                delete
              </button>
            </li>
          );
        })}
      </ul>
      <h2>save-session</h2>
      <textarea
        className="chat-sessions-save-textarea"
        data-testid="chat-sessions-save-args"
        rows={6}
        cols={60}
        value={saveBody}
        onChange={(e) => setSaveBody(e.target.value)}
      />
      <div>
        <button data-testid="chat-sessions-save" onClick={save}>
          POST /chat/save-session
        </button>
        <span data-testid="chat-sessions-save-status">&nbsp;{status}</span>
      </div>
    </section>
  );
}
