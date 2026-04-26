/* Starward server — commands route
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
import { envelope, envelopeError } from "@starward/core";
import type { CommandKind, QueryKind } from "@starward/core";
import { insertJob } from "../job-db";
import { getCurrentUserId } from "../middleware/requestContext";

import {
  invalidate,
  cmdCreateGoal,
  cmdUpdateGoal,
  cmdDeleteGoal,
  cmdConfirmGoalPlan,
  cmdExpandPlanWeek,
  cmdCreateTask,
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
  cmdTrimToday,
  cmdDismissNudge,
  cmdRescheduleTask,
  cmdSnoozeReschedule,
  cmdDismissReschedule,
  cmdCantCompleteTask,
  cmdAddTaskToPlan,
  cmdRegenerateGoalPlan,
  cmdReallocateGoalPlan,
  cmdConfirmDailyTasks,
  cmdRefreshDailyPlan,
  cmdRegenerateDailyTasks,
  cmdAdaptiveReschedule,
  cmdAdjustAllOverloadedPlans,
  cmdGenerateBonusTask,
  cmdAcceptTaskProposal,
  cmdStartChatStream,
  cmdSendChatMessage,
  cmdClearHomeChat,
  cmdUpsertReminder,
  cmdAcknowledgeReminder,
  cmdDeleteReminder,
  cmdDeleteRemindersBatch,
  cmdSaveMonthlyContext,
  cmdDeleteMonthlyContext,
  cmdUpdateSettings,
  cmdSetVacationMode,
  cmdCompleteOnboarding,
  cmdResetData,
  cmdHealAllGoalPlans,
  cmdEstimateTaskDurations,
  cmdSetTaskTimeBlock,
  cmdSetTaskProjectTag,
  cmdSubmitPriorityFeedback,
  cmdPauseGoal,
  cmdResumeGoal,
  cmdProposeGapFillers,
  cmdRequestEscalation,
  cmdPlanEditClassify,
  cmdAcceptPendingAction,
  cmdRejectPendingAction,
  cmdAnalyzeImage,
  cmdUpdateGoalNotes,
  cmdEditGoalTitle,
  cmdEditMilestone,
  cmdRegenerateInsights,
  cmdAddGoalReflection,
  cmdSendOnboardingMessage,
  cmdProposeOnboardingGoal,
  cmdConfirmOnboardingGoal,
  cmdAcceptOnboardingPlan,
  cmdCommitFirstTask,
} from "./commands/index";

const commandsRouter = Router();

// ── Job status polling (fallback if WS event is missed) ──────

commandsRouter.get("/job-status/:jobId", async (req, res) => {
  const userId = getCurrentUserId();
  const { getJob } = await import("../job-db");
  const job = await getJob(userId, req.params.jobId);
  if (!job) {
    res.status(404).json({ ok: false, error: "Job not found" });
    return;
  }
  res.json({ ok: true, job: { id: job.id, type: job.type, status: job.status, result: job.result, error: job.error } });
});

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
      case "command:pause-goal":
        result = await cmdPauseGoal(body);
        break;
      case "command:resume-goal":
        result = await cmdResumeGoal(body);
        break;
      case "command:create-task":
        result = await cmdCreateTask(body);
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
      case "command:trim-today":
        result = await cmdTrimToday(body);
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
      case "command:regenerate-goal-plan": {
        const userId = getCurrentUserId();
        const jobId = await insertJob(userId, "regenerate-goal-plan", body);
        result = { ok: true, jobId, async: true };
        break;
      }
      case "command:reallocate-goal-plan":
        result = await cmdReallocateGoalPlan(body);
        break;
      case "command:confirm-goal-plan":
        result = await cmdConfirmGoalPlan(body);
        break;
      case "command:expand-plan-week":
        result = await cmdExpandPlanWeek(body);
        break;
      case "command:adaptive-reschedule": {
        const userId = getCurrentUserId();
        const jobId = await insertJob(userId, "adaptive-reschedule", body);
        result = { ok: true, jobId, async: true };
        break;
      }
      case "command:adjust-all-overloaded-plans": {
        const userId = getCurrentUserId();
        const jobId = await insertJob(userId, "adjust-all-overloaded-plans", body);
        result = { ok: true, jobId, async: true };
        break;
      }
      case "command:confirm-daily-tasks":
        result = await cmdConfirmDailyTasks(body);
        break;
      case "command:refresh-daily-plan":
        result = await cmdRefreshDailyPlan(body);
        break;
      case "command:regenerate-daily-tasks":
        result = await cmdRegenerateDailyTasks(body);
        break;
      case "command:generate-bonus-task":
        result = await cmdGenerateBonusTask(body);
        break;
      case "command:accept-task-proposal":
        result = await cmdAcceptTaskProposal(body);
        break;
      case "command:reschedule-task":
        result = await cmdRescheduleTask(body);
        break;
      case "command:snooze-reschedule":
        result = await cmdSnoozeReschedule(body);
        break;
      case "command:dismiss-reschedule":
        result = await cmdDismissReschedule(body);
        break;
      case "command:dismiss-nudge":
        result = await cmdDismissNudge(body);
        break;
      case "command:cant-complete-task":
        result = await cmdCantCompleteTask(body);
        break;
      case "command:add-task-to-plan":
        result = await cmdAddTaskToPlan(body);
        break;
      case "command:set-vacation-mode":
        result = await cmdSetVacationMode(body);
        break;
      case "command:heal-all-goal-plans" as CommandKind:
        result = await cmdHealAllGoalPlans();
        break;
      case "command:estimate-task-durations":
        result = await cmdEstimateTaskDurations(body);
        break;
      case "command:set-task-time-block":
        result = await cmdSetTaskTimeBlock(body);
        break;
      case "command:set-task-project-tag":
        result = await cmdSetTaskProjectTag(body);
        break;
      case "command:submit-priority-feedback":
        result = await cmdSubmitPriorityFeedback(body);
        break;
      case "command:propose-gap-fillers":
        result = await cmdProposeGapFillers(body);
        break;
      case "command:request-escalation":
        result = await cmdRequestEscalation(body);
        break;
      case "command:plan-edit-classify":
        result = await cmdPlanEditClassify(body);
        break;
      case "command:accept-pending-action":
        result = await cmdAcceptPendingAction(body);
        break;
      case "command:reject-pending-action":
        result = await cmdRejectPendingAction(body);
        break;
      case "command:analyze-image":
        result = await cmdAnalyzeImage(body);
        break;
      case "command:update-goal-notes":
        result = await cmdUpdateGoalNotes(body);
        break;
      case "command:edit-goal-title":
        result = await cmdEditGoalTitle(body);
        break;
      case "command:edit-milestone":
        result = await cmdEditMilestone(body);
        break;
      case "command:regenerate-insights":
        result = await cmdRegenerateInsights(body);
        break;
      case "command:add-goal-reflection":
        result = await cmdAddGoalReflection(body);
        break;
      case "command:send-onboarding-message":
        result = await cmdSendOnboardingMessage(body);
        break;
      case "command:propose-onboarding-goal":
        result = await cmdProposeOnboardingGoal(body);
        break;
      case "command:confirm-onboarding-goal":
        result = await cmdConfirmOnboardingGoal(body);
        break;
      case "command:accept-onboarding-plan":
        result = await cmdAcceptOnboardingPlan(body);
        break;
      case "command:commit-first-task":
        result = await cmdCommitFirstTask(body);
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
      const resultObj = result && typeof result === "object" ? result as Record<string, unknown> : {};
      const extra = (resultObj._invalidateExtra ?? []) as QueryKind[];
      const scope = resultObj._scope as { date?: string; entityId?: string; entityType?: string } | undefined;
      invalidate(kind, extra, scope);
    } catch (err) {
      console.warn("[commands] view invalidation failed:", err);
    }
    res.json(envelope(kind, result));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Honor a `status` field on typed errors (UnauthenticatedError →
    // 401, EntityNotFoundError → 404). Falls back to 500 for plain
    // Errors so legacy throws keep their existing wire shape.
    const errStatus = err instanceof Error
      ? (err as unknown as { status?: unknown }).status
      : undefined;
    const status = typeof errStatus === "number" ? errStatus : 500;
    const code =
      status === 404 ? "not_found" : status === 401 ? "unauthenticated" : "command_failed";
    // Intentionally do NOT fire view:invalidate on failure.
    res.status(status).json(envelopeError(kind, code, message));
  }
});

export default commandsRouter;
