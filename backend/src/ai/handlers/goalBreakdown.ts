/* Starward — Goal Breakdown handler */

import Anthropic from "@anthropic-ai/sdk";
import { getScheduleContext, summarizeScheduleForAI } from "../../calendar";
import { getModelForTask } from "@starward/core";
import { GOAL_BREAKDOWN_SYSTEM } from "@starward/core";
import { personalizeSystem } from "@starward/core";
import type { GoalBreakdownPayload, Goal } from "@starward/core";
import { runStreamingHandler } from "../streaming";
import { emitAgentProgress } from "../../ws";
import { getCurrentUserId } from "../../middleware/requestContext";
import { loadMemory, buildMemoryContext } from "../../memory";

/** Build a retrieval query that pulls cognitive-load + dual-process
 *  principles relevant to THIS goal's domain. The retrieved chunks
 *  (top-4 from psychology-principles.md, via the existing pgvector
 *  RAG infra) inform the per-task cognitive_load classification the
 *  prompt asks for. Mirrors priorityAnnotator.ts:78-95 — same
 *  segment-seeding pattern, scoped to goal-breakdown semantics.
 *
 *  Capped at 300 chars to avoid bloat (matches priorityAnnotator's
 *  cap). Don't move classification to a post-pass: doing it at
 *  decomposition time means the AI sees retrieved principles AND
 *  goal context together, and the user's prior cognitive_calibration
 *  facts (Phase D) flow in via memoryContext. */
function buildCognitiveLoadRetrievalQuery(goal: Goal): string {
  const title = (goal.title ?? "").slice(0, 80);
  const goalType = (goal.goalType ?? "").slice(0, 40);
  const seed =
    "cognitive load dual-process System 1 System 2 task energy " +
    "classification fresh-focus depleted-ok value tiering";
  const q = `${seed} for: ${title}${goalType ? ` (${goalType})` : ""}`;
  return q.slice(0, 300);
}

export async function handleGoalBreakdown(
  client: Anthropic,
  payload: GoalBreakdownPayload,
  memoryContext: string,
): Promise<unknown> {
  const { goal } = payload;
  const targetDate = payload.targetDate ?? "";
  const dailyHours = payload.dailyHours ?? 2;

  const today = new Date();
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() + 90);

  let scheduleInfo =
    "No scheduled tasks found. User has not added any time-blocked tasks yet.";
  try {
    const schedule = await getScheduleContext(
      today.toISOString().split("T")[0],
      endDate.toISOString().split("T")[0],
    );
    if (schedule.days.some((d) => d.events.length > 0)) {
      scheduleInfo = summarizeScheduleForAI(schedule);
    }
  } catch {
    console.warn("Schedule build failed");
  }

  const handlerKind = "goalBreakdown";
  const userId = getCurrentUserId();
  emitAgentProgress(userId, {
    agentId: handlerKind,
    phase: "running",
    message: "Breaking down goal",
  });

  // Re-build memoryContext with a cognitive-load-targeted retrieval
  // query so the goal-breakdown prompt sees the right
  // psychology-principles chunks alongside the user's facts/prefs.
  // Best-effort: a retrieval failure falls back to the
  // router-supplied memoryContext (no RAG enrichment, but the prompt
  // still works against the user's existing memory).
  let enrichedMemoryContext = memoryContext;
  try {
    const retrievalQuery = buildCognitiveLoadRetrievalQuery(goal as Goal);
    const memory = await loadMemory(userId);
    enrichedMemoryContext = await buildMemoryContext(
      memory,
      "planning",
      [],
      retrievalQuery,
    );
  } catch (err) {
    console.warn(
      "[goalBreakdown] cognitive-load RAG retrieval failed; falling back to router memoryContext:",
      err,
    );
  }

  const parsed = await runStreamingHandler<Record<string, unknown>>({
    handlerKind,
    client,
    createRequest: () => ({
      model: getModelForTask("goal-breakdown"),
      max_tokens: 16384,
      system: personalizeSystem(GOAL_BREAKDOWN_SYSTEM, enrichedMemoryContext),
      messages: [
        {
          role: "user",
          content: `TODAY'S DATE: ${today.toISOString().split("T")[0]}

MY GOAL:
${JSON.stringify(goal, null, 2)}

TARGET COMPLETION: ${targetDate || "flexible - suggest a realistic date"}
DAILY TIME BUDGET: ${dailyHours} hours/day

${scheduleInfo}

Please break down my goal into a complete hierarchical plan (years -> months -> weeks -> days).
Respect my calendar - no tasks on vacation days, lighter tasks on busy days.`,
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

  return {
    id: `breakdown-${Date.now()}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: 1,
    ...parsed,
  };
}
