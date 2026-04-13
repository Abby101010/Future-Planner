/**
 * Behavioral signal recorder — records user behavior events to the
 * memory_signals table so the capacity profile, behavioral insights,
 * and nudge engine can analyze patterns over time.
 *
 * Imported by command handlers (toggle-task, skip-task, etc.) to
 * automatically record signals when users interact with tasks.
 */

import { randomUUID } from "node:crypto";
import { query } from "../db/pool";
import { getCurrentUserId } from "../middleware/requestContext";

export type SignalType =
  | "task_completed"
  | "task_snoozed"
  | "task_skipped"
  | "task_completed_early"
  | "task_completed_late"
  | "recovery_triggered"
  | "blocker_reported"
  | "schedule_override"
  | "positive_feedback"
  | "negative_feedback"
  | "session_time"
  | "high_energy_window"
  | "low_energy_window"
  | "chat_insight";

/**
 * Insert a behavioral signal into memory_signals. Best-effort —
 * failures are logged but don't propagate to callers.
 */
export async function recordSignal(
  type: SignalType,
  context: string,
  value: string,
): Promise<void> {
  try {
    const userId = getCurrentUserId();
    await query(
      `INSERT INTO memory_signals (id, user_id, type, context, value, timestamp)
       VALUES ($1, $2, $3, $4, $5, now())`,
      [randomUUID(), userId, type, context, value],
    );
  } catch (err) {
    console.warn("[signalRecorder] failed to record signal:", type, err);
  }
}

/**
 * Record a task completion signal with category and timing metadata.
 */
export async function recordTaskCompleted(
  taskTitle: string,
  taskCategory: string,
  durationMinutes?: number,
): Promise<void> {
  const value = `category: ${taskCategory}${durationMinutes ? `, duration: ${durationMinutes}min` : ""}`;
  await recordSignal("task_completed", taskTitle, value);
}

/**
 * Record a task skip signal with category metadata.
 */
export async function recordTaskSkipped(
  taskTitle: string,
  taskCategory: string,
): Promise<void> {
  await recordSignal(
    "task_skipped",
    taskTitle,
    `category: ${taskCategory}`,
  );
}

/**
 * Record a task un-completion (user toggled a completed task back to incomplete).
 * We don't have a dedicated signal type for this — we use schedule_override
 * to indicate the user reversed a decision.
 */
export async function recordTaskUncompleted(
  taskTitle: string,
): Promise<void> {
  await recordSignal(
    "schedule_override",
    taskTitle,
    "Task un-completed by user",
  );
}
