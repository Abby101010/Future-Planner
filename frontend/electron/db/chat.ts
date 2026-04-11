/* NorthStar — chat_sessions + chat_attachments tables */

import path from "node:path";
import fs from "node:fs";
import { app } from "electron";
import { getDB } from "./connection";

export interface DBChatSession {
  id: string;
  title: string;
  messages: string; // JSON array
  created_at: string;
  updated_at: string;
}

export interface DBChatAttachment {
  id: string;
  session_id: string;
  message_id: string;
  filename: string;
  mime_type: string;
  file_path: string;
  file_type: string;
  size_bytes: number;
  created_at: string;
}

export function getAllChatSessions(): DBChatSession[] {
  const d = getDB();
  return d
    .prepare("SELECT * FROM chat_sessions ORDER BY updated_at DESC")
    .all() as DBChatSession[];
}

export function upsertChatSession(session: {
  id: string;
  title: string;
  messages: string;
  createdAt: string;
  updatedAt: string;
}): void {
  const d = getDB();
  d.prepare(
    `INSERT INTO chat_sessions (id, title, messages, created_at, updated_at)
     VALUES (?,?,?,?,?)
     ON CONFLICT (id) DO UPDATE SET
       title=excluded.title, messages=excluded.messages,
       updated_at=excluded.updated_at`,
  ).run(
    session.id,
    session.title,
    session.messages,
    session.createdAt,
    session.updatedAt,
  );
}

export function deleteChatSession(id: string): void {
  const d = getDB();
  d.prepare("DELETE FROM chat_sessions WHERE id = ?").run(id);
  d.prepare("DELETE FROM chat_attachments WHERE session_id = ?").run(id);
}

export function insertChatAttachment(att: {
  id: string;
  sessionId: string;
  messageId: string;
  filename: string;
  mimeType: string;
  filePath: string;
  fileType: string;
  sizeBytes: number;
}): void {
  const d = getDB();
  d.prepare(
    `INSERT INTO chat_attachments (id, session_id, message_id, filename, mime_type, file_path, file_type, size_bytes)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(
    att.id,
    att.sessionId,
    att.messageId,
    att.filename,
    att.mimeType,
    att.filePath,
    att.fileType,
    att.sizeBytes,
  );
}

export function getAttachmentsForSession(
  sessionId: string,
): DBChatAttachment[] {
  const d = getDB();
  return d
    .prepare(
      "SELECT * FROM chat_attachments WHERE session_id = ? ORDER BY created_at",
    )
    .all(sessionId) as DBChatAttachment[];
}

export function getAttachmentsDir(): string {
  const isDev = !app.isPackaged;
  const base = isDev
    ? path.join(app.getPath("userData"), "dev-data")
    : app.getPath("userData");
  const dir = path.join(base, "attachments");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
