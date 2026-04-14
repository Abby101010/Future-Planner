/* NorthStar server — command → view invalidation table
 *
 * When a command mutates state, we emit a WS `view:invalidate` event so
 * connected clients know to refetch any page whose data just changed.
 * This module is the single source of truth for "which views does each
 * command touch", so command handlers don't hardcode the list inline.
 *
 * Keep the mapping conservative: err on the side of listing a view even
 * if it only "might" be affected — a redundant refetch is cheaper than
 * stale data on the client.
 *
 * If you're adding a new CommandKind: add it to packages/core/src/protocol/
 * kinds.ts first, then add its entry here. TypeScript will error until you
 * do.
 */

import type { CommandKind, QueryKind } from "@northstar/core";

/** Every QueryKind in the system — used for `reset-data` which blows
 *  everything away and needs to invalidate every cached view. */
export const ALL_QUERY_KINDS: QueryKind[] = [
  "view:dashboard",
  "view:tasks",
  "view:calendar",
  "view:roadmap",
  "view:planning",
  "view:settings",
  "view:news-feed",
  "view:onboarding",
  "view:goal-plan",
  "view:goal-breakdown",
];

export const commandToInvalidations: Record<CommandKind, QueryKind[]> = {
  "command:create-goal": [
    "view:dashboard",
    "view:roadmap",
    "view:planning",
    "view:goal-plan",
    "view:goal-breakdown",
  ],
  "command:update-goal": [
    "view:dashboard",
    "view:roadmap",
    "view:planning",
    "view:goal-plan",
    "view:goal-breakdown",
  ],
  "command:delete-goal": [
    "view:dashboard",
    "view:roadmap",
    "view:planning",
    "view:goal-plan",
    "view:goal-breakdown",
  ],
  "command:create-task": ["view:dashboard", "view:tasks", "view:calendar"],
  "command:toggle-task": ["view:dashboard", "view:tasks", "view:calendar", "view:planning", "view:goal-plan"],
  "command:skip-task": ["view:dashboard", "view:tasks", "view:calendar"],
  "command:delete-task": ["view:dashboard", "view:tasks", "view:calendar", "view:goal-plan"],
  "command:delete-tasks-for-date": ["view:dashboard", "view:tasks", "view:calendar", "view:goal-plan"],
  "command:update-task": ["view:dashboard", "view:tasks", "view:calendar", "view:goal-plan"],
  "command:confirm-pending-task": ["view:dashboard", "view:tasks", "view:calendar"],
  "command:reject-pending-task": ["view:dashboard", "view:tasks"],
  "command:create-pending-task": ["view:dashboard", "view:tasks"],
  "command:upsert-reminder": ["view:dashboard", "view:tasks", "view:settings"],
  "command:acknowledge-reminder": ["view:dashboard", "view:tasks", "view:settings"],
  "command:delete-reminder": ["view:dashboard", "view:tasks", "view:settings"],
  "command:delete-reminders-batch": ["view:dashboard", "view:tasks", "view:settings"],
  "command:defer-overflow": ["view:dashboard", "view:tasks", "view:calendar"],
  "command:undo-defer": ["view:dashboard", "view:tasks", "view:calendar"],
  "command:save-monthly-context": ["view:planning", "view:dashboard"],
  "command:delete-monthly-context": ["view:planning", "view:dashboard"],
  "command:update-settings": ["view:settings"],
  "command:complete-onboarding": ["view:onboarding", "view:dashboard"],
  "command:reset-data": ALL_QUERY_KINDS,
  // Chat commands default to the home chat surface. The goal-plan chat
  // flows through regenerate/reallocate/confirm below, not send-chat-message.
  "command:start-chat-stream": ["view:dashboard"],
  "command:send-chat-message": ["view:dashboard"],
  "command:clear-home-chat": ["view:dashboard"],
  "command:confirm-goal-plan": [
    "view:goal-plan",
    "view:dashboard",
    "view:tasks",
  ],
  "command:regenerate-goal-plan": [
    "view:goal-plan",
    "view:dashboard",
    "view:tasks",
  ],
  "command:reallocate-goal-plan": [
    "view:goal-plan",
    "view:dashboard",
    "view:tasks",
  ],
  "command:adaptive-reschedule": [
    "view:goal-plan",
    "view:dashboard",
    "view:tasks",
  ],
  "command:adjust-all-overloaded-plans": [
    "view:goal-plan",
    "view:dashboard",
    "view:tasks",
  ],
  "command:regenerate-daily-tasks": [
    "view:dashboard",
    "view:tasks",
    "view:calendar",
  ],
  "command:confirm-daily-tasks": [
    "view:dashboard",
    "view:tasks",
    "view:calendar",
  ],
  "command:generate-bonus-task": [
    "view:dashboard",
    "view:tasks",
  ],
  "command:accept-task-proposal": [
    "view:dashboard",
    "view:tasks",
    "view:calendar",
  ],
  "command:reschedule-task": [
    "view:dashboard",
    "view:tasks",
    "view:calendar",
  ],
  "command:snooze-reschedule": [
    "view:tasks",
  ],
  "command:dismiss-reschedule": [
    "view:tasks",
  ],
  "command:dismiss-nudge": [
    "view:dashboard",
    "view:tasks",
  ],
  "command:cant-complete-task": [
    "view:dashboard",
    "view:tasks",
    "view:goal-plan",
  ],
  "command:add-task-to-plan": [
    "view:dashboard",
    "view:tasks",
    "view:calendar",
  ],
  "command:refresh-daily-plan": [
    "view:dashboard",
    "view:tasks",
    "view:calendar",
  ],
  "command:set-vacation-mode": [
    "view:dashboard",
    "view:tasks",
    "view:settings",
  ],
};
