/* NorthStar — planning slice (goals, vacation, monthly context, legacy roadmap/breakdown) */

import type { StateCreator } from "zustand";
import type {
  Goal,
  GoalType,
  GoalPlan,
  GoalPlanMessage,
  MonthlyContext,
  Roadmap,
  GoalBreakdown,
} from "../../types";
import { recordSignal } from "../../services/memory";
import type { StoreApi } from "../useStore";

export interface PlanningSlice {
  goals: Goal[];
  addGoal: (goal: Goal) => void;
  updateGoal: (id: string, updates: Partial<Goal>) => void;
  removeGoal: (id: string) => void;
  addGoalPlanMessage: (goalId: string, msg: GoalPlanMessage) => void;
  setGoalPlan: (goalId: string, plan: GoalPlan) => void;
  confirmGoalPlan: (goalId: string) => void;
  getBigGoals: () => Goal[];
  getEverydayGoals: () => Goal[];
  getRepeatingGoals: () => Goal[];
  getGoalsByType: (type: GoalType) => Goal[];

  vacationMode: { active: boolean; startDate: string; endDate: string } | null;
  setVacationMode: (
    mode: { active: boolean; startDate: string; endDate: string } | null,
  ) => void;

  monthlyContexts: MonthlyContext[];
  setMonthlyContext: (ctx: MonthlyContext) => void;
  removeMonthlyContext: (month: string) => void;
  getMonthlyContext: (month: string) => MonthlyContext | null;
  getCurrentMonthContext: () => MonthlyContext | null;

  roadmap: Roadmap | null;
  setRoadmap: (r: Roadmap | null) => void;

  goalBreakdown: GoalBreakdown | null;
  setGoalBreakdown: (b: GoalBreakdown | null) => void;
}

export const createPlanningSlice: StateCreator<
  StoreApi,
  [],
  [],
  PlanningSlice
> = (set, get) => ({
  goals: [],
  addGoal: (goal) => {
    set((s) => ({ goals: [...s.goals, goal] }));
    get().saveToDisk();
    recordSignal("goal_created", goal.goalType || "unknown", goal.title).catch(
      () => {},
    );
  },
  updateGoal: (id, updates) => {
    set((s) => ({
      goals: s.goals.map((g) =>
        g.id === id
          ? { ...g, ...updates, updatedAt: new Date().toISOString() }
          : g,
      ),
    }));
    get().saveToDisk();
  },
  removeGoal: (id) => {
    const goal = get().goals.find((g) => g.id === id);
    set((s) => ({ goals: s.goals.filter((g) => g.id !== id) }));
    get().saveToDisk();
    if (goal) {
      recordSignal(
        "goal_deleted",
        goal.goalType || "unknown",
        goal.title,
      ).catch(() => {});
    }
  },
  addGoalPlanMessage: (goalId, msg) => {
    set((s) => ({
      goals: s.goals.map((g) =>
        g.id === goalId
          ? {
              ...g,
              planChat: [...g.planChat, msg],
              updatedAt: new Date().toISOString(),
            }
          : g,
      ),
    }));
    get().saveToDisk();
  },
  setGoalPlan: (goalId, plan) => {
    set((s) => ({
      goals: s.goals.map((g) =>
        g.id === goalId
          ? {
              ...g,
              plan,
              status: "planning" as const,
              updatedAt: new Date().toISOString(),
            }
          : g,
      ),
    }));
    get().saveToDisk();
  },
  confirmGoalPlan: (goalId) => {
    const goal = get().goals.find((g) => g.id === goalId);
    set((s) => ({
      goals: s.goals.map((g) =>
        g.id === goalId
          ? {
              ...g,
              planConfirmed: true,
              status: "active" as const,
              updatedAt: new Date().toISOString(),
            }
          : g,
      ),
    }));
    get().saveToDisk();
    if (goal) {
      recordSignal("plan_confirmed", "big", goal.title).catch(() => {});
    }
  },
  getBigGoals: () =>
    get().goals.filter((g) => g.scope === "big" && g.status !== "archived"),
  getEverydayGoals: () =>
    get().goals.filter(
      (g) =>
        (g.goalType === "everyday" || (!g.goalType && g.scope === "small")) &&
        g.status !== "archived" &&
        g.status !== "completed",
    ),
  getRepeatingGoals: () =>
    get().goals.filter(
      (g) => g.goalType === "repeating" && g.status !== "archived",
    ),
  getGoalsByType: (type) =>
    get().goals.filter((g) => g.goalType === type && g.status !== "archived"),

  vacationMode: null,
  setVacationMode: (mode) => {
    set({ vacationMode: mode });
    get().saveToDisk();
    recordSignal(
      "vacation_mode",
      mode ? "activated" : "deactivated",
      mode ? `${mode.startDate} to ${mode.endDate}` : "ended",
    ).catch(() => {});
  },

  monthlyContexts: [],
  setMonthlyContext: (ctx) => {
    set((s) => {
      const existing = s.monthlyContexts.findIndex((c) => c.month === ctx.month);
      if (existing >= 0) {
        const updated = [...s.monthlyContexts];
        updated[existing] = ctx;
        return { monthlyContexts: updated };
      }
      return { monthlyContexts: [...s.monthlyContexts, ctx] };
    });
    get().saveToDisk();
    recordSignal(
      "monthly_context_set",
      ctx.month,
      `${ctx.intensity}: ${ctx.description.slice(0, 100)}`,
    ).catch(() => {});
  },
  removeMonthlyContext: (month) => {
    set((s) => ({
      monthlyContexts: s.monthlyContexts.filter((c) => c.month !== month),
    }));
    get().saveToDisk();
  },
  getMonthlyContext: (month) =>
    get().monthlyContexts.find((c) => c.month === month) || null,
  getCurrentMonthContext: () => {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(
      now.getMonth() + 1,
    ).padStart(2, "0")}`;
    return get().monthlyContexts.find((c) => c.month === currentMonth) || null;
  },

  roadmap: null,
  setRoadmap: (r) => {
    set({ roadmap: r });
    get().saveToDisk();
  },

  goalBreakdown: null,
  setGoalBreakdown: (b) => {
    set({ goalBreakdown: b });
    get().saveToDisk();
  },
});
