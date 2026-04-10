/* ──────────────────────────────────────────────────────────
   NorthStar — Repository layer

   Typed wrappers around `window.electronAPI.invoke(channel, …)`.
   This is the ONLY layer in the renderer that should call the
   raw IPC bridge — pages, components, and the Zustand store
   import from here so the channel name + payload shape live in
   exactly one place.

   Adding a new IPC channel?
     1. Register it in electron/ipc/<domain>Ipc.ts (or main.ts)
     2. Add a thin wrapper here
     3. Import the wrapper from your page/store/component
   ────────────────────────────────────────────────────────── */

import type {
  MemorySummary,
  Reminder,
  ChatSession,
  MonthlyContext,
} from "../types";

// ── Generic helper ──────────────────────────────────────

async function invoke<T>(channel: string, payload?: unknown): Promise<T> {
  return (await window.electronAPI.invoke(channel, payload)) as T;
}

// ── App data (full store snapshot) ──────────────────────

export const appDataRepo = {
  load(): Promise<unknown> {
    return invoke("store:load");
  },
  save(data: unknown): Promise<unknown> {
    return invoke("store:save", data);
  },
};

// ── Memory ──────────────────────────────────────────────

export const memoryRepo = {
  async getSummary(): Promise<MemorySummary | null> {
    const r = await invoke<{ ok: boolean; data?: MemorySummary }>("memory:summary");
    return r.ok && r.data ? r.data : null;
  },
  recordChatInsight(input: { userMessage: string; aiReply: string }): Promise<unknown> {
    return invoke("memory:chat-insight", input);
  },
};

// ── Reminders ───────────────────────────────────────────

export const reminderRepo = {
  async list(): Promise<Reminder[]> {
    const r = await invoke<{ ok?: boolean; data?: Reminder[] }>("reminder:list");
    return r.ok && r.data ? r.data : [];
  },
  upsert(reminder: Reminder): Promise<unknown> {
    return invoke("reminder:upsert", {
      id: reminder.id,
      title: reminder.title,
      description: reminder.description,
      reminderTime: reminder.reminderTime,
      date: reminder.date,
      acknowledged: reminder.acknowledged,
      repeat: reminder.repeat,
      source: reminder.source,
    });
  },
  acknowledge(id: string): Promise<unknown> {
    return invoke("reminder:acknowledge", { id });
  },
  delete(id: string): Promise<unknown> {
    return invoke("reminder:delete", { id });
  },
};

// ── Chat sessions + attachments ─────────────────────────

interface SaveAttachmentInput {
  id: string;
  sessionId: string;
  messageId: string;
  filename: string;
  mimeType: string;
  fileType: string;
  base64: string;
}

export const chatRepo = {
  saveSession(session: ChatSession): Promise<unknown> {
    return invoke("chat:save-session", session);
  },
  deleteSession(id: string): Promise<unknown> {
    return invoke("chat:delete-session", { id });
  },
  async listSessions(): Promise<ChatSession[]> {
    const r = await invoke<{ ok?: boolean; data?: ChatSession[] }>("chat:list-sessions");
    return r.ok && r.data ? r.data : [];
  },
  saveAttachment(att: SaveAttachmentInput): Promise<unknown> {
    return invoke("chat:save-attachment", att);
  },
};

// ── Monthly context ─────────────────────────────────────

interface AnalyzeMonthlyContextInput {
  month: string;
  description: string;
}

export interface MonthlyContextAnalysis {
  intensity?: string;
  intensityReasoning?: string;
  capacityMultiplier?: number;
  maxDailyTasks?: number;
  error?: string;
}

export const monthlyContextRepo = {
  analyze(input: AnalyzeMonthlyContextInput): Promise<MonthlyContextAnalysis> {
    return invoke<MonthlyContextAnalysis>("monthly-context:analyze", input);
  },
  upsert(ctx: Omit<MonthlyContext, "updatedAt"> | MonthlyContext): Promise<unknown> {
    return invoke("monthly-context:upsert", ctx);
  },
  delete(month: string): Promise<unknown> {
    return invoke("monthly-context:delete", { month });
  },
};

// ── Model config ────────────────────────────────────────

export const modelConfigRepo = {
  get(): Promise<unknown> {
    return invoke("model-config:get");
  },
  setOverrides(tiers: unknown): Promise<unknown> {
    return invoke("model-config:set-overrides", tiers);
  },
};
