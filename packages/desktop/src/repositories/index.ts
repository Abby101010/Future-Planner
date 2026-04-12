/* ──────────────────────────────────────────────────────────
   NorthStar — Repository layer

   Typed wrappers around the cloud HTTP transport. Every call
   routes through cloudInvoke → Fly.io backend → Supabase.
   No local database. No IPC fallback.

   Adding a new channel?
     1. Add a route in backend/src/routes/<domain>.ts
     2. Add a thin wrapper here
     3. Import the wrapper from your page/store/component
   ────────────────────────────────────────────────────────── */

import type {
  MemorySummary,
  Reminder,
  ChatSession,
  MonthlyContext,
  Goal,
  CalendarEvent,
  DailyLog,
  UserProfile,
  DailyTask,
  GoalPlanMessage,
  HomeChatMessage,
} from "@northstar/core";
import { cloudInvoke } from "../services/cloudTransport";

async function invoke<T>(channel: string, payload?: unknown): Promise<T> {
  return cloudInvoke<T>(channel, payload);
}

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

// ── Entity creation (backend-assigned IDs + defaults) ──
//
// Every entity creation path the renderer used to handle inline
// (goal-${Date.now()}, evt-${Date.now()}, user-${Date.now()}, etc.)
// now goes through one of these wrappers so the backend owns IDs
// and defaulting. The returned entity is fully populated and the
// store setter is a pure reconciliation — no client-side defaulting.

interface NewGoalInput {
  title: string;
  description: string;
  targetDate: string;
  isHabit: boolean;
  importance: string;
  scope: string;
  goalType: string;
  scopeReasoning: string;
  suggestedTasks?: Array<{
    title: string;
    description?: string;
    durationMinutes?: number;
    priority?: string;
    category?: string;
  }>;
  repeatSchedule?: unknown;
  suggestedTimeSlot?: string;
  goalSlot?: "primary" | "secondary" | "personal" | null;
}

export const entitiesRepo = {
  async newGoal(input: NewGoalInput): Promise<Goal> {
    const r = await invoke<{ ok: boolean; goal?: Goal; error?: string }>(
      "entities:new-goal",
      input,
    );
    if (!r.ok || !r.goal) throw new Error(r.error || "newGoal failed");
    return r.goal;
  },
  async newEvent(input: Partial<CalendarEvent>): Promise<CalendarEvent> {
    const r = await invoke<{
      ok: boolean;
      event?: CalendarEvent;
      error?: string;
    }>("entities:new-event", input);
    if (!r.ok || !r.event) throw new Error(r.error || "newEvent failed");
    return r.event;
  },
  async newUser(input: Partial<UserProfile>): Promise<UserProfile> {
    const r = await invoke<{
      ok: boolean;
      user?: UserProfile;
      error?: string;
    }>("entities:new-user", input);
    if (!r.ok || !r.user) throw new Error(r.error || "newUser failed");
    return r.user;
  },
  async newLog(input: Partial<DailyLog>): Promise<DailyLog> {
    const r = await invoke<{ ok: boolean; log?: DailyLog; error?: string }>(
      "entities:new-log",
      input,
    );
    if (!r.ok || !r.log) throw new Error(r.error || "newLog failed");
    return r.log;
  },
  async newChatSession(
    input: Partial<ChatSession>,
  ): Promise<ChatSession> {
    const r = await invoke<{
      ok: boolean;
      session?: ChatSession;
      error?: string;
    }>("entities:new-chat-session", input);
    if (!r.ok || !r.session)
      throw new Error(r.error || "newChatSession failed");
    return r.session;
  },
  async newChatMessage(input: {
    role: "user" | "assistant";
    content: string;
  }): Promise<HomeChatMessage & GoalPlanMessage> {
    const r = await invoke<{
      ok: boolean;
      message?: HomeChatMessage & GoalPlanMessage;
      error?: string;
    }>("entities:new-chat-message", input);
    if (!r.ok || !r.message)
      throw new Error(r.error || "newChatMessage failed");
    return r.message;
  },
  async newBehaviorEntry(
    content: string,
  ): Promise<{ id: string; content: string; createdAt: string }> {
    const r = await invoke<{
      ok: boolean;
      entry?: { id: string; content: string; createdAt: string };
      error?: string;
    }>("entities:new-behavior-entry", { content });
    if (!r.ok || !r.entry)
      throw new Error(r.error || "newBehaviorEntry failed");
    return r.entry;
  },
  async newConfirmedTask(
    input: Partial<DailyTask> & {
      isScheduledToday?: boolean;
      currentTasks?: Array<{
        cognitiveWeight?: number;
        durationMinutes?: number;
        priority?: string;
      }>;
    },
  ): Promise<DailyTask> {
    const r = await invoke<{
      ok: boolean;
      task?: DailyTask;
      error?: string;
    }>("entities:new-confirmed-task", input);
    if (!r.ok || !r.task)
      throw new Error(r.error || "newConfirmedTask failed");
    return r.task;
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
