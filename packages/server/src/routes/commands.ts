/* NorthStar server — commands route
 *
 * POST /commands/:kind — single entry point for every mutation in the
 * system. `kind` in the URL is the raw slug without the `command:`
 * prefix, i.e. POST /commands/toggle-task → command:toggle-task.
 *
 * Each case in the big switch delegates to a per-command handler
 * defined in the domain modules under ./commands/. After a successful
 * mutation we also emit `view:invalidate` over WS so connected clients
 * know to refetch the affected views.
 *
 * Failed commands do NOT emit view:invalidate — a client that sees an
 * error shouldn't then refetch the view and think nothing changed.
 */

import { Router } from "express";
import { envelope, envelopeError } from "@northstar/core";
import type { CommandKind, QueryKind } from "@northstar/core";

import {
  invalidate,
  cmdCreateGoal,
  cmdUpdateGoal,
  cmdDeleteGoal,
  cmdConfirmGoalPlan,
  cmdToggleTask,
  cmdSkipTask,
  cmdDeleteTask,
  cmdDeleteTasksForDate,
  cmdUpdateTask,
  cmdConfirmPendingTask,
  cmdRejectPendingTask,
  cmdCreatePendingTask,
  cmdDeferOverflow,
  cmdUndoDefer,
  cmdDismissNudge,
  cmdRegenerateGoalPlan,
  cmdReallocateGoalPlan,
  cmdConfirmDailyTasks,
  cmdRegenerateDailyTasks,
  cmdAdaptiveReschedule,
  cmdStartChatStream,
  cmdSendChatMessage,
  cmdClearHomeChat,
  cmdUpsertCalendarEvent,
  cmdDeleteCalendarEvent,
  cmdUpsertReminder,
  cmdAcknowledgeReminder,
  cmdDeleteReminder,
  cmdDeleteRemindersBatch,
  cmdSaveMonthlyContext,
  cmdDeleteMonthlyContext,
  cmdUpdateSettings,
  cmdCompleteOnboarding,
  cmdResetData,
} from "./commands/index";

const commandsRouter = Router();

// ── Dispatcher ───────────────────────────────────────────────

commandsRouter.post("/:kind", async (req, res) => {
  const slug = req.params.kind;
  const kind = `command:${slug}` as CommandKind;
  // Transport wraps command args in `{ v, kind, args: {...} }`. Unwrap so
  // individual cmd* handlers can read fields flat off `body`. Fall back to
  // the raw body for any caller that still posts args at the top level.
  const rawBody = (req.body ?? {}) as Record<string, unknown>;
  const body =
    (rawBody.args as Record<string, unknown> | undefined) ?? rawBody;
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
      case "command:skip-task":
        result = await cmdSkipTask(body);
        break;
      case "command:delete-task":
        result = await cmdDeleteTask(body);
        break;
      case "command:delete-tasks-for-date":
        result = await cmdDeleteTasksForDate(body);
        break;
      case "command:update-task":
        result = await cmdUpdateTask(body);
        break;
      case "command:confirm-pending-task":
        result = await cmdConfirmPendingTask(body);
        break;
      case "command:reject-pending-task":
        result = await cmdRejectPendingTask(body);
        break;
      case "command:create-pending-task":
        result = await cmdCreatePendingTask(body);
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
      case "command:delete-reminders-batch":
        result = await cmdDeleteRemindersBatch(body);
        break;
      case "command:defer-overflow":
        result = await cmdDeferOverflow(body);
        break;
      case "command:undo-defer":
        result = await cmdUndoDefer(body);
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
      case "command:clear-home-chat":
        result = await cmdClearHomeChat();
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
      case "command:adaptive-reschedule":
        result = await cmdAdaptiveReschedule(body);
        break;
      case "command:confirm-daily-tasks":
        result = await cmdConfirmDailyTasks(body);
        break;
      case "command:regenerate-daily-tasks":
        result = await cmdRegenerateDailyTasks(body);
        break;
      case "command:dismiss-nudge":
        result = await cmdDismissNudge(body);
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
    // Handlers may return `_invalidateExtra` to dynamically add views
    // that depend on runtime target (e.g. goal-plan vs. home chat).
    try {
      const extra =
        (result && typeof result === "object"
          ? ((result as { _invalidateExtra?: QueryKind[] })._invalidateExtra ??
            [])
          : []) as QueryKind[];
      invalidate(kind, extra);
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
