/* ──────────────────────────────────────────────────────────
   NorthStar — Memory service (renderer → main IPC)
   
   Frontend API for the Three-Tier Memory Architecture.
   All calls go through Electron IPC to the main process.
   ────────────────────────────────────────────────────────── */

import type { MemorySummary, ReflectionResult, ContextualNudge } from "../types";

// ── Query ───────────────────────────────────────────────

/** Get a summary of everything the AI remembers about the user */
export async function getMemorySummary(): Promise<{
  ok: boolean;
  data?: MemorySummary;
  error?: string;
}> {
  const result = await window.electronAPI.invoke("memory:summary");
  return result as { ok: boolean; data?: MemorySummary; error?: string };
}

/** Get full memory store (for debug/settings) */
export async function getFullMemory(): Promise<{
  ok: boolean;
  data?: unknown;
  error?: string;
}> {
  const result = await window.electronAPI.invoke("memory:load");
  return result as { ok: boolean; data?: unknown; error?: string };
}

// ── Record Signals ──────────────────────────────────────

/** Record when a user completes a task (with optional timing data) */
export async function recordTaskCompleted(
  taskTitle: string,
  taskCategory: string,
  estimatedMinutes?: number,
  actualMinutes?: number
): Promise<void> {
  await window.electronAPI.invoke("memory:task-completed", {
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
  date: string
): Promise<void> {
  await window.electronAPI.invoke("memory:task-snoozed", {
    taskTitle,
    taskCategory,
    date,
  });
}

/** Record when a user skips a task entirely */
export async function recordTaskSkipped(
  taskTitle: string,
  taskCategory: string,
  date: string
): Promise<void> {
  await window.electronAPI.invoke("memory:task-skipped", {
    taskTitle,
    taskCategory,
    date,
  });
}

/** Record explicit feedback from the user */
export async function recordFeedback(
  context: string,
  feedback: string,
  isPositive: boolean
): Promise<void> {
  await window.electronAPI.invoke("memory:feedback", {
    context,
    feedback,
    isPositive,
  });
}

/** Record a generic behavioral signal */
export async function recordSignal(
  type: string,
  context: string,
  value: string
): Promise<void> {
  await window.electronAPI.invoke("memory:signal", {
    type,
    context,
    value,
  });
}

/** Record actual task timing from the in-app timer */
export async function recordTaskTiming(
  taskTitle: string,
  taskCategory: string,
  estimatedMinutes: number,
  actualMinutes: number
): Promise<void> {
  await window.electronAPI.invoke("memory:task-timing", {
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
  proactiveQuestion?: string | null
): Promise<ContextualNudge[]> {
  try {
    const result = await window.electronAPI.invoke("memory:nudges", {
      tasks,
      proactiveQuestion,
    });
    const r = result as { ok: boolean; data?: ContextualNudge[] };
    return r.ok && r.data ? r.data : [];
  } catch {
    return [];
  }
}

/** Check if auto-reflection should be triggered */
export async function shouldAutoReflect(): Promise<boolean> {
  try {
    const result = await window.electronAPI.invoke("memory:should-reflect");
    const r = result as { ok: boolean; shouldReflect: boolean };
    return r.ok && r.shouldReflect;
  } catch {
    return false;
  }
}

// ── Actions ─────────────────────────────────────────────

/** Trigger a full AI-powered reflection cycle */
export async function triggerReflection(
  trigger = "manual"
): Promise<{ ok: boolean; data?: ReflectionResult; error?: string }> {
  const result = await window.electronAPI.invoke("memory:reflect", { trigger });
  return result as { ok: boolean; data?: ReflectionResult; error?: string };
}

/** Clear all memory (full reset) */
export async function clearMemory(): Promise<{ ok: boolean }> {
  const result = await window.electronAPI.invoke("memory:clear");
  return result as { ok: boolean };
}
