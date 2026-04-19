/**
 * Barrel re-export for all command handlers and helpers.
 */

export { invalidate, runAI } from "./_helpers";

export { cmdCreateGoal, cmdUpdateGoal, cmdDeleteGoal, cmdConfirmGoalPlan } from "./goals";

export {
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
  cmdDismissNudge,
  cmdRescheduleTask,
  cmdSnoozeReschedule,
  cmdDismissReschedule,
  cmdCantCompleteTask,
  cmdAddTaskToPlan,
  deferScore,
  tomorrowOf,
} from "./tasks";

export {
  cmdExpandPlanWeek,
  cmdRegenerateGoalPlan,
  cmdReallocateGoalPlan,
  cmdConfirmDailyTasks,
  cmdRefreshDailyPlan,
  cmdRegenerateDailyTasks,
  cmdAdaptiveReschedule,
  cmdAdjustAllOverloadedPlans,
  cmdGenerateBonusTask,
  cmdAcceptTaskProposal,
  cmdHealAllGoalPlans,
} from "./planning";

export { cmdStartChatStream, cmdSendChatMessage, cmdClearHomeChat } from "./chat";

export {
  cmdUpsertReminder,
  cmdAcknowledgeReminder,
  cmdDeleteReminder,
  cmdDeleteRemindersBatch,
} from "./calendar";

export {
  cmdSaveMonthlyContext,
  cmdDeleteMonthlyContext,
  cmdUpdateSettings,
  cmdSetVacationMode,
  cmdCompleteOnboarding,
  cmdResetData,
} from "./settings";

export {
  cmdEstimateTaskDurations,
  cmdSetTaskTimeBlock,
  cmdSetTaskProjectTag,
} from "./timeBlocks";
