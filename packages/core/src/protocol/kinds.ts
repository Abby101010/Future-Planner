export type QueryKind =
  | "view:dashboard"
  | "view:tasks"
  | "view:calendar"
  | "view:roadmap"
  | "view:planning"
  | "view:settings"
  | "view:news-feed"
  | "view:onboarding"
  | "view:goal-plan"
  | "view:goal-breakdown";

export type CommandKind =
  | "command:create-goal"
  | "command:update-goal"
  | "command:delete-goal"
  | "command:toggle-task"
  | "command:confirm-pending-task"
  | "command:reject-pending-task"
  | "command:upsert-calendar-event"
  | "command:delete-calendar-event"
  | "command:upsert-reminder"
  | "command:acknowledge-reminder"
  | "command:delete-reminder"
  | "command:save-monthly-context"
  | "command:delete-monthly-context"
  | "command:update-settings"
  | "command:complete-onboarding"
  | "command:reset-data"
  | "command:start-chat-stream"
  | "command:send-chat-message"
  | "command:confirm-goal-plan"
  | "command:regenerate-goal-plan"
  | "command:reallocate-goal-plan";

export type EventKind =
  | "ai:stream-start"
  | "ai:token-delta"
  | "ai:stream-end"
  | "agent:progress"
  | "view:invalidate"
  | "reminder:triggered";

export type Kind = QueryKind | CommandKind | EventKind;
