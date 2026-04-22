import { describe, it, expect } from "vitest";
import { applyPlanPatch } from "./goalPlan.js";
import type { GoalPlan } from "../types/index.js";

const basePlan: GoalPlan = {
  milestones: [
    {
      id: "ms-1",
      title: "Milestone 1",
      description: "First milestone.",
      targetDate: "2026-05-01",
      completed: false,
    },
  ],
  years: [
    {
      id: "year-1",
      label: "Year 1",
      objective: "Year objective.",
      months: [
        {
          id: "month-1",
          label: "Month 1",
          objective: "Month objective.",
          weeks: [
            {
              id: "week-1",
              label: "Week 1",
              objective: "Ease in.",
              locked: false,
              days: [
                {
                  id: "day-1",
                  label: "Mon",
                  tasks: [
                    {
                      id: "task-1",
                      title: "Walk after school",
                      description: "Light cardio.",
                      durationMinutes: 20,
                      priority: "should-do",
                      category: "building",
                      completed: true,
                      completedAt: "2026-04-10T18:00:00Z",
                    },
                    {
                      id: "task-2",
                      title: "Journal",
                      description: "Reflect.",
                      durationMinutes: 10,
                      priority: "should-do",
                      category: "reflection",
                      completed: false,
                    },
                  ],
                },
                {
                  id: "day-2",
                  label: "Tue",
                  tasks: [],
                },
              ],
            },
            {
              id: "week-2",
              label: "Week 2",
              objective: "Build.",
              locked: false,
              days: [],
            },
          ],
        },
      ],
    },
  ],
};

describe("applyPlanPatch", () => {
  it("returns plan unchanged for null/invalid patch", () => {
    expect(applyPlanPatch(basePlan, null)).toEqual(basePlan);
    expect(applyPlanPatch(basePlan, undefined)).toEqual(basePlan);
    expect(applyPlanPatch(basePlan, 42)).toEqual(basePlan);
  });

  it("leaves untouched years/months/weeks alone", () => {
    const patch = {
      years: [
        {
          id: "year-1",
          months: [
            {
              id: "month-1",
              weeks: [
                {
                  id: "week-1",
                  objective: "NEW Week 1 objective.",
                },
              ],
            },
          ],
        },
      ],
    };
    const next = applyPlanPatch(basePlan, patch);
    expect(next.years[0].months[0].weeks[0].objective).toBe(
      "NEW Week 1 objective.",
    );
    // Week 2 untouched
    expect(next.years[0].months[0].weeks[1]).toEqual(
      basePlan.years[0].months[0].weeks[1],
    );
    // Week 1 days untouched (patch only changed objective)
    expect(next.years[0].months[0].weeks[0].days).toEqual(
      basePlan.years[0].months[0].weeks[0].days,
    );
  });

  it("replaces a day's tasks but preserves completion state by id", () => {
    const patch = {
      years: [
        {
          id: "year-1",
          months: [
            {
              id: "month-1",
              weeks: [
                {
                  id: "week-1",
                  days: [
                    {
                      id: "day-1",
                      tasks: [
                        {
                          id: "task-1",
                          title: "Gym Session 1",
                          description: "Upper body.",
                          durationMinutes: 45,
                          priority: "must-do",
                          category: "building",
                          completed: false,
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const next = applyPlanPatch(basePlan, patch);
    const day1 = next.years[0].months[0].weeks[0].days[0];
    expect(day1.tasks).toHaveLength(1);
    // New title takes effect
    expect(day1.tasks[0].title).toBe("Gym Session 1");
    // But task-1 was completed originally — completion state wins over
    // whatever the patch says
    expect(day1.tasks[0].completed).toBe(true);
    expect(day1.tasks[0].completedAt).toBe("2026-04-10T18:00:00Z");
    // day-2 in the same week is untouched
    expect(next.years[0].months[0].weeks[0].days[1]).toEqual(
      basePlan.years[0].months[0].weeks[0].days[1],
    );
  });

  it("appends new days that don't match any existing day id", () => {
    const patch = {
      years: [
        {
          id: "year-1",
          months: [
            {
              id: "month-1",
              weeks: [
                {
                  id: "week-1",
                  days: [
                    {
                      id: "day-3",
                      label: "Wed",
                      tasks: [
                        {
                          id: "task-new",
                          title: "New task",
                          description: "Something.",
                          durationMinutes: 30,
                          priority: "should-do",
                          category: "building",
                          completed: false,
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const next = applyPlanPatch(basePlan, patch);
    const week1 = next.years[0].months[0].weeks[0];
    expect(week1.days).toHaveLength(3);
    expect(week1.days[2].id).toBe("day-3");
    expect(week1.days[2].tasks[0].title).toBe("New task");
    // original days preserved
    expect(week1.days[0]).toEqual(basePlan.years[0].months[0].weeks[0].days[0]);
  });

  it("ignores unknown year ids without wiping siblings", () => {
    const patch = {
      years: [{ id: "year-999", objective: "nope" }],
    };
    const next = applyPlanPatch(basePlan, patch);
    expect(next).toEqual(basePlan);
  });

  it("does not mutate the input plan", () => {
    const snapshot = JSON.parse(JSON.stringify(basePlan));
    applyPlanPatch(basePlan, {
      years: [
        {
          id: "year-1",
          months: [
            {
              id: "month-1",
              weeks: [{ id: "week-1", objective: "changed" }],
            },
          ],
        },
      ],
    });
    expect(basePlan).toEqual(snapshot);
  });
});
