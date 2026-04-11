/* NorthStar server — commands route
 *
 * POST /commands/:kind — single entry point for every mutation in the
 * system. `kind` in the URL is the raw slug without the `command:`
 * prefix, i.e. POST /commands/toggle-task → command:toggle-task.
 *
 * Each case in the big switch delegates to a per-command handler
 * defined right below that reads args out of req.body, calls the
 * matching repository mutation, and returns an arbitrary payload that
 * we then wrap in the standardized envelope. After a successful
 * mutation we also emit `view:invalidate` over WS so connected clients
 * know to refetch the affected views.
 *
 * AI-backed commands (chat streams, plan regeneration, reallocation)
 * invoke the existing ai/router handleAIRequest — we do not
 * reimplement any AI plumbing here; we just translate command args to
 * the payload shape the handler expects.
 *
 * Failed commands do NOT emit view:invalidate — a client that sees an
 * error shouldn't then refetch the view and think nothing changed.
 */

import { Router } from "express";
import { envelope, envelopeError } from "@northstar/core";
import type { CommandKind, QueryKind } from "@northstar/core";
import * as repos from "../repositories";
import { getPool, query } from "../db/pool";
import { getCurrentUserId } from "../middleware/requestContext";
import { emitViewInvalidate } from "../ws/events";
import { commandToInvalidations } from "../views/_invalidation";
import { handleAIRequest, type RequestType } from "../ai/router";
import { loadMemory, buildMemoryContext } from "../memory";

const commandsRouter = Router();

// ── Small helpers ────────────────────────────────────────────

function invalidate(kind: CommandKind, extraViews: QueryKind[] = []): void {
  const userId = getCurrentUserId();
  const base = commandToInvalidations[kind] ?? [];
  const merged = Array.from(new Set<QueryKind>([...base, ...extraViews]));
  emitViewInvalidate(userId, { viewKinds: merged });
}

/** Build a fresh loadData() closure over the user's app_store snapshot.
 *  Mirrors the shape ai.ts already uses. */
async function buildLoadData(
  userId: string,
): Promise<() => Record<string, unknown>> {
  const rows = await query<{ key: string; value: unknown }>(
    "select key, value from app_store where user_id = $1",
    [userId],
  );
  const snapshot: Record<string, unknown> = {};
  for (const row of rows) snapshot[row.key] = row.value;
  return () => snapshot;
}

async function runAI(
  type: RequestType,
  payload: Record<string, unknown>,
  contextType: "planning" | "daily" | "recovery" | "general" = "general",
): Promise<unknown> {
  const userId = getCurrentUserId();
  const loadData = await buildLoadData(userId);
  const memory = await loadMemory(userId);
  const memoryContext = buildMemoryContext(memory, contextType);
  return handleAIRequest(type, payload, loadData, memoryContext);
}

// ── Per-command handlers ─────────────────────────────────────

async function cmdCreateGoal(body: Record<string, unknown>): Promise<unknown> {
  const goal = body.goal as Parameters<typeof repos.goals.upsert>[0];
  if (!goal || typeof goal !== "object" || !(goal as { id?: string }).id) {
    throw new Error("command:create-goal requires args.goal with an id");
  }
  await repos.goals.upsert(goal);
  return { ok: true, goalId: goal.id };
}

async function cmdUpdateGoal(body: Record<string, unknown>): Promise<unknown> {
  const goal = body.goal as Parameters<typeof repos.goals.upsert>[0];
  if (!goal || typeof goal !== "object" || !(goal as { id?: string }).id) {
    throw new Error("command:update-goal requires args.goal with an id");
  }
  await repos.goals.upsert(goal);
  return { ok: true, goalId: goal.id };
}

async function cmdDeleteGoal(body: Record<string, unknown>): Promise<unknown> {
  const goalId = body.goalId as string | undefined;
  if (!goalId) throw new Error("command:delete-goal requires args.goalId");
  await repos.goalPlan.deleteForGoal(goalId);
  await repos.goals.remove(goalId);
  return { ok: true, goalId };
}

