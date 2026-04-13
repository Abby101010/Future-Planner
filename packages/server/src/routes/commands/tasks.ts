/**
 * Task-related command handlers (daily tasks, pending tasks, defer/undo).
 */

import { repos } from "./_helpers";
import { runBudgetCheck } from "../../agents/gatekeeper";
import {
  recordTaskCompleted,
  recordTaskSkipped,
  recordTaskUncompleted,
} from "../../services/signalRecorder";

export async function cmdCreateTask(
  body: Record<string, unknown>,
): Promise<unknown> {
  const id = (body.id as string | undefined) ?? crypto.randomUUID();
  const date = body.date as string | undefined;
  const title = body.title as string | undefined;
  if (!date || !title) {
    throw new Error("command:create-task requires args.date and args.title");
  }
  const payload = (body.payload as Record<string, unknown> | undefined) ?? {};
  const existing = await repos.dailyTasks.listForDate(date);
  await repos.dailyTasks.insert({
    id,
    date,
    title,
    completed: false,
    orderIndex: existing.length,
    payload,
  });
  return { ok: true, taskId: id };
}

export async function cmdToggleTask(
  body: Record<string, unknown>,
): Promise<unknown> {
  const taskId = body.taskId as string | undefined;
  if (!taskId) throw new Error("command:toggle-task requires args.taskId");

  // Try toggling as a daily task first.
  const next = await repos.dailyTasks.toggleCompleted(taskId);

  if (next !== null) {
    // Successfully toggled a daily task — sync state to the linked
    // goal plan node so the goal-plan page reflects it.
    const task = await repos.dailyTasks.get(taskId);
    if (task?.planNodeId) {
      try {
        await repos.goalPlan.patchNodePayload(task.planNodeId, {
          completed: next,
          completedAt: next ? new Date().toISOString() : null,
        });
      } catch (err) {
        console.warn("[toggle-task] failed to sync plan node:", err);
      }
    }
    // Record behavioral signal for capacity profiling
    if (task) {
      const pl = task.payload as Record<string, unknown>;
      const category = (pl?.category as string) ?? "planning";
      const duration = (pl?.durationMinutes as number) ?? undefined;
      if (next) {
        recordTaskCompleted(task.title, category, duration);
      } else {
        recordTaskUncompleted(task.title);
      }
    }
    return { ok: true, taskId, completed: next };
  }

  // Not found in daily_tasks — the id might be a goal_plan_node id
  // (user toggled directly on the goal plan page).
  const planNode = await repos.goalPlan.getNode(taskId);
  if (planNode && planNode.nodeType === "task") {
    const wasCompleted = Boolean(planNode.payload.completed);
    const nowCompleted = !wasCompleted;
    await repos.goalPlan.patchNodePayload(taskId, {
      completed: nowCompleted,
      completedAt: nowCompleted ? new Date().toISOString() : null,
    });
    return { ok: true, taskId, completed: nowCompleted };
  }

  return { ok: true, taskId, completed: null };
}

export async function cmdSkipTask(
  body: Record<string, unknown>,
): Promise<unknown> {
  const taskId = body.taskId as string | undefined;
  if (!taskId) throw new Error("command:skip-task requires args.taskId");

  const task = await repos.dailyTasks.get(taskId);
  if (!task) return { ok: true, taskId, skipped: null };

  const isSkipped = !(task.payload as Record<string, unknown>)?.skipped;
  await repos.dailyTasks.update(taskId, {
    payload: { skipped: isSkipped },
  });
  // Record behavioral signal when user skips a task
  if (isSkipped) {
    const pl = task.payload as Record<string, unknown>;
    const category = (pl?.category as string) ?? "planning";
    recordTaskSkipped(task.title, category);
  }
  return { ok: true, taskId, skipped: isSkipped };
}

export async function cmdDeleteTask(
  body: Record<string, unknown>,
): Promise<unknown> {
  const taskId = body.taskId as string | undefined;
  if (!taskId) throw new Error("command:delete-task requires args.taskId");
  await repos.dailyTasks.remove(taskId);
  return { ok: true, taskId };
}

