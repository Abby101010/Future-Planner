/* NorthStar server — repositories barrel
 *
 * Re-exports every aggregate repository as a namespace so callers can
 * write:
 *
 *     import * as repos from "../repositories";
 *     const list = await repos.goals.list();
 *     await repos.dailyTasks.toggleCompleted(taskId);
 *
 * Conversations are covered by chatRepo (listConversations / upsertConversation /
 * getConversation live there alongside the chat_sessions/home_chat_messages
 * helpers), so there is no separate conversationsRepo file.
 */

export * as goals from "./goalsRepo";
export * as goalPlan from "./goalPlanRepo";
export * as dailyLogs from "./dailyLogsRepo";
export * as dailyTasks from "./dailyTasksRepo";
export * as pendingTasks from "./pendingTasksRepo";
export * as heatmap from "./heatmapRepo";
export * as chat from "./chatRepo";
export * as monthlyContext from "./monthlyContextRepo";
export * as calendar from "./calendarRepo";
export * as reminders from "./remindersRepo";
export * as nudges from "./nudgesRepo";
export * as vacationMode from "./vacationModeRepo";
export * as behaviorProfile from "./behaviorProfileRepo";
export * as users from "./usersRepo";
export * as roadmap from "./roadmapRepo";

export { UnauthenticatedError } from "./_context";
