/**
 * Barrel re-export for all command handlers and helpers.
 */

export { invalidate, runAI } from "./_helpers";

export {
  cmdCreateGoal,
  cmdUpdateGoal,
  cmdDeleteGoal,
  cmdConfirmGoalPlan,
  cmdPauseGoal,
  cmdResumeGoal,
} from "./goals";

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
  cmdTrimToday,
  cmdDismissNudge,
  cmdRescheduleTask,
  cmdSnoozeReschedule,
  cmdDismissReschedule,
  cmdCantCompleteTask,
  cmdAddTaskToPlan,
  cmdAnalyzeImage,
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
  cmdSubmitPriorityFeedback,
  cmdProposeGapFillers,
  cmdRequestEscalation,
  cmdPlanEditClassify,
  cmdAcceptPendingAction,
  cmdRejectPendingAction,
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

export {
  cmdUpdateGoalNotes,
  cmdEditGoalTitle,
  cmdEditMilestone,
  cmdRegenerateInsights,
  cmdAddGoalReflection,
} from "./dashboard";

export {
  cmdSendOnboardingMessage,
  cmdProposeOnboardingGoal,
  cmdConfirmOnboardingGoal,
  cmdAcceptOnboardingPlan,
  cmdCommitFirstTask,
} from "./onboarding";
