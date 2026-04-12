/**
 * Barrel re-export for all command handlers and helpers.
 */

export { invalidate, runAI } from "./_helpers";

export { cmdCreateGoal, cmdUpdateGoal, cmdDeleteGoal, cmdConfirmGoalPlan } from "./goals";

export {
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
  deferScore,
  tomorrowOf,
} from "./tasks";

export {
  cmdRegenerateGoalPlan,
  cmdReallocateGoalPlan,
  cmdConfirmDailyTasks,
  cmdRegenerateDailyTasks,
  cmdAdaptiveReschedule,
} from "./planning";

export { cmdStartChatStream, cmdSendChatMessage, cmdClearHomeChat } from "./chat";

export {
  cmdUpsertCalendarEvent,
  cmdDeleteCalendarEvent,
  cmdUpsertReminder,
  cmdAcknowledgeReminder,
  cmdDeleteReminder,
  cmdDeleteRemindersBatch,
} from "./calendar";

export {
  cmdSaveMonthlyContext,
  cmdDeleteMonthlyContext,
  cmdUpdateSettings,
  cmdCompleteOnboarding,
  cmdResetData,
} from "./settings";