async function cmdToggleTask(body: Record<string, unknown>): Promise<unknown> {
  const taskId = body.taskId as string | undefined;
  if (!taskId) throw new Error("command:toggle-task requires args.taskId");
  const next = await repos.dailyTasks.toggleCompleted(taskId);
  return { ok: true, taskId, completed: next };
}

async function cmdConfirmPendingTask(
  body: Record<string, unknown>,
): Promise<unknown> {
  const pendingId = body.pendingId as string | undefined;
  if (!pendingId) {
    throw new Error("command:confirm-pending-task requires args.pendingId");
  }
  await repos.pendingTasks.updateStatus(pendingId, "confirmed");
  return { ok: true, pendingId };
}

async function cmdRejectPendingTask(
  body: Record<string, unknown>,
): Promise<unknown> {
  const pendingId = body.pendingId as string | undefined;
  if (!pendingId) {
    throw new Error("command:reject-pending-task requires args.pendingId");
  }
  await repos.pendingTasks.updateStatus(pendingId, "rejected");
  return { ok: true, pendingId };
}

async function cmdUpsertCalendarEvent(
  body: Record<string, unknown>,
): Promise<unknown> {
  const event = body.event as Parameters<typeof repos.calendar.upsert>[0];
  if (!event || typeof event !== "object" || !(event as { id?: string }).id) {
    throw new Error(
      "command:upsert-calendar-event requires args.event with an id",
    );
  }
  await repos.calendar.upsert(event);
  return { ok: true, eventId: event.id };
}

async function cmdDeleteCalendarEvent(
  body: Record<string, unknown>,
): Promise<unknown> {
  const eventId = body.eventId as string | undefined;
  if (!eventId) {
    throw new Error("command:delete-calendar-event requires args.eventId");
  }
  await repos.calendar.remove(eventId);
  return { ok: true, eventId };
}

async function cmdUpsertReminder(
  body: Record<string, unknown>,
): Promise<unknown> {
  const reminder = body.reminder as Parameters<
    typeof repos.reminders.upsert
  >[0];
  if (
    !reminder ||
    typeof reminder !== "object" ||
    !(reminder as { id?: string }).id
  ) {
    throw new Error("command:upsert-reminder requires args.reminder with an id");
  }
  await repos.reminders.upsert(reminder);
  return { ok: true, reminderId: reminder.id };
}

async function cmdAcknowledgeReminder(
  body: Record<string, unknown>,
): Promise<unknown> {
  const reminderId = body.reminderId as string | undefined;
  if (!reminderId) {
    throw new Error("command:acknowledge-reminder requires args.reminderId");
  }
  await repos.reminders.acknowledge(reminderId);
  return { ok: true, reminderId };
}

async function cmdDeleteReminder(
  body: Record<string, unknown>,
): Promise<unknown> {
  const reminderId = body.reminderId as string | undefined;
  if (!reminderId) {
    throw new Error("command:delete-reminder requires args.reminderId");
  }
  await repos.reminders.remove(reminderId);
  return { ok: true, reminderId };
}

async function cmdSaveMonthlyContext(
  body: Record<string, unknown>,
): Promise<unknown> {
  const context = body.context as Parameters<
    typeof repos.monthlyContext.upsert
  >[0];
  if (!context || typeof context !== "object") {
    throw new Error("command:save-monthly-context requires args.context");
  }
  await repos.monthlyContext.upsert(context);
  return { ok: true, month: (context as { month: string }).month };
}

async function cmdDeleteMonthlyContext(
  body: Record<string, unknown>,
): Promise<unknown> {
  const month = body.month as string | undefined;
  if (!month) {
    throw new Error("command:delete-monthly-context requires args.month");
  }
  await repos.monthlyContext.remove(month);
  return { ok: true, month };
}

