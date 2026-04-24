/**
 * Per-goal Dashboard command handlers (Phase 6).
 *
 * Five commands that drive the per-goal Dashboard's editing surface:
 *   - update-goal-notes       user_notes column on goals
 *   - edit-goal-title         title column on goals
 *   - edit-milestone          update a milestone node in goal_plan_nodes
 *   - regenerate-insights     force-rerun dashboardInsightAgent (persists cards on goal_metadata)
 *   - add-goal-reflection     append a dated reflection entry to goal_metadata.reflections
 *
 * All five emit view:invalidate for view:goal-dashboard (via the
 * invalidation map wired in commands.ts).
 */

import type { GoalPlanMilestone } from "@starward/core";
import { repos } from "./_helpers";
import { generateInsightCards } from "../../agents/dashboardInsightAgent";

// ── 1. update-goal-notes ─────────────────────────────────────

export async function cmdUpdateGoalNotes(
  body: Record<string, unknown>,
): Promise<unknown> {
  const goalId = body.goalId as string | undefined;
  const notes = body.notes as string | undefined;
  if (!goalId) throw new Error("command:update-goal-notes requires args.goalId");
  if (typeof notes !== "string") {
    throw new Error("command:update-goal-notes requires args.notes (string)");
  }
  const existing = await repos.goals.get(goalId);
  if (!existing) throw new Error(`goal ${goalId} not found`);
  await repos.goals.upsert({ ...existing, userNotes: notes });
  return { ok: true, goalId };
}

// ── 2. edit-goal-title ───────────────────────────────────────

export async function cmdEditGoalTitle(
  body: Record<string, unknown>,
): Promise<unknown> {
  const goalId = body.goalId as string | undefined;
  const newTitle = body.newTitle as string | undefined;
  if (!goalId) throw new Error("command:edit-goal-title requires args.goalId");
  if (typeof newTitle !== "string" || !newTitle.trim()) {
    throw new Error("command:edit-goal-title requires args.newTitle (non-empty string)");
  }
  const existing = await repos.goals.get(goalId);
  if (!existing) throw new Error(`goal ${goalId} not found`);
  await repos.goals.upsert({ ...existing, title: newTitle.trim() });
  return { ok: true, goalId };
}

// ── 3. edit-milestone ────────────────────────────────────────

export async function cmdEditMilestone(
  body: Record<string, unknown>,
): Promise<unknown> {
  const milestoneId = body.milestoneId as string | undefined;
  const newTitle = body.newTitle as string | undefined;
  const newDate = body.newDate as string | undefined;
  if (!milestoneId) {
    throw new Error("command:edit-milestone requires args.milestoneId");
  }
  if (newTitle === undefined && newDate === undefined) {
    throw new Error("command:edit-milestone requires at least one of newTitle / newDate");
  }

  const node = await repos.goalPlan.getNode(milestoneId);
  if (!node) throw new Error(`milestone node ${milestoneId} not found`);
  if (node.nodeType !== "milestone") {
    throw new Error(`node ${milestoneId} is not a milestone (nodeType=${node.nodeType})`);
  }

  const updatedPayload: Record<string, unknown> = { ...node.payload };
  if (typeof newDate === "string" && newDate.trim()) {
    updatedPayload.targetDate = newDate.trim();
  }

  await repos.goalPlan.upsertNodes(node.goalId, [
    {
      ...node,
      title: typeof newTitle === "string" && newTitle.trim() ? newTitle.trim() : node.title,
      endDate: typeof newDate === "string" && newDate.trim() ? newDate.trim() : node.endDate,
      payload: updatedPayload,
    },
  ]);

  return { ok: true, goalId: node.goalId, milestoneId };
}

// ── 4. regenerate-insights ───────────────────────────────────

export async function cmdRegenerateInsights(
  body: Record<string, unknown>,
): Promise<unknown> {
  const goalId = body.goalId as string | undefined;
  if (!goalId) throw new Error("command:regenerate-insights requires args.goalId");
  const existing = await repos.goals.get(goalId);
  if (!existing) throw new Error(`goal ${goalId} not found`);

  const { cards } = await generateInsightCards({
    goal: existing,
    contextHint: "user-requested regeneration",
  });

  // Persist the latest cards on goal_metadata so subsequent view:goal-dashboard
  // loads can skip the agent call (the resolver can decide to use cached vs
  // fresh — for now we only store; resolver always regenerates).
  const metadata = { ...(existing.goalMetadata ?? {}), cachedInsightCards: cards };
  await repos.goals.upsert({ ...existing, goalMetadata: metadata });

  return { ok: true, goalId, cardCount: cards.length };
}

// ── 5. add-goal-reflection ───────────────────────────────────

interface ReflectionEntry {
  timestamp: string;
  text: string;
}

export async function cmdAddGoalReflection(
  body: Record<string, unknown>,
): Promise<unknown> {
  const goalId = body.goalId as string | undefined;
  const reflection = body.reflection as string | undefined;
  const timestampInput = body.timestamp as string | undefined;
  if (!goalId) throw new Error("command:add-goal-reflection requires args.goalId");
  if (typeof reflection !== "string" || !reflection.trim()) {
    throw new Error("command:add-goal-reflection requires args.reflection (non-empty string)");
  }
  const timestamp =
    typeof timestampInput === "string" && timestampInput.trim()
      ? timestampInput.trim()
      : new Date().toISOString();

  const existing = await repos.goals.get(goalId);
  if (!existing) throw new Error(`goal ${goalId} not found`);

  const current = existing.goalMetadata ?? {};
  const priorReflections = Array.isArray((current as { reflections?: unknown }).reflections)
    ? ((current as { reflections: ReflectionEntry[] }).reflections)
    : [];

  const entry: ReflectionEntry = { timestamp, text: reflection.trim() };
  const updatedMetadata = { ...current, reflections: [...priorReflections, entry] };

  await repos.goals.upsert({ ...existing, goalMetadata: updatedMetadata });
  return { ok: true, goalId, reflectionCount: (priorReflections.length + 1) };
}

// Re-export shape helper for type-safe callers if needed later.
export type { GoalPlanMilestone };
