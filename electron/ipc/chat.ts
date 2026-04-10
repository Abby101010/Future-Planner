/* NorthStar — chat IPC handlers (chat:list-sessions/save-session/delete-session/save-attachment/get-attachments) */

import { ipcMain } from "electron";
import fs from "node:fs";
import path from "node:path";
import {
  getAllChatSessions,
  upsertChatSession,
  deleteChatSession,
  insertChatAttachment,
  getAttachmentsForSession,
  getAttachmentsDir,
} from "../database";

export function registerChatIpc(): void {
  ipcMain.handle("chat:list-sessions", () => {
    try {
      const sessions = getAllChatSessions();
      return {
        ok: true,
        data: sessions.map((s) => ({
          id: s.id,
          title: s.title,
          messages: JSON.parse(s.messages),
          createdAt: s.created_at,
          updatedAt: s.updated_at,
        })),
      };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("chat:save-session", (_event, payload) => {
    try {
      upsertChatSession({
        id: payload.id,
        title: payload.title,
        messages: JSON.stringify(payload.messages),
        createdAt: payload.createdAt,
        updatedAt: payload.updatedAt,
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("chat:delete-session", (_event, payload) => {
    try {
      // Also delete attachment files from disk
      const attachments = getAttachmentsForSession(payload.id);
      for (const att of attachments) {
        try {
          fs.unlinkSync(att.file_path);
        } catch {
          /* file may already be gone */
        }
      }
      deleteChatSession(payload.id);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("chat:save-attachment", (_event, payload) => {
    try {
      const dir = getAttachmentsDir();
      const ext = payload.filename.split(".").pop() || "bin";
      const safeName = `${payload.id}.${ext}`;
      const filePath = path.join(dir, safeName);

      const buffer = Buffer.from(payload.base64, "base64");
      fs.writeFileSync(filePath, buffer);

      insertChatAttachment({
        id: payload.id,
        sessionId: payload.sessionId,
        messageId: payload.messageId,
        filename: payload.filename,
        mimeType: payload.mimeType,
        filePath,
        fileType: payload.fileType,
        sizeBytes: buffer.length,
      });

      return { ok: true, filePath };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("chat:get-attachments", (_event, payload) => {
    try {
      const attachments = getAttachmentsForSession(payload.sessionId);
      return { ok: true, data: attachments };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });
}
