/* Starward server — entity creation routes
 *
 * HTTP mirror of electron/ipc/entities.ts. Backend-authoritative construction
 * for every entity the renderer used to build with `${kind}-${Date.now()}` IDs
 * and inline defaults. These routes assign IDs (randomUUID), timestamps, and
 * domain defaults.
 *
 * Each handler takes partial form data and returns a fully-populated entity
 * wrapped in { ok: true, <entity>: {...} }. Shapes match IPC responses exactly
 * so src/repositories/index.ts → entitiesRepo unmarshals without changes.
 *
 * COGNITIVE BUDGET: the downgrade rule from shared/domain/cognitiveBudget.ts
 * runs here for confirmed tasks. Same function, same inputs as the Electron
 * version — byte-identical behavior.
 *
 * PER-USER SCOPING: entity creation doesn't yet write to any user-scoped
 * tables (the created entity flows back to the renderer which writes it to
 * app_store via store:save). That means these routes are technically
 * user-agnostic today. When phase 1b migrates goals/logs/etc into their own
 * per-user tables, these routes will gain user_id in their inserts.
 */

import { Router } from "express";
import { randomUUID } from "node:crypto";
import {
  downgradeIfOverBudget,
  type TaskPriority,
} from "@starward/core";
import { asyncHandler } from "../middleware/errorHandler";

export const entitiesRouter = Router();

const nowIso = () => new Date().toISOString();

// Minimal flat-plan types (mirror electron/ipc/entities.ts)
interface GoalPlanTask {
  id: string;
  title: string;
  description?: string;
  durationMinutes?: number;
  priority?: string;
  category?: string;
  completed: boolean;
}
interface GoalPlanSection {
  id: string;
  title: string;
  content: string;
  order: number;
  tasks: GoalPlanTask[];
}

// ── Goal creation ────────────────────────────────────────
entitiesRouter.post(
  "/new-goal",
  asyncHandler(async (req, res) => {
    const p = (req.body ?? {}) as Record<string, unknown>;
    const title = String(p.title || "").trim();
    const description = String(p.description || "").trim();
    const targetDate = String(p.targetDate || "");
    const isHabit = Boolean(p.isHabit);
    const importance = String(p.importance || "medium");
    const scope = String(p.scope || "big");
    const goalType = String(p.goalType || "big");
    const scopeReasoning = String(p.scopeReasoning || "");
    const suggestedTasks = (p.suggestedTasks || []) as Array<{
      title: string;
      description?: string;
      durationMinutes?: number;
      priority?: string;
      category?: string;
    }>;
    const repeatSchedule = p.repeatSchedule ?? null;
    const suggestedTimeSlot =
      typeof p.suggestedTimeSlot === "string" ? p.suggestedTimeSlot : undefined;

    const id = randomUUID();
    const now = nowIso();

    // Match the renderer's prior behavior: everyday and repeating goals start
    // active + confirmed; big goals start pending.
    const status =
      goalType === "everyday" || goalType === "repeating" ? "active" : "pending";
    const planConfirmed = goalType === "everyday" || goalType === "repeating";

    let flatPlan: GoalPlanSection[] | null = null;
    if (goalType === "everyday" && suggestedTasks.length > 0) {
      flatPlan = [
        {
          id: randomUUID(),
          title,
          content: "",
          order: 1,
          tasks: suggestedTasks.map((task) => ({
            id: randomUUID(),
            title: task.title,
            description: task.description,
            durationMinutes: task.durationMinutes,
            priority: task.priority,
            category: task.category,
            completed: false,
          })),
        },
      ];
    }

    const goal = {
      id,
      title,
      description,
      targetDate,
      isHabit,
      importance,
      scope,
      goalType,
      status,
      createdAt: now,
      updatedAt: now,
      planChat: [],
      plan: null,
      flatPlan,
      planConfirmed,
      scopeReasoning,
      repeatSchedule,
      suggestedTimeSlot,
    };
    res.json({ ok: true, goal });
  }),
);

// ── Calendar event creation ──────────────────────────────
entitiesRouter.post(
  "/new-event",
  asyncHandler(async (req, res) => {
    const p = (req.body ?? {}) as Record<string, unknown>;
    const startDate = String(p.startDate || nowIso());
    const endDate = String(
      p.endDate ||
        new Date(new Date(startDate).getTime() + 60 * 60 * 1000).toISOString(),
    );
    const durationMs =
      new Date(endDate).getTime() - new Date(startDate).getTime();

    const allowed = new Set([
      "work",
      "personal",
      "health",
      "social",
      "travel",
      "focus",
      "other",
    ]);
    const rawCategory = String(p.category || "other");
    const category = allowed.has(rawCategory) ? rawCategory : "other";

    const allowedSources = new Set([
      "manual",
      "device-calendar",
      "device-reminders",
    ]);
    const rawSource = String(p.source || "manual");
    const source = allowedSources.has(rawSource) ? rawSource : "manual";

    const event = {
      id: randomUUID(),
      title: String(p.title || ""),
      startDate,
      endDate,
      isAllDay: Boolean(p.isAllDay),
      durationMinutes:
        typeof p.durationMinutes === "number"
          ? p.durationMinutes
          : Math.round(durationMs / 60000),
      category,
      isVacation: Boolean(p.isVacation),
      source,
      sourceCalendar:
        typeof p.sourceCalendar === "string" ? p.sourceCalendar : undefined,
      color: typeof p.color === "string" ? p.color : undefined,
      notes: typeof p.notes === "string" ? p.notes : undefined,
    };
    res.json({ ok: true, event });
  }),
);

