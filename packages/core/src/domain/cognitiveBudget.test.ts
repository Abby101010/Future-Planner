import { describe, it, expect } from "vitest";
import {
  COGNITIVE_BUDGET,
  totalWeight,
  totalMinutes,
  countDailyTaskSlots,
  downgradeIfOverBudget,
  enforceBudgetSnake,
  bonusTaskFits,
} from "./cognitiveBudget.js";

describe("totalWeight / totalMinutes", () => {
  it("uses defaults for missing fields", () => {
    expect(totalWeight([{}, {}])).toBe(COGNITIVE_BUDGET.DEFAULT_WEIGHT * 2);
    expect(totalMinutes([{}, {}])).toBe(COGNITIVE_BUDGET.DEFAULT_DURATION * 2);
  });

  it("sums provided values", () => {
    expect(
      totalWeight([{ cognitiveWeight: 4 }, { cognitiveWeight: 5 }]),
    ).toBe(9);
    expect(
      totalMinutes([{ durationMinutes: 45 }, { durationMinutes: 15 }]),
    ).toBe(60);
  });
});

describe("countDailyTaskSlots", () => {
  it("counts must-do and should-do but excludes bonus", () => {
    const tasks = [
      { priority: "must-do" },
      { priority: "should-do" },
      { priority: "bonus" },
    ];
    expect(countDailyTaskSlots(tasks)).toBe(2);
  });
});

describe("downgradeIfOverBudget", () => {
  it("keeps priority when budget allows", () => {
    expect(
      downgradeIfOverBudget(
        [{ cognitiveWeight: 3, durationMinutes: 30, priority: "must-do" }],
        { cognitiveWeight: 3, durationMinutes: 30 },
        "must-do",
      ),
    ).toBe("must-do");
  });

  it("downgrades to bonus when weight would exceed", () => {
    const existing = [
      { cognitiveWeight: 5, durationMinutes: 30, priority: "must-do" },
      { cognitiveWeight: 5, durationMinutes: 30, priority: "must-do" },
    ];
    expect(
      downgradeIfOverBudget(existing, { cognitiveWeight: 5 }, "should-do"),
    ).toBe("bonus");
  });

  it("downgrades when slot count is maxed", () => {
    const existing = Array.from({ length: COGNITIVE_BUDGET.MAX_DAILY_TASKS }, () => ({
      cognitiveWeight: 1,
      durationMinutes: 10,
      priority: "must-do" as const,
    }));
    expect(
      downgradeIfOverBudget(existing, { cognitiveWeight: 1 }, "must-do"),
    ).toBe("bonus");
  });

  it("downgrades when deep-work minutes would exceed", () => {
    const existing = [
      { cognitiveWeight: 1, durationMinutes: 120, priority: "must-do" },
    ];
    expect(
      downgradeIfOverBudget(
        existing,
        { cognitiveWeight: 1, durationMinutes: 90 },
        "should-do",
      ),
    ).toBe("bonus");
  });
});

describe("enforceBudgetSnake", () => {
  it("trims to hardLimit keeping highest priority first", () => {
    const tasks = [
      { priority: "bonus", cognitive_weight: 1 },
      { priority: "must-do", cognitive_weight: 3 },
      { priority: "should-do", cognitive_weight: 2 },
      { priority: "must-do", cognitive_weight: 4 },
      { priority: "should-do", cognitive_weight: 2 },
      { priority: "bonus", cognitive_weight: 1 },
    ];
    const out = enforceBudgetSnake(tasks, 3, 20);
    expect(out).toHaveLength(3);
    expect(out.every((t) => t.priority !== "bonus")).toBe(true);
  });

  it("drops low-priority tasks until weight fits budget", () => {
    const tasks = [
      { priority: "must-do", cognitive_weight: 5 },
      { priority: "must-do", cognitive_weight: 5 },
      { priority: "should-do", cognitive_weight: 5 },
      { priority: "bonus", cognitive_weight: 5 },
    ];
    const out = enforceBudgetSnake(tasks, 10, 12);
    const weight = out.reduce((s, t) => s + (t.cognitive_weight ?? 0), 0);
    expect(weight).toBeLessThanOrEqual(12);
    expect(out.length).toBeGreaterThanOrEqual(2);
  });

  it("never trims below 2 tasks even if over budget", () => {
    const tasks = [
      { priority: "must-do", cognitive_weight: 10 },
      { priority: "must-do", cognitive_weight: 10 },
    ];
    const out = enforceBudgetSnake(tasks, 5, 5);
    expect(out).toHaveLength(2);
  });
});

describe("bonusTaskFits", () => {
  it("allows a bonus task within grace allowance", () => {
    expect(bonusTaskFits(12, 2)).toBe(true);
  });

  it("rejects a bonus task beyond grace allowance", () => {
    expect(bonusTaskFits(12, 3)).toBe(false);
  });
});