export async function cmdDeleteTasksForDate(
  body: Record<string, unknown>,
): Promise<unknown> {
  const date = body.date as string | undefined;
  if (!date) {
    throw new Error("command:delete-tasks-for-date requires args.date");
  }
  const existing = await repos.dailyTasks.listForDate(date);
  await repos.dailyTasks.removeForDate(date);
  return { ok: true, date, deletedCount: existing.length };
}

export async function cmdUpdateTask(
  body: Record<string, unknown>,
): Promise<unknown> {
  const taskId = body.taskId as string | undefined;
  if (!taskId) throw new Error("command:update-task requires args.taskId");
  const patch = (body.patch as Record<string, unknown> | undefined) ?? {};
  // Split top-level columns from payload fields. Title/date/orderIndex live
  // on the row; everything else (duration, weight, priority, etc.) lives in
  // payload jsonb and is merged by the repo's update() helper.
  const payloadKeys = [
    "description",
    "durationMinutes",
    "cognitiveWeight",
    "priority",
    "category",
    "whyToday",
    "progressContribution",
    "isMomentumTask",
    // Calendar-unified fields
    "scheduledTime",
    "scheduledEndTime",
    "isAllDay",
    "isVacation",
    "recurring",
    "notes",
    "color",
  ];
  const payloadPatch: Record<string, unknown> = {};
  for (const k of payloadKeys) {
    if (k in patch) payloadPatch[k] = patch[k];
  }
  const topPatch: Parameters<typeof repos.dailyTasks.update>[1] = {};
  if (typeof patch.title === "string") topPatch.title = patch.title;
  if (typeof patch.date === "string") topPatch.date = patch.date;
  if (typeof patch.orderIndex === "number") topPatch.orderIndex = patch.orderIndex;
  if (typeof patch.completed === "boolean") topPatch.completed = patch.completed;
  if (Object.keys(payloadPatch).length > 0) topPatch.payload = payloadPatch;
  await repos.dailyTasks.update(taskId, topPatch);
  return { ok: true, taskId };
}

export async function cmdConfirmPendingTask(
  body: Record<string, unknown>,
): Promise<unknown> {
  const pendingId = body.pendingId as string | undefined;
  if (!pendingId) {
    throw new Error("command:confirm-pending-task requires args.pendingId");
  }

  // Mark the pending task as confirmed.
  await repos.pendingTasks.updateStatus(pendingId, "confirmed");

  // Read the pending task to extract its analysis, then insert a real
  // daily task so it shows up in the Tasks page.
  const pending = await repos.pendingTasks.get(pendingId);
  if (pending) {
    const pl = pending.payload;
    const analysis = (pl.analysis ?? null) as {
      title?: string;
      description?: string;
      suggestedDate?: string;
      durationMinutes?: number;
      cognitiveWeight?: number;
      priority?: string;
      category?: string;
      reasoning?: string;
    } | null;

    const today = new Date().toISOString().split("T")[0];
    const date = analysis?.suggestedDate || today;

    const existing = await repos.dailyTasks.listForDate(date);
    const newWeight = analysis?.cognitiveWeight ?? 3;

    const budget = runBudgetCheck(
      existing.map((t) => ({
        cognitiveWeight: (t.payload as Record<string, unknown>)?.cognitiveWeight as number | undefined,
        durationMinutes: (t.payload as Record<string, unknown>)?.durationMinutes as number | undefined,
      })),
      newWeight,
    );

    if (budget.overBudget && body.force !== true) {
      const lowestTask = existing
        .filter((t) => !t.completed)
        .sort((a, b) =>
          ((a.payload as Record<string, unknown>)?.cognitiveWeight as number ?? 3) -
          ((b.payload as Record<string, unknown>)?.cognitiveWeight as number ?? 3),
        )[0];
      return {
        ok: false,
        budgetExceeded: true,
        budget,
        lowestTask: lowestTask
          ? { id: lowestTask.id, title: lowestTask.title, cognitiveWeight: (lowestTask.payload as Record<string, unknown>)?.cognitiveWeight as number ?? 3 }
          : null,
        pendingId,
      };
    }

    const orderIndex = existing.length;

    await repos.dailyTasks.insert({
      id: crypto.randomUUID(),
      date,
      title: analysis?.title || (pl.userInput as string) || pending.title || "Untitled task",
      completed: false,
      orderIndex,
      payload: {
        description: analysis?.description || "",
        durationMinutes: analysis?.durationMinutes ?? 30,
        cognitiveWeight: newWeight,
        priority: analysis?.priority || "should-do",
        category: analysis?.category || "planning",
        whyToday: analysis?.reasoning || "",
        source: "pending-task",
        pendingTaskId: pendingId,
      },
    });
  }

  return { ok: true, pendingId };
}

