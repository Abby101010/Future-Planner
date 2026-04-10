/* NorthStar — memory:* IPC handlers (15 channels) */

import { ipcMain } from "electron";
import {
  loadMemory,
  saveMemory,
  getMemorySummary,
  getBehaviorProfile,
  saveBehaviorProfile,
} from "../memory";
import {
  captureSignal,
  captureSnooze,
  captureTaskTiming,
  captureExplicitFeedback,
  captureChatInsight,
  quickReflect,
  runReflection,
  generateNudges,
  shouldAutoReflect,
} from "../reflection";
import { dbClearMemory } from "../database";
import { getIpcContext } from "./context";

export function registerMemoryIpc(): void {
  const ctx = getIpcContext();

  // Get memory summary for UI display
  ipcMain.handle("memory:summary", () => {
    try {
      const memory = loadMemory();
      return { ok: true, data: getMemorySummary(memory) };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // Get full memory (for settings / debug)
  ipcMain.handle("memory:load", () => {
    try {
      return { ok: true, data: loadMemory() };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // Clear all memory (reset)
  ipcMain.handle("memory:clear", async () => {
    try {
      saveMemory({
        facts: [],
        preferences: [],
        signals: [],
        snoozeRecords: [],
        taskTimings: [],
        lastReflectionAt: null,
        reflectionCount: 0,
        version: 1,
      });
      if (ctx.isDbAvailable()) {
        await dbClearMemory().catch((err: unknown) =>
          console.warn("[DB] Failed to clear memory in DB:", err),
        );
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // Record a behavioral signal from the renderer
  ipcMain.handle("memory:signal", (_event, payload) => {
    try {
      captureSignal(payload.type, payload.context, payload.value);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // Record task completion with timing
  ipcMain.handle("memory:task-completed", (_event, payload) => {
    try {
      quickReflect("task_completed", {
        taskTitle: payload.taskTitle,
        taskCategory: payload.taskCategory,
        completionTime: payload.actualMinutes,
        estimatedTime: payload.estimatedMinutes,
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // Record task snooze
  ipcMain.handle("memory:task-snoozed", (_event, payload) => {
    try {
      captureSnooze(payload.taskTitle, payload.taskCategory, payload.date);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // Record task skip
  ipcMain.handle("memory:task-skipped", (_event, payload) => {
    try {
      quickReflect("task_skipped", {
        taskTitle: payload.taskTitle,
        taskCategory: payload.taskCategory,
        date: payload.date,
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // Explicit user feedback
  ipcMain.handle("memory:feedback", (_event, payload) => {
    try {
      captureExplicitFeedback(
        payload.context,
        payload.feedback,
        payload.isPositive,
      );
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // Extract behavioral insights from home chat exchanges
  ipcMain.handle("memory:chat-insight", (_event, payload) => {
    try {
      captureChatInsight(payload.userMessage, payload.aiReply);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // Trigger a full reflection (AI-powered analysis)
  ipcMain.handle("memory:reflect", async (_event, payload) => {
    try {
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      let apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        const data = ctx.loadDataSync();
        const user = data.user as Record<string, unknown> | undefined;
        const settings = user?.settings as
          | Record<string, unknown>
          | undefined;
        apiKey = settings?.apiKey as string | undefined;
      }
      if (!apiKey) return { ok: false, error: "No API key" };

      const client = new Anthropic({ apiKey });
      const result = await runReflection(client, payload?.trigger || "manual");
      return { ok: true, data: result };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // ── Contextual Nudge Engine ────────────────────────────

  ipcMain.handle("memory:nudges", (_event, payload) => {
    try {
      const tasks = (payload?.tasks || []) as Array<{
        id: string;
        title: string;
        category: string;
        durationMinutes: number;
        completed: boolean;
        completedAt?: string;
        startedAt?: string;
        actualMinutes?: number;
        snoozedCount?: number;
        skipped?: boolean;
        priority: string;
      }>;
      const proactiveQuestion = payload?.proactiveQuestion as
        | string
        | null
        | undefined;
      const nudges = generateNudges(tasks, proactiveQuestion);
      return { ok: true, data: nudges };
    } catch (err) {
      return { ok: false, error: String(err), data: [] };
    }
  });

  // Check if auto-reflection should trigger
  ipcMain.handle("memory:should-reflect", () => {
    try {
      return { ok: true, shouldReflect: shouldAutoReflect() };
    } catch (err) {
      return { ok: false, shouldReflect: false, error: String(err) };
    }
  });

  // Record task timing from a completed timer
  ipcMain.handle("memory:task-timing", (_event, payload) => {
    try {
      captureTaskTiming(
        payload.taskCategory,
        payload.taskTitle,
        payload.estimatedMinutes,
        payload.actualMinutes,
      );
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // Get human-readable behavior profile for settings UI
  ipcMain.handle("memory:behavior-profile", () => {
    try {
      const entries = getBehaviorProfile();
      return { ok: true, data: entries };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // Save user-edited behavior profile back to memory
  ipcMain.handle("memory:save-behavior-profile", (_event, payload) => {
    try {
      saveBehaviorProfile(payload.entries);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });
}