async function cmdUpdateSettings(
  body: Record<string, unknown>,
): Promise<unknown> {
  // TODO(phase6): this writes into app_store.user.settings because the
  // dedicated settings table doesn't exist yet. Read-modify-write under
  // a single key — this matches how the legacy client persisted it.
  const userId = getCurrentUserId();
  const patch = (body.settings as Record<string, unknown>) ?? {};
  const rows = await query<{ value: Record<string, unknown> }>(
    `select value from app_store where user_id = $1 and key = 'user'`,
    [userId],
  );
  const current = rows.length > 0 ? rows[0].value : {};
  const nextUser: Record<string, unknown> = {
    ...(current ?? {}),
    settings: {
      ...((current?.settings as Record<string, unknown>) ?? {}),
      ...patch,
    },
  };
  await query(
    `insert into app_store (user_id, key, value)
        values ($1, 'user', $2::jsonb)
     on conflict (user_id, key) do update set value = excluded.value`,
    [userId, JSON.stringify(nextUser)],
  );
  return { ok: true };
}

async function cmdCompleteOnboarding(
  body: Record<string, unknown>,
): Promise<unknown> {
  // TODO(phase6): user profile still lives in app_store. Merge the
  // onboarding result (weeklyAvailability, intent text, etc.) into the
  // user row and set onboardingComplete.
  const userId = getCurrentUserId();
  const patch = (body.user as Record<string, unknown>) ?? {};
  const rows = await query<{ value: Record<string, unknown> }>(
    `select value from app_store where user_id = $1 and key = 'user'`,
    [userId],
  );
  const current = rows.length > 0 ? rows[0].value : {};
  const nextUser: Record<string, unknown> = {
    ...(current ?? {}),
    ...patch,
    onboardingComplete: true,
  };
  await query(
    `insert into app_store (user_id, key, value)
        values ($1, 'user', $2::jsonb)
     on conflict (user_id, key) do update set value = excluded.value`,
    [userId, JSON.stringify(nextUser)],
  );
  return { ok: true };
}

async function cmdResetData(): Promise<unknown> {
  const userId = getCurrentUserId();
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("begin");
    // Per-entity tables first so FKs (if any) clear cleanly.
    const tables = [
      "goal_plan_nodes",
      "daily_tasks",
      "daily_logs",
      "pending_tasks",
      "heatmap_entries",
      "home_chat_messages",
      "conversations",
      "nudges",
      "behavior_profile_entries",
      "vacation_mode",
      "goals",
      "app_store",
    ];
    for (const t of tables) {
      await client.query(`delete from ${t} where user_id = $1`, [userId]);
    }
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
  return { ok: true };
}

// ── Chat / AI-backed commands ────────────────────────────────

async function cmdStartChatStream(
  body: Record<string, unknown>,
): Promise<unknown> {
  // The AI-streaming pipeline is still the home-chat SSE route from
  // phase 4b; this command just persists the first user message so
  // dashboardView sees it and returns a streamId the client can
  // correlate with inbound WS deltas. Full streaming wire-up is
  // out of phase-5a scope — see TODO(phase8).
  const message = body.message as Record<string, unknown> | undefined;
  if (message && typeof message === "object" && (message as { id?: string }).id) {
    await repos.chat.insertHomeMessage(
      message as unknown as Parameters<typeof repos.chat.insertHomeMessage>[0],
    );
  }
  const streamId = (body.streamId as string | undefined) ?? crypto.randomUUID();
  return { ok: true, streamId };
}

async function cmdSendChatMessage(
  body: Record<string, unknown>,
): Promise<unknown> {
  // Synchronous home-chat: invoke the existing AI handler, return the
  // reply plus any parsed intent. The client-side chat surface can
  // choose between this blocking path and the SSE stream.
  const payload = (body.payload as Record<string, unknown> | undefined) ?? {};
  const reply = await runAI("home-chat", payload, "general");
  // Persist the inbound user message if the caller sent one.
  const message = body.message as Record<string, unknown> | undefined;
  if (message && typeof message === "object" && (message as { id?: string }).id) {
    await repos.chat.insertHomeMessage(
      message as unknown as Parameters<typeof repos.chat.insertHomeMessage>[0],
    );
  }
  return { ok: true, reply };
}

