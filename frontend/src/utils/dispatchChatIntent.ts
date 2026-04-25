import type {
  CommandKind,
  DailyTask,
  Goal,
  Reminder,
} from "@starward/core";

type RunFn = <T>(kind: CommandKind, args: Record<string, unknown>) => Promise<T>;

export interface IntentDispatchContext {
  run: RunFn;
  goals: Goal[];
  todayTasks: DailyTask[];
  activeReminders: Reminder[];
  todayDate: string;
  setView?: (view: string) => void;
  setResearchTopic?: (topic: string) => void;
  refetch?: () => void;
}

function splitMatchTerms(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/,| and |;| or /i)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

function reminderMatchesTerm(r: Reminder, term: string): boolean {
  const t = term.toLowerCase();
  if (t === "all" || t === "everything" || t === "every reminder") return true;
  if (t === "expired") {
    const when = r.reminderTime ?? r.date ?? "";
    return !!when && new Date(when).getTime() < Date.now() && !r.acknowledged;
  }
  if (t === "acknowledged") return r.acknowledged;
  if (t === "unacknowledged") return !r.acknowledged;
  const title = (r.title || "").toLowerCase();
  const desc = (r.description || "").toLowerCase();
  return title.includes(t) || desc.includes(t);
}

function resolveReminderTargets(
  all: Reminder[],
  reminderId: string | undefined,
  match: string | undefined,
  keepMatch: string | undefined,
  isDeleteAll: boolean,
): Reminder[] {
  if (reminderId) {
    const found = all.find((r) => r.id === reminderId);
    return found ? [found] : [];
  }
  const matchTerms = splitMatchTerms(match);
  const isAll = isDeleteAll && (matchTerms.length === 0 || matchTerms.includes("all"));
  let candidates: Reminder[];
  if (isAll) {
    candidates = [...all];
  } else if (matchTerms.length === 0) {
    candidates = [];
  } else {
    candidates = all.filter((r) => matchTerms.some((term) => reminderMatchesTerm(r, term)));
  }
  const keepTerms = splitMatchTerms(keepMatch);
  if (keepTerms.length > 0) {
    candidates = candidates.filter(
      (r) => !keepTerms.some((term) => reminderMatchesTerm(r, term)),
    );
  }
  return candidates;
}

