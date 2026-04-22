/* ──────────────────────────────────────────────────────────
   NorthStar — Memory service (renderer → cloud HTTP)

   Frontend API for the Three-Tier Memory Architecture.
   All calls route through cloudInvoke (Phase 13: cloud-only).
   ────────────────────────────────────────────────────────── */

import type { MemorySummary, ReflectionResult, ContextualNudge } from "@northstar/core";
import { cloudInvoke } from "./cloudTransport";

// ── Query ───────────────────────────────────────────────

/** Get a summary of everything the AI remembers about the user */
export async function getMemorySummary(): Promise<{
  ok: boolean;
  data?: MemorySummary;
  error?: string;
}> {
  return cloudInvoke("memory:summary");
}

/** Get full memory store (for debug/settings) */
export async function getFullMemory(): Promise<{
  ok: boolean;
  data?: unknown;
  error?: string;
}> {
  return cloudInvoke("memory:load");
}

// ── Record Signals ──────────────────────────────────────

/** Record when a user completes a task (with optional timing data) */
export async function recordTaskCompleted(
  taskTitle: string,
  taskCategory: string,
  estimatedMinutes?: number,
  actualMinutes?: number,
): Promise<void> {
  await cloudInvoke("memory:task-completed", {
    taskTitle,
    taskCategory,
    estimatedMinutes,
    actualMinutes,
  });
}

/** Record when a user snoozes a task */
export async function recordTaskSnoozed(
  taskTitle: string,
  taskCategory: string,
  date: string,
): Promise<void> {
  await cloudInvoke("memory:task-snoozed", { taskTitle, taskCategory, date });
}

/** Record when a user skips a task entirely */
export async function recordTaskSkipped(
  taskTitle: string,
  taskCategory: string,
  date: string,
): Promise<void> {
  await cloudInvoke("memory:task-skipped", { taskTitle, taskCategory, date });
}

/** Record explicit feedback from the user */
export async function recordFeedback(
  context: string,
  feedback: string,
  isPositive: boolean,
): Promise<void> {
  await cloudInvoke("memory:feedback", { context, feedback, isPositive });
}

/** Record a generic behavioral signal */
export async function recordSignal(
  type: string,
  context: string,
  value: string,
): Promise<void> {
  await cloudInvoke("memory:signal", { type, context, value });
}

/** Record actual task timing from the in-app timer */
export async function recordTaskTiming(
  taskTitle: string,
  taskCategory: string,
  estimatedMinutes: number,
  actualMinutes: number,
): Promise<void> {
  await cloudInvoke("memory:task-timing", {
    taskTitle,
    taskCategory,
    estimatedMinutes,
    actualMinutes,
  });
}

// ── Nudges (Contextual Feedback Triggers) ───────────────

/** Generate contextual nudges based on current task state */
export async function getNudges(
  tasks: Array<{
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
  }>,
  proactiveQuestion?: string | null,
): Promise<ContextualNudge[]> {
  try {
    const result = await cloudInvoke<{ ok: boolean; data?: ContextualNudge[] }>(
      "memory:nudges",
      { tasks, proactiveQuestion },
    );
    return result.ok && result.data ? result.data : [];
  } catch {
    return [];
  }
}

/** Check if auto-reflection should be triggered */
export async function shouldAutoReflect(): Promise<boolean> {
  try {
    const result = await cloudInvoke<{ ok: boolean; shouldReflect: boolean }>(
      "memory:should-reflect",
    );
    return result.ok && result.shouldReflect;
  } catch {
    return false;
  }
}

// ── Actions ─────────────────────────────────────────────

/** Trigger a full AI-powered reflection cycle */
export async function triggerReflection(
  trigger = "manual",
): Promise<{ ok: boolean; data?: ReflectionResult; error?: string }> {
  return cloudInvoke("memory:reflect", { trigger });
}

/** Clear all memory (full reset) */
export async function clearMemory(): Promise<{ ok: boolean }> {
  return cloudInvoke("memory:clear");
}

// ── Behavior Profile ────────────────────────────────────

export interface BehaviorProfileEntry {
  id: string;
  category: string;
  text: string;
  source: "observed" | "user-edited";
}

/** Get the AI's human-readable behavior profile of the user */
export async function getBehaviorProfile(): Promise<{
  ok: boolean;
  data?: BehaviorProfileEntry[];
  error?: string;
}> {
  return cloudInvoke("memory:behavior-profile");
}

/** Save user-edited behavior profile entries back to the AI memory */
export async function saveBehaviorProfile(
  entries: Array<{ category: string; text: string }>,
): Promise<{ ok: boolean; error?: string }> {
  return cloudInvoke("memory:save-behavior-profile", { entries });
}
