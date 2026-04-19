/* NorthStar server — Tool-use definitions (Phase 5, additive)
 *
 * Read-only tools the Anthropic model can call during a tool_use loop.
 * Each tool has:
 *   - an Anthropic-SDK-shaped definition (name, description, input_schema)
 *   - a server-side impl that takes the parsed input + userId and returns
 *     JSON-serialisable data
 *
 * Important guardrails:
 *   - Read-only. No write tools in Phase 5. Adding writes later requires
 *     explicit approval + a per-tool mutation guard.
 *   - Tools never throw. On failure they return `{ error: string }` so the
 *     model can self-recover in the same tool_use loop.
 *   - Every tool runs inside runWithUserId so repos.* enforce user scoping.
 */

import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { runWithUserId } from "../middleware/requestContext";
import * as repos from "../repositories";
import { loadMemory } from "../memory";

export type ToolImpl = (
  input: Record<string, unknown>,
  userId: string,
) => Promise<unknown>;

export interface RegisteredTool {
  definition: Tool;
  impl: ToolImpl;
}

const todayISO = (): string => new Date().toISOString().split("T")[0]!;

function safeError(err: unknown): { error: string } {
  return { error: err instanceof Error ? err.message : String(err) };
}

const getUserGoals: RegisteredTool = {
  definition: {
    name: "get_user_goals",
    description:
      "List the user's goals. Returns id, title, description, status, targetDate, importance, and plan summary (year/month/week counts).",
    input_schema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["active", "paused", "archived", "planning", "all"],
          description: "Optional status filter. Default: 'active'.",
        },
      },
    },
  },
  impl: async (input, userId) => {
    const statusFilter = (input.status as string | undefined) ?? "active";
    return runWithUserId(userId, async () => {
      try {
        const all = await repos.goals.list();
        const filtered =
          statusFilter === "all" ? all : all.filter((g) => g.status === statusFilter);
        return filtered.map((g) => ({
          id: g.id,
          title: g.title,
          description: g.description ?? "",
          status: g.status,
          targetDate: g.targetDate ?? null,
          importance: g.importance ?? "medium",
          goalType: g.goalType,
          hasPlan: Boolean(g.plan),
        }));
      } catch (err) {
        return safeError(err);
      }
    });
  },
};

const getUpcomingTasks: RegisteredTool = {
  definition: {
    name: "get_upcoming_tasks",
    description:
      "List the user's daily tasks for a date range. Returns task id, title, date, completed, duration, goalId, category.",
    input_schema: {
      type: "object",
      properties: {
        startDate: {
          type: "string",
          description: "ISO date (YYYY-MM-DD). Defaults to today.",
        },
        days: {
          type: "number",
          description: "Number of days forward from startDate (1-14). Default: 1.",
        },
      },
    },
  },
  impl: async (input, userId) => {
    const start = (input.startDate as string | undefined) ?? todayISO();
    const days = Math.max(1, Math.min(14, (input.days as number | undefined) ?? 1));
    return runWithUserId(userId, async () => {
      try {
        const startDate = new Date(`${start}T00:00:00`);
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + days - 1);
        const endStr = endDate.toISOString().split("T")[0]!;
        const rows = await repos.dailyTasks.listForDateRange(start, endStr);
        return rows.map((t) => {
          const pl = (t.payload ?? {}) as Record<string, unknown>;
          return {
            id: t.id,
            title: t.title,
            description: (pl.description as string) ?? "",
            date: t.date,
            completed: t.completed,
            goalId: t.goalId ?? null,
            durationMinutes: (pl.durationMinutes as number) ?? null,
            category: (pl.category as string) ?? null,
            priority: (pl.priority as string) ?? null,
          };
        });
      } catch (err) {
        return safeError(err);
      }
    });
  },
};

const getMemoryFacts: RegisteredTool = {
  definition: {
    name: "get_memory_facts",
    description:
      "Return high-confidence facts NorthStar has learned about the user (schedule, preferences, patterns, capacity, constraints). Useful for personalising responses.",
    input_schema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          description:
            "Optional category filter: schedule, preference, pattern, capacity, constraint, motivation, strength, struggle.",
        },
        limit: {
          type: "number",
          description: "Max facts to return (1-30). Default: 15.",
        },
      },
    },
  },
  impl: async (input, userId) => {
    const cat = input.category as string | undefined;
    const limit = Math.max(1, Math.min(30, (input.limit as number | undefined) ?? 15));
    return runWithUserId(userId, async () => {
      try {
        const memory = await loadMemory(userId);
        let facts = memory.facts.filter((f) => f.confidence >= 0.4);
        if (cat) facts = facts.filter((f) => f.category === cat);
        facts.sort((a, b) => b.confidence - a.confidence);
        return facts.slice(0, limit).map((f) => ({
          category: f.category,
          value: f.value,
          confidence: f.confidence,
          updatedAt: f.updatedAt,
        }));
      } catch (err) {
        return safeError(err);
      }
    });
  },
};

const getTodayOverview: RegisteredTool = {
  definition: {
    name: "get_today_overview",
    description:
      "One-call summary: today's tasks (completed vs pending), active goal count, and the user's current date. Use this when the model asks 'what's on my plate today'.",
    input_schema: { type: "object", properties: {} },
  },
  impl: async (_input, userId) => {
    return runWithUserId(userId, async () => {
      try {
        const today = todayISO();
        const [tasks, goals] = await Promise.all([
          repos.dailyTasks.listForDate(today),
          repos.goals.list(),
        ]);
        const active = goals.filter((g) => g.status === "active");
        const completed = tasks.filter((t) => t.completed).length;
        const pending = tasks.length - completed;
        return {
          today,
          totalTasks: tasks.length,
          completed,
          pending,
          activeGoalCount: active.length,
          activeGoalTitles: active.slice(0, 5).map((g) => g.title),
        };
      } catch (err) {
        return safeError(err);
      }
    });
  },
};

export const REGISTERED_TOOLS: Record<string, RegisteredTool> = {
  get_user_goals: getUserGoals,
  get_upcoming_tasks: getUpcomingTasks,
  get_memory_facts: getMemoryFacts,
  get_today_overview: getTodayOverview,
};

export function getToolDefinitions(): Tool[] {
  return Object.values(REGISTERED_TOOLS).map((t) => t.definition);
}

export function getToolImpl(name: string): ToolImpl | null {
  return REGISTERED_TOOLS[name]?.impl ?? null;
}
