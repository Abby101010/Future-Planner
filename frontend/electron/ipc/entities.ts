/* NorthStar — entity creation IPC handlers

   Backend-authoritative construction for every entity the renderer
   used to build with `${kind}-${Date.now()}` IDs and inline defaults.
   These handlers exist so the cloud migration can swap the transport
   without the renderer silently losing ID assignment / defaulting.

   Each handler takes partial form data and returns a fully-populated
   entity with:
     - a server-assigned UUID (node:crypto randomUUID)
     - server-assigned createdAt / updatedAt
     - any domain defaults the renderer used to apply inline

   No business-rule branching lives here. The renderer still decides
   when to call classifyGoal, when to import device events, etc. —
   this layer only owns the shape of the entity once the decision is
   made.
*/

import { ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import {
  downgradeIfOverBudget,
  type TaskPriority,
} from "../domain/cognitiveBudget";

// Shapes mirror src/types/index.ts. Duplicated rather than imported
// because electron/ is a separate tsconfig project.
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

export function registerEntitiesIpc(): void {
  const nowIso = () => new Date().toISOString();

  // ── Goal creation ───────────────────────────────────────
  // Accepts form data + classification result. Returns a fully-
  // populated Goal shape. For everyday goals with suggested tasks,
  // builds the flatPlan section with server-assigned section/task IDs.
  ipcMain.handle("entities:new-goal", async (_event, payload) => {
    try {
      const p = (payload || {}) as Record<string, unknown>;
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

      // Match the renderer's prior behavior: everyday and repeating
      // goals start active + confirmed; big goals start pending.
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
      return { ok: true, goal };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // ── Calendar event creation ─────────────────────────────
  // Accepts raw form data without id. Computes durationMinutes if
  // start/end supplied. Normalizes category against the allowlist.
  ipcMain.handle("entities:new-event", async (_event, payload) => {
    try {
      const p = (payload || {}) as Record<string, unknown>;
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
      return { ok: true, event };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // ── User creation (onboarding) ──────────────────────────
  ipcMain.handle("entities:new-user", async (_event, payload) => {
    try {
      const p = (payload || {}) as Record<string, unknown>;
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
        weeklyAvailability: Array.isArray(p.weeklyAvailability)
          ? p.weeklyAvailability
          : [],
        createdAt: nowIso(),
        settings: {
          enableNewsFeed: Boolean(settings.enableNewsFeed),
          dailyReminderTime:
            typeof settings.dailyReminderTime === "string"
              ? settings.dailyReminderTime
              : undefined,
          theme: (settings.theme as string) || "system",
          language: (settings.language as string) || "en",
          apiKey:
            typeof settings.apiKey === "string" ? settings.apiKey : undefined,
          modelOverrides:
            (settings.modelOverrides as Record<string, string>) || undefined,
        },
      };
      return { ok: true, user };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // ── Daily log creation ──────────────────────────────────
  ipcMain.handle("entities:new-log", async (_event, payload) => {
    try {
      const p = (payload || {}) as Record<string, unknown>;
      const log = {
        id: randomUUID(),
        userId: String(p.userId || ""),
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
      return { ok: true, log };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // ── Chat session creation ───────────────────────────────
  ipcMain.handle("entities:new-chat-session", async (_event, payload) => {
    try {
      const p = (payload || {}) as Record<string, unknown>;
      const session = {
        id: randomUUID(),
        title: String(p.title || "New Chat"),
        messages: Array.isArray(p.messages) ? p.messages : [],
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      return { ok: true, session };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // ── Chat message creation ───────────────────────────────
  // Used for any chat message the renderer needs to append to a
  // session (home chat, goal plan chat, etc). Returns a stable id
  // and timestamp so the renderer does not need to generate either.
  ipcMain.handle("entities:new-chat-message", async (_event, payload) => {
    try {
      const p = (payload || {}) as Record<string, unknown>;
      const message = {
        id: randomUUID(),
        role: String(p.role || "user"),
        content: String(p.content || ""),
        timestamp: nowIso(),
      };
      return { ok: true, message };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // ── Behavior profile entry ──────────────────────────────
  ipcMain.handle("entities:new-behavior-entry", async (_event, payload) => {
    try {
      const p = (payload || {}) as Record<string, unknown>;
      const entry = {
        id: randomUUID(),
        content: String(p.content || ""),
        createdAt: nowIso(),
      };
      return { ok: true, entry };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // ── Confirmed task (from pending task analysis) ─────────
  // The renderer previously generated task-confirmed-${Date.now()}
  // inline AND ran downgradeIfOverBudget client-side. Backend now
  // owns both so the cognitive-budget domain rule lives entirely
  // server-side — the renderer has no imports from shared/domain.
  ipcMain.handle("entities:new-confirmed-task", async (_event, payload) => {
    try {
      const p = (payload || {}) as Record<string, unknown>;
      const requestedPriority = String(p.priority || "should-do") as TaskPriority;
      const durationMinutes =
        typeof p.durationMinutes === "number" ? p.durationMinutes : 30;
      const cognitiveWeight =
        typeof p.cognitiveWeight === "number" ? p.cognitiveWeight : 3;

      // Cognitive-budget enforcement runs here when the task is
      // being scheduled for today. If the task is scheduled for a
      // future date the renderer passes isScheduledToday=false and
      // the requested priority is preserved.
      const isScheduledToday = Boolean(p.isScheduledToday);
      const currentTasks = (Array.isArray(p.currentTasks) ? p.currentTasks : []) as Array<{
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
      return { ok: true, task };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });
}