// ── User creation (onboarding) ───────────────────────────
entitiesRouter.post(
  "/new-user",
  asyncHandler(async (req, res) => {
    const p = (req.body ?? {}) as Record<string, unknown>;
    const settings = (p.settings || {}) as Record<string, unknown>;
    const user = {
      id: randomUUID(),
      name: String(p.name || ""),
      age: typeof p.age === "number" ? p.age : undefined,
      currentRole:
        typeof p.currentRole === "string" ? p.currentRole : undefined,
      education:
        typeof p.education === "string" ? p.education : undefined,
      location: typeof p.location === "string" ? p.location : undefined,
      goalRaw: String(p.goalRaw || ""),
      context: typeof p.context === "string" ? p.context : undefined,
      timeAvailable:
        typeof p.timeAvailable === "string" ? p.timeAvailable : undefined,
      constraints:
        typeof p.constraints === "string" ? p.constraints : undefined,
      moodBaseline:
        typeof p.moodBaseline === "string" ? p.moodBaseline : undefined,
      onboardingComplete: Boolean(p.onboardingComplete),
      createdAt: nowIso(),
      settings: {
        enableNewsFeed: Boolean(settings.enableNewsFeed),
        dailyReminderTime:
          typeof settings.dailyReminderTime === "string"
            ? settings.dailyReminderTime
            : undefined,
        theme: (settings.theme as string) || "system",
        language: (settings.language as string) || "en",
        // Phase 1 note: apiKey is ignored by the server AI client, which
        // reads ANTHROPIC_API_KEY from env. We still accept it here so the
        // renderer's onboarding flow works unchanged.
        apiKey:
          typeof settings.apiKey === "string" ? settings.apiKey : undefined,
        modelOverrides:
          (settings.modelOverrides as Record<string, string>) || undefined,
      },
    };
    res.json({ ok: true, user });
  }),
);

// ── Daily log creation ───────────────────────────────────
entitiesRouter.post(
  "/new-log",
  asyncHandler(async (req, res) => {
    const p = (req.body ?? {}) as Record<string, unknown>;
    const log = {
      id: randomUUID(),
      userId: req.userId,
      date: String(p.date || nowIso().split("T")[0]),
      tasks: Array.isArray(p.tasks) ? p.tasks : [],
      heatmapEntry: p.heatmapEntry || {
        date: p.date,
        completionRate: 0,
        momentumHit: false,
        tasksCompleted: 0,
        tasksTotal: 0,
      },
      notificationBriefing: String(p.notificationBriefing || ""),
      milestoneCelebration: p.milestoneCelebration ?? null,
      progress: p.progress || {
        tasksCompleted: 0,
        tasksTotal: 0,
        minutesCompleted: 0,
        minutesTotal: 0,
      },
      yesterdayRecap: p.yesterdayRecap ?? null,
      encouragement: String(p.encouragement || ""),
      createdAt: nowIso(),
    };
    res.json({ ok: true, log });
  }),
);

// ── Chat session creation ────────────────────────────────
entitiesRouter.post(
  "/new-chat-session",
  asyncHandler(async (req, res) => {
    const p = (req.body ?? {}) as Record<string, unknown>;
    const session = {
      id: randomUUID(),
      title: String(p.title || "New Chat"),
      messages: Array.isArray(p.messages) ? p.messages : [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    res.json({ ok: true, session });
  }),
);

// ── Chat message creation ────────────────────────────────
entitiesRouter.post(
  "/new-chat-message",
  asyncHandler(async (req, res) => {
    const p = (req.body ?? {}) as Record<string, unknown>;
    const message = {
      id: randomUUID(),
      role: String(p.role || "user"),
      content: String(p.content || ""),
      timestamp: nowIso(),
    };
    res.json({ ok: true, message });
  }),
);

// ── Behavior profile entry ───────────────────────────────
entitiesRouter.post(
  "/new-behavior-entry",
  asyncHandler(async (req, res) => {
    const p = (req.body ?? {}) as Record<string, unknown>;
    const entry = {
      id: randomUUID(),
      content: String(p.content || ""),
      createdAt: nowIso(),
    };
    res.json({ ok: true, entry });
  }),
);

// ── Confirmed task (from pending task analysis) ──────────
// Cognitive-budget enforcement runs here for tasks scheduled today. Same
// logic as electron/ipc/entities.ts — the shared/domain function is the
// single source of truth.
entitiesRouter.post(
  "/new-confirmed-task",
  asyncHandler(async (req, res) => {
    const p = (req.body ?? {}) as Record<string, unknown>;
    const requestedPriority = String(
      p.priority || "should-do",
    ) as TaskPriority;
    const durationMinutes =
      typeof p.durationMinutes === "number" ? p.durationMinutes : 30;
    const cognitiveWeight =
      typeof p.cognitiveWeight === "number" ? p.cognitiveWeight : 3;

    const isScheduledToday = Boolean(p.isScheduledToday);
    const currentTasks = (
      Array.isArray(p.currentTasks) ? p.currentTasks : []
    ) as Array<{
      cognitiveWeight?: number;
      durationMinutes?: number;
      priority?: string;
    }>;
    const finalPriority: TaskPriority = isScheduledToday
      ? downgradeIfOverBudget(
          currentTasks,
          { cognitiveWeight, durationMinutes },
          requestedPriority,
        )
      : requestedPriority;

    const task = {
      id: randomUUID(),
      title: String(p.title || ""),
      description: String(p.description || ""),
      durationMinutes,
      cognitiveWeight,
      whyToday: String(p.whyToday || ""),
      priority: finalPriority,
      isMomentumTask: Boolean(p.isMomentumTask),
      progressContribution: String(p.progressContribution || ""),
      category: String(p.category || "planning"),
      completed: false,
    };
    res.json({ ok: true, task });
  }),
);
