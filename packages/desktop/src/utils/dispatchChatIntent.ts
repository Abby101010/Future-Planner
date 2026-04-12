import type {
  CalendarEvent,
  CommandKind,
  DailyTask,
  Goal,
  Reminder,
} from "@northstar/core";

type RunFn = <T>(kind: CommandKind, args: Record<string, unknown>) => Promise<T>;

export interface IntentDispatchContext {
  run: RunFn;
  goals: Goal[];
  todayTasks: DailyTask[];
  todayEvents: CalendarEvent[];
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

function eventMatchesTerm(e: CalendarEvent, term: string): boolean {
  const t = term.toLowerCase();
  if (t === "all" || t === "today" || t === "everything") return true;
  return (e.title || "").toLowerCase().includes(t);
}

function resolveEventTargets(
  all: CalendarEvent[],
  eventId: string | undefined,
  match: string | undefined,
  isDeleteAll: boolean,
): CalendarEvent[] {
  if (eventId) {
    const found = all.find((e) => e.id === eventId);
    return found ? [found] : [];
  }
  const terms = splitMatchTerms(match);
  if (isDeleteAll && (terms.length === 0 || terms.includes("all") || terms.includes("today"))) {
    return [...all];
  }
  if (terms.length === 0) return [];
  return all.filter((e) => terms.some((term) => eventMatchesTerm(e, term)));
}

export async function dispatchChatIntent(
  intent: unknown,
  ctx: IntentDispatchContext,
): Promise<"pending-goal" | null> {
  const i = intent as Record<string, unknown>;
  if (!i || !i.kind) return null;

  const { run, goals, todayTasks, todayEvents, activeReminders, todayDate } = ctx;
  const cmd = (kind: string) => kind as CommandKind;

  switch (i.kind) {
    case "event": {
      const event = i.entity as CalendarEvent;
      await run(cmd("command:upsert-calendar-event"), { event });
      break;
    }
    case "goal": {
      // Don't auto-create goals — return a signal so the Chat component
      // can show a confirmation card and let the user review first.
      return "pending-goal";
    }
    case "reminder": {
      const reminder = i.entity as Record<string, unknown>;
      await run(cmd("command:upsert-reminder"), { reminder });
      break;
    }
    case "task": {
      const pt = i.pendingTask as Record<string, unknown> | undefined;
      if (pt?.userInput) {
        await run(cmd("command:create-pending-task"), {
          id: pt.id ?? crypto.randomUUID(),
          userInput: pt.userInput,
          status: "analyzing",
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
      } else if (i.action === "reschedule") {
        await run(cmd("command:skip-task"), { taskId: i.taskId });
        if (i.rescheduleDate) {
          const pendingId = crypto.randomUUID();
          await run(cmd("command:create-pending-task"), {
            id: pendingId,
            userInput: task.title,
            status: "ready",
            analysis: {
              title: task.title,
              description: task.description || "",
              suggestedDate: i.rescheduleDate,
              durationMinutes: task.durationMinutes || 30,
              cognitiveWeight: task.cognitiveWeight || 3,
              priority: task.priority || "should-do",
              category: task.category || "planning",
              reasoning: "Rescheduled via chat",
            },
          });
          await run(cmd("command:confirm-pending-task"), { pendingId });
        }
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
          await run(cmd("command:upsert-reminder"), {
            reminder: {
              ...target,
              title: patch?.title ?? target.title,
              description: patch?.description ?? target.description,
              reminderTime: patch?.reminderTime ?? target.reminderTime,
              date: patch?.date ?? target.date,
              repeat: patch?.repeat !== undefined ? patch.repeat : target.repeat,
            },
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
      const resolved = resolveEventTargets(
        todayEvents,
        i.eventId as string | undefined,
        i.match as string | undefined,
        i.action === "delete_all",
      );
      if (i.action === "delete" || i.action === "delete_all") {
        for (const target of resolved) {
          await run(cmd("command:delete-calendar-event"), { eventId: target.id });
        }
      } else if (i.action === "edit" || i.action === "reschedule") {
        const patch = i.patch as Record<string, unknown> | undefined;
        for (const target of resolved) {
          await run(cmd("command:upsert-calendar-event"), {
            event: {
              ...target,
              title: patch?.title ?? target.title,
              startDate: patch?.startDate ?? target.startDate,
              endDate: patch?.endDate ?? target.endDate,
              category: (patch?.category ?? target.category) as CalendarEvent["category"],
            },
          });
        }
      }
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
