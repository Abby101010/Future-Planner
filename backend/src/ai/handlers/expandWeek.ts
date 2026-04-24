/* Starward — Expand Week handler (GoalAct lazy expansion)
 *
 * When a locked week in a goal plan is unlocked, this handler
 * generates detailed daily tasks using the week's objective,
 * surrounding context, and pace data. This is the GoalAct pattern:
 * skeleton-first planning with on-demand detailing.
 */

import Anthropic from "@anthropic-ai/sdk";
import { getModelForTask, personalizeSystem } from "@starward/core";
import type { GoalPlanDay, GoalPlanTask } from "@starward/core";
import { runStreamingHandler } from "../streaming";
import { emitAgentProgress } from "../../ws";
import { getCurrentUserId } from "../../middleware/requestContext";

export interface ExpandWeekInput {
  goalTitle: string;
  goalDescription: string;
  weekLabel: string;
  weekObjective: string;
  /** Summary of previous week's tasks (what was done / skipped). */
  previousWeekContext: string;
  /** Next week's objective (for continuity). */
  nextWeekObjective: string;
  /** Overall goal progress summary. */
  progressSummary: string;
  /** Pace data summary if available. */
  paceContext: string;
  /** Date range for the week (ISO dates). */
  startDate: string;
  endDate: string;
}

const EXPAND_WEEK_SYSTEM = `You are a goal planning assistant. Generate a detailed daily task breakdown for ONE week of a goal plan.

RULES:
- Generate tasks for 5 weekdays (Monday–Friday) within the given date range
- Each day gets 1–2 tasks (prefer 1 for focused execution)
- Total 5–7 tasks for the week
- Tasks must directly serve the week's objective
- Each task must be completable in 15–60 minutes
- Build on prior week progress, don't repeat completed work
- Use pace data to calibrate difficulty (if user is behind, lighter tasks)

OUTPUT FORMAT (JSON only, no markdown):
{
  "days": [
    {
      "label": "2025-01-06",
      "tasks": [
        {
          "title": "Short action-oriented title",
          "description": "Why this matters for the goal",
          "durationMinutes": 30,
          "priority": "must-do",
          "category": "building"
        }
      ]
    }
  ]
}

PRIORITY: "must-do" | "should-do" | "bonus"
CATEGORY: "learning" | "building" | "networking" | "reflection" | "planning"`;

export async function handleExpandWeek(
  client: Anthropic,
  input: ExpandWeekInput,
  memoryContext: string,
): Promise<{ days: GoalPlanDay[] }> {
  const handlerKind = "expandWeek";
  const userId = getCurrentUserId();

  emitAgentProgress(userId, {
    agentId: handlerKind,
    phase: "running",
    message: `Expanding week: ${input.weekLabel}`,
  });

  const result = await runStreamingHandler<{ days: Array<{ label: string; tasks: Array<{ title: string; description: string; durationMinutes: number; priority: string; category: string }> }> }>({
    handlerKind,
    client,
    createRequest: () => ({
      model: getModelForTask("expand-week"),
      max_tokens: 4096,
      system: personalizeSystem(EXPAND_WEEK_SYSTEM, memoryContext),
      messages: [
        {
          role: "user",
          content: `GOAL: ${input.goalTitle}
${input.goalDescription}

WEEK: ${input.weekLabel} (${input.startDate} to ${input.endDate})
OBJECTIVE: ${input.weekObjective}

PREVIOUS WEEK:
${input.previousWeekContext || "No previous week data"}

NEXT WEEK OBJECTIVE:
${input.nextWeekObjective || "No next week planned yet"}

PROGRESS:
${input.progressSummary}

PACE:
${input.paceContext || "No pace data available"}

Generate the daily tasks for this week.`,
        },
      ],
    }),
    parseResult: (finalText) => {
      const cleaned = finalText
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();
      return JSON.parse(cleaned);
    },
  });

  emitAgentProgress(userId, { agentId: handlerKind, phase: "done" });

  // Map to typed GoalPlanDay[] with generated IDs
  const days: GoalPlanDay[] = (result.days || []).map((d) => ({
    id: `day-${d.label}`,
    label: d.label,
    tasks: (d.tasks || []).map((t, i) => ({
      id: `task-${d.label}-${i}`,
      title: t.title,
      description: t.description || "",
      durationMinutes: t.durationMinutes || 30,
      priority: (t.priority || "should-do") as GoalPlanTask["priority"],
      category: (t.category || "planning") as GoalPlanTask["category"],
      completed: false,
    })),
  }));

  return { days };
}