export async function dispatchChatIntent(
  intent: unknown,
  ctx: IntentDispatchContext,
): Promise<"pending-goal" | null> {
  const i = intent as Record<string, unknown>;
  if (!i || !i.kind) return null;

  const { run, goals, todayTasks, activeReminders, todayDate } = ctx;
  const cmd = (kind: string) => kind as CommandKind;

  switch (i.kind) {
    case "event": {
      // Calendar events are now tasks with scheduledTime — create as a pending task
      const entity = i.entity as Record<string, unknown>;
      const pt = {
        id: (entity.id as string) ?? crypto.randomUUID(),
        userInput: (entity.title as string) ?? "Scheduled event",
        status: "analyzing" as const,
      };
      await run(cmd("command:create-pending-task"), pt);
      break;
    }
    case "goal": {
      // Don't auto-create goals — return a signal so the Chat component
      // can show a confirmation card and let the user review first.
      return "pending-goal";
    }
    case "reminder": {
      // Flat shape per API_CONTRACT.md — id auto-generated server-side
      // when omitted. See backend/src/routes/commands/calendar.ts.
      const reminder = i.entity as Record<string, unknown>;
      await run(cmd("command:upsert-reminder"), { ...reminder });
      break;
    }
    case "task": {
      const pt = i.pendingTask as Record<string, unknown> | undefined;
      if (pt?.userInput) {
        await run(cmd("command:create-pending-task"), {
          id: pt.id ?? crypto.randomUUID(),
          userInput: pt.userInput,
          status: "analyzing",
          suggestedDate: pt.suggestedDate ?? todayDate,
        });
      }
      break;
    }
    case "manage-task": {
      if (i.action === "delete_all") {
        await run(cmd("command:delete-tasks-for-date"), { date: todayDate });
        break;
      }
      const task = todayTasks.find((t) => t.id === i.taskId);
      if (!task) break;
      if (i.action === "complete") {
        await run(cmd("command:toggle-task"), { taskId: i.taskId });
      } else if (i.action === "skip") {
        await run(cmd("command:skip-task"), { taskId: i.taskId });
      } else if (i.action === "delete") {
        await run(cmd("command:delete-task"), { taskId: i.taskId });
      } else if (i.action === "reschedule" && i.rescheduleDate) {
        await run(cmd("command:reschedule-task"), {
          taskId: i.taskId,
          targetDate: i.rescheduleDate,
          force: true,
        });
      }
      break;
    }
    case "manage-goal": {
      const targetGoal = goals.find((g) => g.id === i.goalId);
      if (!targetGoal) break;
      if (i.action === "delete") {
        await run(cmd("command:delete-goal"), { goalId: targetGoal.id });
      } else if (i.action === "archive") {
        await run(cmd("command:update-goal"), {
          goal: { ...targetGoal, status: "archived" },
        });
      } else if (i.action === "refresh_plan") {
        await run(cmd("command:update-goal"), {
          goal: { ...targetGoal, plan: null, status: "planning", planChat: [] },
        });
      }
      break;
    }
    case "manage-reminder": {
      const resolved = resolveReminderTargets(
        activeReminders,
        i.reminderId as string | undefined,
        i.match as string | undefined,
        i.keepMatch as string | undefined,
        i.action === "delete_all",
      );
      if (i.action === "delete" || i.action === "delete_all") {
        if (resolved.length === 1) {
          await run(cmd("command:delete-reminder"), { reminderId: resolved[0].id });
        } else if (resolved.length > 1) {
          await run(cmd("command:delete-reminders-batch"), {
            reminderIds: resolved.map((r) => r.id),
          });
        }
      } else if (i.action === "edit") {
        const patch = i.patch as Record<string, unknown> | undefined;
        for (const target of resolved) {
          let newDate = (patch?.date as string | undefined) ?? target.date;
          let newReminderTime = (patch?.reminderTime as string | undefined) ?? target.reminderTime;
          // Sync date and reminderTime when only one changes
          if (patch?.date && !patch?.reminderTime && target.reminderTime) {
            // Date changed but reminderTime didn't — preserve the time part on the new date
            const timePart = target.reminderTime.includes("T")
              ? target.reminderTime.split("T")[1]
              : "09:00:00";
            newReminderTime = `${newDate}T${timePart}`;
          } else if (patch?.reminderTime && !patch?.date) {
            // reminderTime changed but date didn't — extract local date from new reminderTime
            const d = new Date(patch.reminderTime as string);
            const pad = (n: number) => String(n).padStart(2, "0");
            newDate = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
          }
          await run(cmd("command:upsert-reminder"), {
            ...target,
            title: (patch?.title as string | undefined) ?? target.title,
            description: (patch?.description as string | undefined) ?? target.description,
            reminderTime: newReminderTime,
            date: newDate,
            repeat: patch?.repeat !== undefined ? patch.repeat : target.repeat,
          });
        }
      } else if (i.action === "acknowledge") {
        for (const target of resolved) {
          await run(cmd("command:acknowledge-reminder"), { reminderId: target.id });
        }
      }
      break;
    }
    case "manage-event": {
      // Calendar events are now unified as tasks — no-op for legacy intents
      break;
    }
    case "research": {
      if (ctx.setResearchTopic && ctx.setView) {
        ctx.setResearchTopic(i.topic as string);
        setTimeout(() => ctx.setView?.("news-feed"), 600);
      }
      break;
    }
  }

  ctx.refetch?.();
  return null;
}