export async function cmdRejectPendingTask(
  body: Record<string, unknown>,
): Promise<unknown> {
  const pendingId = body.pendingId as string | undefined;
  if (!pendingId) {
    throw new Error("command:reject-pending-task requires args.pendingId");
  }
  await repos.pendingTasks.updateStatus(pendingId, "rejected");
  return { ok: true, pendingId };
}

export async function cmdCreatePendingTask(
  body: Record<string, unknown>,
): Promise<unknown> {
  const id = body.id as string | undefined;
  const userInput = body.userInput as string | undefined;
  const analysis = body.analysis as Record<string, unknown> | undefined;
  const status = (body.status as string) ?? "ready";
  if (!id || !userInput) {
    throw new Error(
      "command:create-pending-task requires args.id and args.userInput",
    );
  }
  await repos.pendingTasks.insert({
    id,
    source: "home-chat",
    title: (analysis?.title as string) ?? userInput,
    status: status as "ready" | "pending" | "analyzing",
    payload: { userInput, analysis: analysis ?? null },
  });
  return { ok: true, id };
}

/** Score a task for deferral: higher score = more likely to get bumped. */
export function deferScore(t: {
  priority?: string;
  cognitiveWeight?: number;
}): number {
  // Lower priority first → bonus > should-do > must-do (descending = bumped first)
  const priRank =
    t.priority === "must-do" ? 0 : t.priority === "should-do" ? 1 : 2;
  const weight = t.cognitiveWeight ?? 3;
  // Within priority, defer lighter-weight tasks first (keeps the heavy work
  // on the original day so the user isn't stuck with only small fluff).
  return priRank * 100 - weight;
}

export function tomorrowOf(date: string): string {
  const d = new Date(date + "T00:00:00");
  d.setDate(d.getDate() + 1);
  return d.toISOString().split("T")[0];
}

/**
 * Move overflow tasks off `date` onto the next day (and further out if
 * that day is also over budget). Persists the original date on each
 * task's payload.deferredFrom so command:undo-defer can put them back.
 *
 * Returns a move log: [{ taskId, title, fromDate, toDate }] so the UI
 * can show "I moved X → Apr 13, Y → Apr 14" inline.
 */
