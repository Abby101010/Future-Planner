/* NorthStar backend — chat session routes
 *
 * HTTP mirror of frontend/electron/ipc/chat.ts. Sessions and attachments
 * both live in Postgres now (slice 5: bytes stored inline as bytea — no
 * separate object store). Scoped by req.userId.
 *
 * Response envelopes match the IPC handlers byte-for-byte so the renderer's
 * chatRepo wrappers don't need to know whether they're talking to local IPC
 * or to the cloud.
 */

import { Router } from "express";
import { query } from "../db/pool";
import { asyncHandler } from "../middleware/errorHandler";

export const chatRouter = Router();

interface ChatSessionRow {
  id: string;
  title: string;
  messages: unknown; // jsonb — pg returns it pre-parsed
  created_at: string;
  updated_at: string;
}

// POST /chat/list-sessions — return all sessions for the user
chatRouter.post(
  "/list-sessions",
  asyncHandler(async (req, res) => {
    const rows = await query<ChatSessionRow>(
      `select id, title, messages, created_at, updated_at
         from chat_sessions
        where user_id = $1
        order by updated_at desc`,
      [req.userId],
    );
    res.json({
      ok: true,
      data: rows.map((s) => ({
        id: s.id,
        title: s.title,
        // pg returns jsonb as a parsed object/array already; only parse if it
        // somehow came back as a string (defensive against driver quirks).
        messages:
          typeof s.messages === "string"
            ? JSON.parse(s.messages as string)
            : s.messages,
        createdAt: s.created_at,
        updatedAt: s.updated_at,
      })),
    });
  }),
);

// POST /chat/save-session — upsert one session (rename to title, replace messages)
chatRouter.post(
  "/save-session",
  asyncHandler(async (req, res) => {
    const p = (req.body ?? {}) as {
      id: string;
      title: string;
      messages: unknown;
      createdAt?: string;
      updatedAt?: string;
    };
    if (!p.id || typeof p.id !== "string") {
      res.status(400).json({ ok: false, error: "id is required" });
      return;
    }
    // Messages from the renderer arrive as a JS array — let pg's jsonb cast
    // handle it. We accept either an already-stringified payload (old IPC
    // shape) or a structured value.
    const messagesJson =
      typeof p.messages === "string" ? p.messages : JSON.stringify(p.messages);
    const createdAt = p.createdAt || new Date().toISOString();
    const updatedAt = p.updatedAt || new Date().toISOString();
    await query(
      `insert into chat_sessions (id, user_id, title, messages, created_at, updated_at)
            values ($1, $2, $3, $4::jsonb, $5, $6)
       on conflict (user_id, id) do update set
            title = excluded.title,
            messages = excluded.messages,
            updated_at = excluded.updated_at`,
      [p.id, req.userId, p.title || "New chat", messagesJson, createdAt, updatedAt],
    );
    res.json({ ok: true });
  }),
);

// POST /chat/delete-session — delete session + cascade attachments rows
chatRouter.post(
  "/delete-session",
  asyncHandler(async (req, res) => {
    const p = (req.body ?? {}) as { id: string };
    if (!p.id) {
      res.status(400).json({ ok: false, error: "id is required" });
      return;
    }
    // Drop attachments first so we don't leave dangling rows. Bytes live
    // inline (slice 5) so deleting the row reclaims the storage.
    await query(
      `delete from chat_attachments where user_id = $1 and session_id = $2`,
      [req.userId, p.id],
    );
    await query(
      `delete from chat_sessions where user_id = $1 and id = $2`,
      [req.userId, p.id],
    );
    res.json({ ok: true });
  }),
);

// POST /chat/save-attachment — store one attachment inline as bytea
chatRouter.post(
  "/save-attachment",
  asyncHandler(async (req, res) => {
    const p = (req.body ?? {}) as {
      id: string;
      sessionId: string;
      messageId: string;
      filename: string;
      mimeType: string;
      fileType?: string;
      base64: string;
    };
    if (!p.id || !p.sessionId || !p.messageId || typeof p.base64 !== "string") {
      res
        .status(400)
        .json({ ok: false, error: "id, sessionId, messageId, base64 are required" });
      return;
    }
    const buf = Buffer.from(p.base64, "base64");
    await query(
      `insert into chat_attachments
         (id, user_id, session_id, message_id, filename, mime_type,
          file_path, file_type, size_bytes, bytes)
       values ($1, $2, $3, $4, $5, $6, null, $7, $8, $9)
       on conflict (user_id, id) do update set
         session_id = excluded.session_id,
         message_id = excluded.message_id,
         filename   = excluded.filename,
         mime_type  = excluded.mime_type,
         file_type  = excluded.file_type,
         size_bytes = excluded.size_bytes,
         bytes      = excluded.bytes`,
      [
        p.id,
        req.userId,
        p.sessionId,
        p.messageId,
        p.filename,
        p.mimeType,
        p.fileType || "image",
        buf.length,
        buf,
      ],
    );
    res.json({ ok: true });
  }),
);

interface AttachmentRow {
  id: string;
  session_id: string;
  message_id: string;
  filename: string;
  mime_type: string;
  file_type: string;
  size_bytes: number;
  bytes: Buffer | null;
  created_at: string;
}

// POST /chat/get-attachments — list all attachments for a session
chatRouter.post(
  "/get-attachments",
  asyncHandler(async (req, res) => {
    const p = (req.body ?? {}) as { sessionId: string };
    if (!p.sessionId) {
      res.status(400).json({ ok: false, error: "sessionId is required" });
      return;
    }
    const rows = await query<AttachmentRow>(
      `select id, session_id, message_id, filename, mime_type, file_type,
              size_bytes, bytes, created_at
         from chat_attachments
        where user_id = $1 and session_id = $2
        order by created_at asc`,
      [req.userId, p.sessionId],
    );
    res.json({
      ok: true,
      data: rows.map((r) => ({
        id: r.id,
        sessionId: r.session_id,
        messageId: r.message_id,
        filename: r.filename,
        mimeType: r.mime_type,
        fileType: r.file_type,
        sizeBytes: r.size_bytes,
        base64: r.bytes ? r.bytes.toString("base64") : "",
        createdAt: r.created_at,
      })),
    });
  }),
);