async function cmdRegenerateGoalPlan(
  body: Record<string, unknown>,
): Promise<unknown> {
  const payload =
    (body.payload as Record<string, unknown> | undefined) ?? body ?? {};
  const result = await runAI("generate-goal-plan", payload, "planning");
  return { ok: true, result };
}

async function cmdReallocateGoalPlan(
  body: Record<string, unknown>,
): Promise<unknown> {
  const payload =
    (body.payload as Record<string, unknown> | undefined) ?? body ?? {};
  const result = await runAI("reallocate", payload, "daily");
  return { ok: true, result };
}

async function cmdConfirmGoalPlan(
  body: Record<string, unknown>,
): Promise<unknown> {
  const goalId = body.goalId as string | undefined;
  if (!goalId) throw new Error("command:confirm-goal-plan requires args.goalId");
  const existing = await repos.goals.get(goalId);
  if (!existing) throw new Error(`goal ${goalId} not found`);
  await repos.goals.upsert({ ...existing, planConfirmed: true });
  return { ok: true, goalId };
}

// ── Dispatcher ───────────────────────────────────────────────

commandsRouter.post("/:kind", async (req, res) => {
  const slug = req.params.kind;
  const kind = `command:${slug}` as CommandKind;
  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    let result: unknown;
    switch (kind) {
      case "command:create-goal":
        result = await cmdCreateGoal(body);
        break;
      case "command:update-goal":
        result = await cmdUpdateGoal(body);
        break;
      case "command:delete-goal":
        result = await cmdDeleteGoal(body);
        break;
      case "command:toggle-task":
        result = await cmdToggleTask(body);
        break;
      case "command:confirm-pending-task":
        result = await cmdConfirmPendingTask(body);
        break;
      case "command:reject-pending-task":
        result = await cmdRejectPendingTask(body);
        break;
      case "command:upsert-calendar-event":
        result = await cmdUpsertCalendarEvent(body);
        break;
      case "command:delete-calendar-event":
        result = await cmdDeleteCalendarEvent(body);
        break;
      case "command:upsert-reminder":
        result = await cmdUpsertReminder(body);
        break;
      case "command:acknowledge-reminder":
        result = await cmdAcknowledgeReminder(body);
        break;
      case "command:delete-reminder":
        result = await cmdDeleteReminder(body);
        break;
      case "command:save-monthly-context":
        result = await cmdSaveMonthlyContext(body);
        break;
      case "command:delete-monthly-context":
        result = await cmdDeleteMonthlyContext(body);
        break;
      case "command:update-settings":
        result = await cmdUpdateSettings(body);
        break;
      case "command:complete-onboarding":
        result = await cmdCompleteOnboarding(body);
        break;
      case "command:reset-data":
        result = await cmdResetData();
        break;
      case "command:start-chat-stream":
        result = await cmdStartChatStream(body);
        break;
      case "command:send-chat-message":
        result = await cmdSendChatMessage(body);
        break;
      case "command:regenerate-goal-plan":
        result = await cmdRegenerateGoalPlan(body);
        break;
      case "command:reallocate-goal-plan":
        result = await cmdReallocateGoalPlan(body);
        break;
      case "command:confirm-goal-plan":
        result = await cmdConfirmGoalPlan(body);
        break;
      default: {
        // Unknown slug: the URL didn't match any known command. 404 with
        // a standardized error envelope so the client can distinguish
        // this from a runtime handler failure.
        res
          .status(404)
          .json(
            envelopeError(
              kind,
              "unknown_command",
              `Unknown command kind: ${kind}`,
            ),
          );
        return;
      }
    }
    // Success: fire the view invalidation WS event THEN respond.
    // If invalidation throws we still want the caller to see the write
    // succeeded, so we swallow the error (logging it) — losing an
    // invalidation is a soft failure.
    try {
      invalidate(kind);
    } catch (err) {
      console.warn("[commands] view invalidation failed:", err);
    }
    res.json(envelope(kind, result));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Intentionally do NOT fire view:invalidate on failure.
    res.status(500).json(envelopeError(kind, "command_failed", message));
  }
});

export default commandsRouter;
