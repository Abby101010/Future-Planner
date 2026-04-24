/* ChatSessionsWindow — floating panel inside FloatingChat.
 *
 * Wires the five chat-session + attachment endpoints from the contract:
 *   - POST /chat/list-sessions
 *   - POST /chat/save-session
 *   - POST /chat/delete-session
 *   - POST /chat/save-attachment
 *   - POST /chat/get-attachments
 */

import { useEffect, useState } from "react";
import { postJson } from "../../services/transport";
import Icon from "../primitives/Icon";
import Button from "../primitives/Button";

interface Session {
  id: string;
  title?: string;
  updatedAt?: string;
  messages?: unknown[];
  count?: number;
}

interface Attachment {
  id: string;
  sessionId: string;
  messageId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  base64: string;
  createdAt: string;
}

export default function ChatSessionsWindow({ onClose }: { onClose: () => void }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [saveJson, setSaveJson] = useState<string>('{"title":"New session","messages":[]}');
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [messageId, setMessageId] = useState("");

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh() {
    setError("");
    try {
      const res = await postJson<{ data?: Session[]; sessions?: Session[] } | Session[]>(
        "/chat/list-sessions",
        {},
      );
      const list = Array.isArray(res) ? res : res?.data ?? res?.sessions ?? [];
      setSessions(list);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function save() {
    setStatus("…");
    try {
      await postJson("/chat/save-session", JSON.parse(saveJson));
      setStatus("saved");
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

  async function listAttachments(sessionId: string) {
    setError("");
    setSelectedSessionId(sessionId);
    try {
      const res = await postJson<{ data?: Attachment[] }>("/chat/get-attachments", { sessionId });
      setAttachments(res.data ?? []);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function saveAttachment(file: File) {
    if (!selectedSessionId || !messageId) {
      setError("Select a session + enter messageId first");
      return;
    }
    try {
      const buf = await file.arrayBuffer();
      let binary = "";
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const base64 = btoa(binary);
      await postJson("/chat/save-attachment", {
        id: `att-${Date.now()}`,
        sessionId: selectedSessionId,
        messageId,
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        fileType: file.type.startsWith("image/") ? "image" : "file",
        base64,
      });
      await listAttachments(selectedSessionId);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <aside
      data-testid="chat-sessions-window"
      style={{
        position: "fixed",
        right: 420,
        bottom: 88,
        width: 360,
        maxHeight: 560,
        background: "var(--bg-elev)",
        border: "1px solid var(--border)",
        borderRadius: "var(--r-lg)",
        boxShadow: "var(--shadow-3)",
        zIndex: 64,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <header
        style={{
          padding: "10px 14px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ fontSize: "var(--t-sm)", fontWeight: 600 }}>Chat sessions</div>
        <div style={{ display: "flex", gap: 4 }}>
          <Button
            size="xs"
            tone="ghost"
            icon="refresh"
            onClick={refresh}
            data-api="POST /chat/list-sessions"
            data-testid="chat-sessions-refresh"
          >
            Refresh
          </Button>
          <button
            onClick={onClose}
            style={{
              border: 0,
              background: "transparent",
              cursor: "pointer",
              color: "var(--fg-mute)",
              padding: 4,
            }}
          >
            <Icon name="x" size={13} />
          </button>
        </div>
      </header>

      <div style={{ flex: 1, overflow: "auto" }}>
        {sessions.length === 0 && (
          <div style={{ padding: 14, fontSize: "var(--t-sm)", color: "var(--fg-faint)" }}>
            No sessions yet.
          </div>
        )}
        {sessions.map((s) => (
          <div
            key={s.id}
            data-testid={`chat-session-${s.id}`}
            className="ns-row"
            style={{
              padding: "10px 14px",
              borderBottom: "1px solid var(--border-soft)",
              display: "flex",
              alignItems: "center",
              gap: 10,
              background: selectedSessionId === s.id ? "var(--bg-soft)" : "transparent",
              cursor: "pointer",
            }}
            onClick={() => listAttachments(s.id)}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: "var(--t-sm)",
                  fontWeight: 500,
                  color: "var(--user-color)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {s.title || s.id}
              </div>
              <div style={{ fontSize: 10, color: "var(--fg-faint)", marginTop: 2 }}>
                {s.count ?? s.messages?.length ?? 0} msgs{s.updatedAt ? ` · ${s.updatedAt}` : ""}
              </div>
            </div>
            <button
              data-testid={`chat-session-delete-${s.id}`}
              onClick={(e) => {
                e.stopPropagation();
                void del(s.id);
              }}
              className="ns-row-trail"
              title="Delete session"
              style={{
                border: 0,
                background: "transparent",
                cursor: "pointer",
                color: "var(--danger)",
                padding: 4,
              }}
            >
              <Icon name="trash" size={12} />
            </button>
          </div>
        ))}
      </div>

      {selectedSessionId && (
        <div style={{ padding: "8px 14px", borderTop: "1px solid var(--border)" }}>
          <div style={{ fontSize: 10, color: "var(--fg-faint)", marginBottom: 4 }}>
            Attachments for {selectedSessionId}
          </div>
          <input
            data-testid="chat-attachment-message-id"
            value={messageId}
            onChange={(e) => setMessageId(e.target.value)}
            placeholder="messageId"
            style={{
              width: "100%",
              padding: "4px 8px",
              fontSize: "var(--t-sm)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              fontFamily: "var(--font-mono)",
              marginBottom: 6,
            }}
          />
          <input
            type="file"
            data-testid="chat-attachment-file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void saveAttachment(f);
            }}
            style={{ fontSize: 10 }}
          />
          <ul style={{ listStyle: "none", margin: "6px 0 0", padding: 0, fontSize: 10 }}>
            {attachments.map((a) => (
              <li
                key={a.id}
                data-testid={`chat-attachment-${a.id}`}
                style={{ color: "var(--fg-mute)", fontFamily: "var(--font-mono)" }}
              >
                {a.filename} · {a.mimeType} · {a.sizeBytes}b
              </li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ padding: "8px 14px", borderTop: "1px solid var(--border)" }}>
        <textarea
          data-testid="chat-session-save-json"
          value={saveJson}
          onChange={(e) => setSaveJson(e.target.value)}
          rows={2}
          style={{
            width: "100%",
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            padding: 6,
            border: "1px solid var(--border)",
            borderRadius: 3,
            resize: "vertical",
          }}
        />
        <Button
          size="xs"
          tone="primary"
          onClick={save}
          data-api="POST /chat/save-session"
          data-testid="chat-session-save"
          style={{ marginTop: 6 }}
        >
          Save session
        </Button>
        {status && (
          <span style={{ marginLeft: 6, fontSize: 10, color: "var(--fg-faint)" }}>{status}</span>
        )}
      </div>
      {error && (
        <div
          data-testid="chat-sessions-error"
          style={{
            padding: "6px 12px",
            fontSize: 10,
            color: "var(--danger)",
            borderTop: "1px solid color-mix(in srgb, var(--danger) 20%, transparent)",
          }}
        >
          {error}
        </div>
      )}
    </aside>
  );
}