export async function cmdDeferOverflow(
  body: Record<string, unknown>,
): Promise<unknown> {
  const date = body.date as string | undefined;
  if (!date) throw new Error("command:defer-overflow requires args.date");
  const maxWeight = (body.maxWeight as number | undefined) ?? 12;
  const maxTasks = (body.maxTasks as number | undefined) ?? 5;
  const maxMinutes = (body.maxMinutes as number | undefined) ?? 180;

  const tasks = await repos.dailyTasks.listForDate(date);
  // Only consider un-completed, un-skipped tasks for deferral.
  const active = tasks.filter((t) => {
    if (t.completed) return false;
    const pl = t.payload as Record<string, unknown>;
    return !pl?.skipped;
  });

  const weightOf = (t: (typeof active)[number]): number =>
    ((t.payload as Record<string, unknown>).cognitiveWeight as number) ?? 3;
  const minutesOf = (t: (typeof active)[number]): number =>
    ((t.payload as Record<string, unknown>).durationMinutes as number) ?? 30;
  const priorityOf = (t: (typeof active)[number]): string =>
    ((t.payload as Record<string, unknown>).priority as string) ?? "should-do";

  let currentWeight = active.reduce((s, t) => s + weightOf(t), 0);
  let currentMinutes = active.reduce((s, t) => s + minutesOf(t), 0);
  let currentCount = active.length;

  const overloaded =
    currentWeight > maxWeight ||
    currentMinutes > maxMinutes ||
    currentCount > maxTasks;

  if (!overloaded) {
    return { ok: true, moves: [], reason: "not-overloaded" };
  }

  // Pick deferral candidates: highest deferScore first, but always keep
  // at least 2 tasks on the original day so it doesn't feel empty.
  const sorted = [...active].sort(
    (a, b) =>
      deferScore({
        priority: priorityOf(b),
        cognitiveWeight: weightOf(b),
      }) -
      deferScore({
        priority: priorityOf(a),
        cognitiveWeight: weightOf(a),
      }),
  );

  const minKeep = 2;
  const moves: Array<{
    taskId: string;
    title: string;
    fromDate: string;
    toDate: string;
  }> = [];

  for (const t of sorted) {
    if (currentCount <= minKeep) break;
    const stillOver =
      currentWeight > maxWeight ||
      currentMinutes > maxMinutes ||
      currentCount > maxTasks;
    if (!stillOver) break;

    const toDate = tomorrowOf(date);
    // Remember the ORIGINAL date on the first defer. If payload already
    // carries a deferredFrom, keep it so repeated bumps still point
    // back to the source day.
    const existingDeferredFrom = (t.payload as Record<string, unknown>)
      .deferredFrom as string | undefined;
    const deferredFrom = existingDeferredFrom ?? date;

    // Move the task row to the target date and stamp the origin.
    const existingForTarget = await repos.dailyTasks.listForDate(toDate);
    await repos.dailyTasks.update(t.id, {
      date: toDate,
      orderIndex: existingForTarget.length,
      payload: { deferredFrom },
    });

    moves.push({
      taskId: t.id,
      title: t.title,
      fromDate: date,
      toDate,
    });

    currentWeight -= weightOf(t);
    currentMinutes -= minutesOf(t);
    currentCount -= 1;
  }

  return { ok: true, moves };
}

/**
 * Undo a defer batch: find every task whose payload.deferredFrom matches
 * `date` and move it back. Clears the deferredFrom marker.
 */
export async function cmdUndoDefer(
  body: Record<string, unknown>,
): Promise<unknown> {
  const date = body.date as string | undefined;
  if (!date) throw new Error("command:undo-defer requires args.date");
  // Walk a reasonable window forward looking for deferred tasks that
  // point back to `date`. The defer action always pushes to the next
  // day, so a 60-day forward window is overkill but cheap.
  const end = new Date(date + "T00:00:00");
  end.setDate(end.getDate() + 60);
  const range = await repos.dailyTasks.listForDateRange(
    date,
    end.toISOString().split("T")[0],
  );

  const deferred = range.filter(
    (t) =>
      (t.payload as Record<string, unknown>)?.deferredFrom === date &&
      t.date !== date,
  );
  let restoredCount = 0;
  for (const t of deferred) {
    const existingForSource = await repos.dailyTasks.listForDate(date);
    await repos.dailyTasks.update(t.id, {
      date,
      orderIndex: existingForSource.length + restoredCount,
      payload: { deferredFrom: null as unknown as string },
    });
    restoredCount++;
  }
  return { ok: true, restoredCount };
}

export async function cmdDismissNudge(
  body: Record<string, unknown>,
): Promise<unknown> {
  const nudgeId = body.nudgeId as string | undefined;
  if (!nudgeId) throw new Error("command:dismiss-nudge requires args.nudgeId");
  await repos.nudges.dismiss(nudgeId);
  return { ok: true, nudgeId };
}
