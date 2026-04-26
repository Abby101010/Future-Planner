/**
 * Task-related command handlers (daily tasks, pending tasks, defer/undo).
 */

import type { TaskSource } from "@starward/core";
import { repos, runAI, invalidate, getEffectiveDate, getCurrentUserId, emitViewInvalidate } from "./_helpers";
import { emitEntityPatch } from "../../ws/events";
import { runWithUserId } from "../../middleware/requestContext";
import { timezoneStore } from "../../dateUtils";
import { composeIso } from "../../repositories/dailyTasksRepo";
import {
  recordSignal,
  recordTaskCompleted,
  recordTaskSkipped,
  recordTaskUncompleted,
  recordPriorityFeedback,
  recordImageSource,
  type ImageClassification,
  type ImageSourceKind,
} from "../../services/signalRecorder";
import { routeCantComplete } from "../../coordinators/dailyPlanner/cantCompleteRouter";
import { packageCurrentPlan, evaluateCapacity } from "../../coordinators/dailyPlanner/memoryPackager";
import { rotateNextTask } from "../../coordinators/dailyPlanner/taskRotation";

/**
 * Create a daily task. Per API_CONTRACT.md, body shape is
 * `{title, date?, durationMinutes?, ...}` — `title` required, everything
 * else optional. `date` defaults to today (effective date in the user's
 * timezone), matching the auto-default pattern used in
 * cmdUpsertReminder. `id` is auto-generated when omitted. This means
 * the FE can call `command:create-task` with as little as `{title}` and
 * get a valid task scheduled for today. Older code paths that send
 * explicit `date` keep working unchanged.
 *
 * Cognitive-budget interaction: when the target date is already at-or-
 * over `COGNITIVE_BUDGET.MAX_DAILY_TASKS`, the new task is auto-tagged
 * `priority: "bonus"` + `payload.isBonus: true`. We don't refuse the
 * insert (the user explicitly asked for it) — we just classify it
 * correctly so it renders in the bonus tier instead of stretching
 * today's active list past capacity. tasksView.ts:354 filters bonus
 * tasks out of active KPIs, so progress reads stay honest.
 */
export async function cmdCreateTask(
  body: Record<string, unknown>,
): Promise<unknown> {
  const { COGNITIVE_BUDGET } = await import("@starward/core");
  const id = (body.id as string | undefined) ?? crypto.randomUUID();
  const title = body.title as string | undefined;
  if (!title || !title.trim()) {
    throw new Error("command:create-task requires args.title (non-empty string)");
  }
  const date =
    typeof body.date === "string" && body.date
      ? (body.date as string)
      : getEffectiveDate();
  const payload = (body.payload as Record<string, unknown> | undefined) ?? {};
  if (!payload.source) payload.source = "user-created";
  // Derive column-level source from body or goalId
  const source = (body.source as TaskSource | undefined)
    ?? (body.goalId ? "big_goal" : "user_created");
  const existing = await repos.dailyTasks.listForDate(date);

  // Priority policy:
  //
  // 1. Caller-supplied priority always wins (gap-filler proposals,
  //    AI-generated additions that intentionally request bonus, etc.).
  //
  // 2. User-created manual adds default to "must-do". A manual add is
  //    a deliberate user statement of intent; the task should sit in
  //    the active list. If today is already at capacity, triage's
  //    must-do shielding will protect this new task and demote an
  //    existing should-do to bonus instead. If today is already all
  //    must-do, triage emits an `overwhelm` nudge with a swap
  //    candidate (see services/dailyTriage.ts) so the user can choose
  //    which task to demote.
  //
  // 3. Non-user paths (legacy plan-tree materialization, etc.) that
  //    don't set a priority fall back to the prior auto-bonus rule:
  //    when the day is at capacity and no priority was specified,
  //    tag as bonus so the new row doesn't silently push past the
  //    cap. This keeps existing automation behavior intact.
  if (!payload.priority) {
    if (source === "user_created") {
      payload.priority = "must-do";
    } else if (existing.length >= COGNITIVE_BUDGET.MAX_DAILY_TASKS) {
      payload.priority = "bonus";
      payload.isBonus = true;
    }
  }
  // Dual-write: if payload supplies legacy HH:MM schedule, also populate ISO columns.
  const tz = timezoneStore.getStore() || "UTC";
  const scheduledStartIso = composeIso(date, payload.scheduledTime as string | undefined, tz);
  const scheduledEndIso = composeIso(date, payload.scheduledEndTime as string | undefined, tz);
  await repos.dailyTasks.insert({
    id,
    date,
    title,
    goalId: (body.goalId as string | undefined) ?? null,
    planNodeId: (body.planNodeId as string | undefined) ?? null,
    completed: false,
    orderIndex: existing.length,
    source,
    payload,
    scheduledStartIso,
    scheduledEndIso,
  });
  await repos.dailyLogs.ensureExists(date);

  // Server-side success log so live diagnostics can confirm "the add
  // WAS received and the row WAS inserted" — turns the next "did the
  // add work?" question into a one-line `fly logs` answer.
  console.info(
    `[create-task] inserted id=${id} date=${date} source=${source} priority=${(payload.priority as string | undefined) ?? "default"}`,
  );

  // Dispatch the post-mutation pipeline. See JSDoc on
  // services/dailyMutationPipeline.ts for the contract: every task
  // mutation must call this so triage/estimator/etc stay consistent
  // across handlers without each one remembering its own list.
  const { fireDailyMutationPipeline } = await import(
    "../../services/dailyMutationPipeline"
  );
  fireDailyMutationPipeline(date, "create");

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
        await recordTaskCompleted(task.title, category, duration);
        // A-2: implicit priority feedback — completing a task is an
        // implicit vote that its priority/category/day mix was right.
        void recordPriorityFeedback(task.title, "complete", {
          category,
          tier: (pl?.tier as string) ?? undefined,
          dayOfWeek: new Date(task.date + "T00:00:00").getDay(),
        }).catch(() => {});
      } else {
        await recordTaskUncompleted(task.title);
      }
    }

    // Big-goal-specific: recalculate goal progress so the per-goal
    // dashboard reflects this completion.
    if (task && task.source === "big_goal" && task.goalId && next) {
      try {
        await recalcGoalProgress(task.goalId);
      } catch (err) {
        console.warn("[toggle-task] goal progress recalc failed:", err);
      }
    }

    // Always dispatch the post-mutation pipeline (triage + estimator)
    // for the task's date, regardless of completed/uncompleted. Toggling
    // changes which tasks count toward the active list, so the day
    // needs to re-triage even when no rotation happens.
    if (task) {
      const { fireDailyMutationPipeline } = await import(
        "../../services/dailyMutationPipeline"
      );
      fireDailyMutationPipeline(task.date, "toggle");
    }

    // Smart task rotation: any completion frees cognitive budget, so
    // try to backfill with the next best task — regardless of whether
    // the completed task came from a big goal or was user-created.
    // rotateNextTask handles the priority order including a future-day
    // bonus tier (see coordinators/dailyPlanner/taskRotation.ts JSDoc).
    if (task && next) {
      const userId = getCurrentUserId();
      const tz = timezoneStore.getStore() || "UTC";
      const todayForRotation = getEffectiveDate();
      const goalIdForRotation = task.goalId ?? null;
      setImmediate(() => {
        runWithUserId(userId, () =>
          timezoneStore.run(tz, async () => {
            try {
              const result = await rotateNextTask(
                taskId,
                goalIdForRotation,
                todayForRotation,
              );
              if (result.rotated) {
                // Rotation inserted a new row — run triage so its
                // tier/cost gets annotated and the day re-orders.
                // Triage emits its own view:invalidate; no need to
                // duplicate it here.
                try {
                  const { lightTriage } = await import(
                    "../../services/dailyTriage"
                  );
                  await lightTriage(todayForRotation);
                } catch (triageErr) {
                  console.warn(
                    "[toggle-task] post-rotation triage failed:",
                    triageErr,
                  );
                  emitViewInvalidate(userId, {
                    viewKinds: ["view:tasks", "view:dashboard"],
                  });
                }
              }
            } catch (err) {
              console.warn("[toggle-task] smart rotation failed:", err);
            }
          }),
        );
      });
    }

    // Push direct state patch so client can update locally without refetching
    const userId = getCurrentUserId();
    emitEntityPatch(userId, {
      entityType: "task",
      entityId: taskId,
      patch: { completed: next, completedAt: next ? new Date().toISOString() : null },
      date: task?.date,
    });

    return { ok: true, taskId, completed: next, _scope: { date: task?.date, entityId: taskId, entityType: "task" } };
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

    // Sync linked daily_task if one exists (bidirectional sync)
    try {
      const linkedTask = await repos.dailyTasks.findByPlanNodeId(taskId);
      if (linkedTask && linkedTask.completed !== nowCompleted) {
        await repos.dailyTasks.update(linkedTask.id, {
          completed: nowCompleted,
          completedAt: nowCompleted ? new Date().toISOString() : null,
        });
      }
    } catch (err) {
      console.warn("[toggle-task] failed to sync linked daily task:", err);
    }

    // Recalculate goal progress when toggling a plan node
    if (planNode.goalId) {
      try {
        await recalcGoalProgress(planNode.goalId);
      } catch (err) {
        console.warn("[toggle-task] goal progress recalc failed:", err);
      }
    }

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
    await recordTaskSkipped(task.title, category);
    // A-2: implicit priority feedback — a skip is an implicit vote
    // that the task's priority/category/day mix was wrong today.
    void recordPriorityFeedback(task.title, "skip", {
      category,
      tier: (pl?.tier as string) ?? undefined,
      dayOfWeek: new Date(task.date + "T00:00:00").getDay(),
    }).catch(() => {});
  }
  // Dispatch post-mutation pipeline so the day re-triages with one
  // less active task. Skipping → bonus tier promotion / cap relief.
  const { fireDailyMutationPipeline } = await import(
    "../../services/dailyMutationPipeline"
  );
  fireDailyMutationPipeline(task.date, "skip");
  return { ok: true, taskId, skipped: isSkipped };
}

export async function cmdDeleteTask(
  body: Record<string, unknown>,
): Promise<unknown> {
  const taskId = body.taskId as string | undefined;
  if (!taskId) throw new Error("command:delete-task requires args.taskId");
  // Look up the task BEFORE deleting so we know which date to re-triage.
  const task = await repos.dailyTasks.get(taskId);
  await repos.dailyTasks.remove(taskId);
  if (task?.date) {
    const { fireDailyMutationPipeline } = await import(
      "../../services/dailyMutationPipeline"
    );
    fireDailyMutationPipeline(task.date, "delete");
  }
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
  if (existing.length > 0) {
    const { fireDailyMutationPipeline } = await import(
      "../../services/dailyMutationPipeline"
    );
    fireDailyMutationPipeline(date, "delete");
  }
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
  // Dual-write: if the patch adjusts legacy schedule fields, recompute ISO.
  if ("scheduledTime" in payloadPatch || "scheduledEndTime" in payloadPatch || typeof patch.date === "string") {
    const tzUpdate = timezoneStore.getStore() || "UTC";
    const existingTask = await repos.dailyTasks.get(taskId);
    if (existingTask) {
      const targetDate = (topPatch.date ?? existingTask.date) as string;
      const startHHMM = "scheduledTime" in payloadPatch
        ? (payloadPatch.scheduledTime as string | undefined)
        : (existingTask.payload.scheduledTime as string | undefined);
      const endHHMM = "scheduledEndTime" in payloadPatch
        ? (payloadPatch.scheduledEndTime as string | undefined)
        : (existingTask.payload.scheduledEndTime as string | undefined);
      topPatch.scheduledStartIso = composeIso(targetDate, startHHMM, tzUpdate);
      topPatch.scheduledEndIso = composeIso(targetDate, endHHMM, tzUpdate);
    }
  }
  await repos.dailyTasks.update(taskId, topPatch);
  // Dispatch the pipeline. Cross-day update (date changed) re-triages
  // both the source and target dates so neither is left stale.
  const { fireDailyMutationPipeline } = await import(
    "../../services/dailyMutationPipeline"
  );
  const datesToFire = new Set<string>();
  const existingForDate = await repos.dailyTasks.get(taskId);
  if (existingForDate?.date) datesToFire.add(existingForDate.date);
  if (typeof patch.date === "string" && patch.date) datesToFire.add(patch.date);
  if (datesToFire.size > 0) {
    fireDailyMutationPipeline(Array.from(datesToFire), "update");
  }
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

  // Read the pending task to extract its analysis, then route through
  // the Daily Planner Coordinator (memory packager) so the task is
  // properly integrated into the day's plan with capacity checks.
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

    const today = getEffectiveDate();
    const date = analysis?.suggestedDate || today;
    const weight = analysis?.cognitiveWeight ?? 3;
    const minutes = analysis?.durationMinutes ?? 30;

    // Route through the Daily Planner's memory packager —
    // same path as cmdAddTaskToPlan. This evaluates cognitive budget,
    // time budget, and slot count before inserting.
    const pkg = await packageCurrentPlan(date);
    const capacity = evaluateCapacity(pkg, weight, minutes);

    if (!capacity.ok && body.force !== true) {
      return {
        ok: false,
        overBudget: true,
        reason: capacity.reason,
        deferCandidates: capacity.deferCandidates,
        pendingId,
      };
    }

    // Fits (or forced) — insert through the planner
    await repos.dailyTasks.insert({
      id: crypto.randomUUID(),
      date,
      title: analysis?.title || (pl.userInput as string) || pending.title || "Untitled task",
      completed: false,
      orderIndex: pkg.existingTasks.length,
      source: "user_created",
      payload: {
        description: analysis?.description || "",
        durationMinutes: minutes,
        cognitiveWeight: weight,
        priority: analysis?.priority || "should-do",
        category: analysis?.category || "planning",
        whyToday: analysis?.reasoning || "",
        source: "chat-confirmed",
        pendingTaskId: pendingId,
        addedMidDay: true,
      },
    });
    await repos.dailyLogs.ensureExists(date);
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
  // Chat-resolved date: the AI already determined the date from user input
  // (defaults to today when no date was mentioned).
  const chatDate = body.suggestedDate as string | undefined;
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
    payload: { userInput, analysis: analysis ?? null, suggestedDate: chatDate ?? null },
  });

  // If the task was created as "analyzing", trigger the AI analysis in the
  // background. When done, update the pending task to "ready" with the
  // analysis and invalidate the dashboard so the card refreshes.
  if (status === "analyzing" && !analysis) {
    const taskId = id;
    const input = userInput;
    const resolvedDate = chatDate; // preserve across async boundary
    // Capture request-scoped context before the async boundary
    const userId = getCurrentUserId();
    const tz = timezoneStore.getStore() || "UTC";
    setImmediate(() => {
      runWithUserId(userId, () =>
        timezoneStore.run(tz, async () => {
          try {
            const today = getEffectiveDate();
            const targetDate = resolvedDate || today;
            const [todayTasks, goals] = await Promise.all([
              repos.dailyTasks.listForDate(targetDate),
              repos.goals.list(),
            ]);
            const result = (await runAI(
              "analyze-quick-task",
              {
                userInput: input,
                suggestedDate: targetDate,
                existingTasks: todayTasks.map((t) => ({
                  title: t.title,
                  cognitiveWeight: (t.payload.cognitiveWeight as number) ?? 3,
                  durationMinutes: (t.payload.durationMinutes as number) ?? 30,
                  priority: (t.payload.priority as string) ?? "should-do",
                })),
                goals: goals.map((g) => ({ title: g.title, scope: g.scope })),
              },
              "daily",
            )) as Record<string, unknown> | null;

            if (result) {
              // Normalize the AI response keys to camelCase for the frontend.
              // Use chat-resolved date as the authoritative date — only fall
              // back to the AI's suggestion if no date was provided by chat.
              const normalized = {
                title: result.title ?? input,
                description: result.description ?? "",
                suggestedDate: targetDate,
                durationMinutes:
                  result.duration_minutes ?? result.durationMinutes ?? 30,
                cognitiveWeight:
                  result.cognitive_weight ?? result.cognitiveWeight ?? 3,
                priority: result.priority ?? "should-do",
                category: result.category ?? "planning",
                reasoning: result.reasoning ?? "",
              };

              // Store in pool: update pending task to "ready" with the
              // analysis. The task sits here until the user clicks Refresh,
              // which triggers the scenario router to integrate it.
              await repos.pendingTasks.insert({
                id: taskId,
                source: "home-chat",
                title: (normalized.title as string) ?? input,
                status: "ready",
                payload: {
                  userInput: input,
                  analysis: normalized,
                  suggestedDate: targetDate,
                },
              });

              // Invalidate tasks view so the Refresh badge count updates
              emitViewInvalidate(userId, {
                viewKinds: ["view:tasks", "view:dashboard"],
              });
            }
          } catch (err) {
            console.warn(
              "[cmdCreatePendingTask] background analysis failed for",
              taskId,
              err,
            );
          }
        }),
      );
    });
  }

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
  // Per-task target dates from the confirmation card. Falls back to
  // tomorrowOf(date) for tasks without a specific target.
  const taskTargets = (body.taskTargets as Record<string, string> | undefined) ?? {};

  const tasks = await repos.dailyTasks.listForDate(date);
  // Only consider un-completed, un-skipped, non-big-goal tasks for deferral.
  // Big goal tasks belong to the plan timeline and must not be auto-deferred.
  const active = tasks.filter((t) => {
    if (t.completed) return false;
    const pl = t.payload as Record<string, unknown>;
    if (pl?.skipped) return false;
    // Check the DB column (t.source), NOT payload.source. Coordinator-
    // inserted goal plan tasks have source="big_goal" on the column but
    // payload.source is undefined or "plan-materialized".
    if (t.source === "big_goal") return false;
    return true;
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

    const toDate = taskTargets[t.id] ?? tomorrowOf(date);
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
    await repos.dailyLogs.ensureExists(toDate);

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

  // Record nudge feedback as a behavioral signal when provided
  const feedback = body.feedback as string | undefined;
  if (feedback) {
    const isPositive = feedback === "helpful" || feedback === "good";
    await recordSignal(
      isPositive ? "positive_feedback" : "negative_feedback",
      "nudge",
      `${nudgeId}:${feedback}`,
    );
  }

  return { ok: true, nudgeId };
}

// ── Big Goal auto-completion helper ──────────────────────────

/**
 * Recalculate a goal's progress from its plan nodes.
 * If all task-type nodes are completed → auto-complete the goal.
 */
async function recalcGoalProgress(goalId: string): Promise<void> {
  const nodes = await repos.goalPlan.listForGoal(goalId);
  const taskNodes = nodes.filter((n) => n.nodeType === "task");
  if (taskNodes.length === 0) return;

  const completedCount = taskNodes.filter(
    (n) => Boolean(n.payload.completed),
  ).length;
  const percent = Math.round((completedCount / taskNodes.length) * 100);

  if (percent >= 100) {
    // All tasks done — auto-complete the goal
    await repos.goals.updateStatus(goalId, "completed", 100);
  } else {
    await repos.goals.updateProgress(goalId, percent);
  }
}

// ── Can't-Complete flow ──────────────────────────────────────

export async function cmdCantCompleteTask(
  body: Record<string, unknown>,
): Promise<unknown> {
  const taskId = body.taskId as string | undefined;
  if (!taskId) throw new Error("command:cant-complete-task requires args.taskId");
  const reason = body.reason as string | undefined;

  const result = await routeCantComplete({ taskId, reason });

  // Include extra view invalidations based on the action
  const _invalidateExtra: string[] = ["view:tasks"];
  if (result.action === "big_goal_reevaluate" && result.task.goalId) {
    _invalidateExtra.push("view:goal-plan");
  }

  return { ...result, _invalidateExtra };
}

// ── Add-Task-To-Plan (mid-day addition with memory packaging) ─

export async function cmdAddTaskToPlan(
  body: Record<string, unknown>,
): Promise<unknown> {
  const date = body.date as string | undefined;
  const title = body.title as string | undefined;
  if (!date || !title) {
    throw new Error("command:add-task-to-plan requires args.date and args.title");
  }

  const weight = (body.cognitiveWeight as number | undefined) ?? 3;
  const minutes = (body.durationMinutes as number | undefined) ?? 30;

  // Package current plan and evaluate capacity
  const pkg = await packageCurrentPlan(date);
  const capacity = evaluateCapacity(pkg, weight, minutes);

  if (!capacity.ok && body.force !== true) {
    return {
      ok: false,
      overBudget: true,
      reason: capacity.reason,
      deferCandidates: capacity.deferCandidates,
    };
  }

  // Fits (or forced) — insert the task
  const id = (body.id as string | undefined) ?? crypto.randomUUID();
  const source = (body.source as TaskSource | undefined) ?? "user_created";
  const payload = (body.payload as Record<string, unknown> | undefined) ?? {};
  payload.cognitiveWeight = weight;
  payload.durationMinutes = minutes;
  if (body.priority) payload.priority = body.priority;
  if (body.category) payload.category = body.category;
  payload.addedMidDay = true;

  await repos.dailyTasks.insert({
    id,
    date,
    title,
    goalId: (body.goalId as string | undefined) ?? null,
    planNodeId: (body.planNodeId as string | undefined) ?? null,
    completed: false,
    orderIndex: pkg.existingTasks.length,
    source,
    payload,
  });
  await repos.dailyLogs.ensureExists(date);

  return { ok: true, taskId: id, budget: pkg.budget };
}

// ── Reschedule flow (replaces the overdue concept) ────────────

/**
 * Move an incomplete past task to a new date. Runs a budget check on
 * the target day; if over budget returns `budgetExceeded` with a swap
 * suggestion so the UI can ask the user what to remove.
 *
 * Logs the reschedule in the task's payload for history.
 */
export async function cmdRescheduleTask(
  body: Record<string, unknown>,
): Promise<unknown> {
  const taskId = body.taskId as string | undefined;
  const targetDate = body.targetDate as string | undefined;
  const force = body.force as boolean | undefined;
  if (!taskId) throw new Error("command:reschedule-task requires args.taskId");
  if (!targetDate) throw new Error("command:reschedule-task requires args.targetDate");

  const task = await repos.dailyTasks.get(taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);

  const originalDate = task.date;
  const pl = task.payload as Record<string, unknown>;
  const weight = (pl.cognitiveWeight as number) ?? 3;
  const minutes = (pl.durationMinutes as number) ?? 30;

  // Budget check on target day (unless force=true, meaning user already
  // confirmed a swap on the client side).
  if (!force) {
    const targetTasks = await repos.dailyTasks.listForDate(targetDate);
    const activeTasks = targetTasks.filter((t) => {
      if (t.completed) return false;
      const p = t.payload as Record<string, unknown>;
      return !p?.skipped;
    });
    const currentWeight = activeTasks.reduce(
      (s, t) => s + ((t.payload as Record<string, unknown>).cognitiveWeight as number ?? 3), 0,
    );
    const maxWeight = 12; // COGNITIVE_BUDGET.MAX_DAILY_WEIGHT
    if (currentWeight + weight > maxWeight) {
      // Find lowest-priority task to suggest swapping
      const sorted = [...activeTasks].sort((a, b) =>
        deferScore({
          priority: ((b.payload as Record<string, unknown>).priority as string) ?? "should-do",
          cognitiveWeight: ((b.payload as Record<string, unknown>).cognitiveWeight as number) ?? 3,
        }) -
        deferScore({
          priority: ((a.payload as Record<string, unknown>).priority as string) ?? "should-do",
          cognitiveWeight: ((a.payload as Record<string, unknown>).cognitiveWeight as number) ?? 3,
        }),
      );
      const swapCandidate = sorted[0];
      return {
        ok: false,
        budgetExceeded: true,
        swapSuggestion: swapCandidate
          ? {
              id: swapCandidate.id,
              title: swapCandidate.title,
              cognitiveWeight: ((swapCandidate.payload as Record<string, unknown>).cognitiveWeight as number) ?? 3,
            }
          : null,
      };
    }
  }

  // Build reschedule history log entry
  const history = (Array.isArray(pl.rescheduleHistory) ? pl.rescheduleHistory : []) as Array<Record<string, unknown>>;
  history.push({
    from: originalDate,
    to: targetDate,
    at: new Date().toISOString(),
  });
  const rescheduleCount = ((pl.rescheduleCount as number) ?? 0) + 1;

  // Move the task to the target date
  const targetTasks = await repos.dailyTasks.listForDate(targetDate);
  await repos.dailyTasks.update(taskId, {
    date: targetDate,
    orderIndex: targetTasks.length,
    payload: {
      rescheduleHistory: history,
      rescheduleCount,
      rescheduledFrom: originalDate,
    },
  });

  // Ensure the target date has a daily_log so the view surfaces the moved task.
  await repos.dailyLogs.ensureExists(targetDate);

  // Sync the goal plan tree so GoalPlanPage timeline reflects the move
  if (task.planNodeId && task.goalId) {
    try {
      await repos.goalPlan.moveTaskToDate(task.planNodeId, task.goalId, targetDate);
    } catch (err) {
      console.warn("[reschedule-task] plan node sync failed:", err);
    }
  }

  // A-2: implicit priority feedback — rescheduling is a "not now" vote.
  void recordPriorityFeedback(task.title, "defer", {
    category: (pl.category as string) ?? "planning",
    tier: (pl.tier as string) ?? undefined,
    dayOfWeek: new Date(originalDate + "T00:00:00").getDay(),
  }).catch(() => {});

  // Cross-day reschedule: dispatch the pipeline for BOTH dates so the
  // source day re-triages with one less task and the target day
  // re-triages with the new arrival. Estimator skips the moved task
  // if it was already estimated.
  const { fireDailyMutationPipeline } = await import(
    "../../services/dailyMutationPipeline"
  );
  fireDailyMutationPipeline([originalDate, targetDate], "reschedule");

  return { ok: true, taskId, from: originalDate, to: targetDate };
}

/**
 * Snooze a reschedule card — the task stays on its original day but
 * the card won't re-appear until tomorrow. If the user ignores again,
 * the card resurfaces (one-day snooze).
 */
export async function cmdSnoozeReschedule(
  body: Record<string, unknown>,
): Promise<unknown> {
  const taskId = body.taskId as string | undefined;
  if (!taskId) throw new Error("command:snooze-reschedule requires args.taskId");

  const task = await repos.dailyTasks.get(taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);

  // Set snooze until tomorrow
  const tomorrow = tomorrowOf(new Date().toISOString().split("T")[0]);
  await repos.dailyTasks.update(taskId, {
    payload: { rescheduleSnoozeUntil: tomorrow },
  });

  // A-2: implicit priority feedback — snoozing a reschedule card is
  // also a "not now" vote on the task's current placement.
  const pl = task.payload as Record<string, unknown>;
  void recordPriorityFeedback(task.title, "defer", {
    category: (pl?.category as string) ?? "planning",
    tier: (pl?.tier as string) ?? undefined,
    dayOfWeek: new Date(task.date + "T00:00:00").getDay(),
  }).catch(() => {});

  return { ok: true, taskId, snoozedUntil: tomorrow };
}

/**
 * Permanently dismiss a reschedule card — the task is marked as
 * skipped so it won't resurface.
 */
export async function cmdDismissReschedule(
  body: Record<string, unknown>,
): Promise<unknown> {
  const taskId = body.taskId as string | undefined;
  if (!taskId) throw new Error("command:dismiss-reschedule requires args.taskId");

  await repos.dailyTasks.update(taskId, {
    payload: { rescheduleDismissed: true, skipped: true },
  });

  return { ok: true, taskId };
}

// ── Image → Todos (Phase 1) ──────────────────────────────────
//
// Server-side gateway for the vision pipeline. Accepts a one-shot base64
// image, validates it never exceeds 5 MB or the allowed mime list, then
// forwards to the AI channel and returns the structured todo list.
// Important: the image bytes are NEVER persisted anywhere — they live
// only in the request payload and in Anthropic's per-call buffer.

const IMAGE_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_IMAGE_MIME: ReadonlyArray<string> = [
  "image/jpeg",
  "image/png",
  "image/webp",
];

/** Best-effort byte count for a base64 string without allocating the
 *  full decoded buffer. Base64 encodes 3 bytes per 4 chars minus padding. */
function approxBase64Bytes(b64: string): number {
  const len = b64.length;
  if (len === 0) return 0;
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((len * 3) / 4) - pad;
}

export async function cmdAnalyzeImage(
  body: Record<string, unknown>,
): Promise<unknown> {
  const imageBase64 = body.imageBase64 as string | undefined;
  const mediaType = body.mediaType as string | undefined;
  const source = body.source as string | undefined;
  const userHint = body.userHint as string | undefined;
  const todayDate =
    (body.todayDate as string | undefined) ?? getEffectiveDate();

  if (!imageBase64 || typeof imageBase64 !== "string") {
    throw new Error("command:analyze-image requires args.imageBase64");
  }
  if (!mediaType || !ALLOWED_IMAGE_MIME.includes(mediaType)) {
    throw new Error(
      `command:analyze-image unsupported mediaType: ${mediaType ?? "(missing)"}`,
    );
  }
  if (source !== "upload" && source !== "paste" && source !== "screenshot") {
    throw new Error(
      `command:analyze-image requires args.source in {upload|paste|screenshot}, got: ${source ?? "(missing)"}`,
    );
  }

  const bytes = approxBase64Bytes(imageBase64);
  if (bytes > IMAGE_MAX_BYTES) {
    throw new Error(
      `command:analyze-image image too large: ${bytes} bytes (max ${IMAGE_MAX_BYTES})`,
    );
  }

  const result = await runAI(
    "image-to-todos",
    {
      imageBase64,
      mediaType,
      source,
      userHint,
      todayDate,
    },
    "general",
  );

  // Phase 5 memory hook: log the image classification + extracted
  // count so reflection can learn which image kinds are useful for
  // this user. Best-effort; never blocks the response.
  void (async () => {
    try {
      const r = (result ?? {}) as {
        imageType?: string;
        todos?: unknown[];
      };
      const imageType = (r.imageType ?? "other") as ImageClassification;
      const todoCount = Array.isArray(r.todos) ? r.todos.length : 0;
      await recordImageSource(imageType, todoCount, source as ImageSourceKind);
    } catch {
      /* signal recording is best-effort */
    }
  })();

  // Return the parsed AI response verbatim. The client renders a
  // confirmation UI and dispatches create-task per accepted item —
  // this command intentionally does NOT write to the DB.
  return { ok: true, result };
}

/**
 * Trim today's daily_tasks to the cognitive-budget ceiling by
 * demoting the lowest-priority excess to bonus tier.
 *
 * Lifecycle:
 *   1. Load incomplete, un-skipped tasks for today.
 *   2. Sort: protected first (must-do, plan-attached), then by tier +
 *      cognitiveCost desc.
 *   3. Anything beyond MAX_DAILY_TASKS (default 5) gets demoted —
 *      payload.priority="bonus", payload.isBonus=true. tasksView's
 *      isBonusTask filter then keeps them off the active list while
 *      they remain reversible (undo: just clear isBonus).
 *
 * Why a separate command instead of a SQL trim:
 *   - Reversible (priority/isBonus, not delete).
 *   - Consults the same TIER_RANK that the scheduler uses.
 *   - Plan-attached + must-do tasks are PROTECTED — never demoted.
 *
 * Use case: a user lands on Tasks with > MAX_DAILY_TASKS rows from a
 * pre-budget-cap day (or after disabling the cap). One click resets
 * the active list to a coordinated size without losing data.
 *
 * No LLM call. Pure deterministic re-classification. Fires
 * view:invalidate on completion.
 */
export async function cmdTrimToday(
  body: Record<string, unknown>,
): Promise<unknown> {
  const { COGNITIVE_BUDGET } = await import("@starward/core");
  const date = (body.date as string | undefined) || getEffectiveDate();
  const all = await repos.dailyTasks.listForDate(date);

  // Active set = not completed, not skipped, not already bonus.
  const active = all.filter((t) => {
    if (t.completed) return false;
    const pl = t.payload as Record<string, unknown>;
    if (pl.skipped) return false;
    if (pl.priority === "bonus" || pl.isBonus) return false;
    return true;
  });

  if (active.length <= COGNITIVE_BUDGET.MAX_DAILY_TASKS) {
    return { ok: true, demoted: 0, alreadyAtBudget: true, total: active.length };
  }

  const TIER_RANK: Record<string, number> = {
    lifetime: 0,
    quarter: 1,
    week: 2,
    day: 3,
  };
  const tierRank = (t: typeof active[number]): number => {
    const tier =
      (t.tier as string | undefined) ??
      ((t.payload as Record<string, unknown>)?.tier as string | undefined);
    return tier && TIER_RANK[tier] !== undefined ? TIER_RANK[tier] : 2.5;
  };
  const isProtected = (t: typeof active[number]): boolean => {
    // Only must-do tasks are absolutely protected. Plan-attached
    // tasks (big_goal + planNodeId) WERE protected here historically
    // — but that left users with N goals × M tasks/day stranded
    // over-budget because every row was "protected." The plan tree
    // still owns the source-of-truth task; demoting to bonus on
    // today's render doesn't lose data, and rotation will pull
    // higher-priority work back in as the user completes things.
    const pl = t.payload as Record<string, unknown>;
    if (pl.priority === "must-do") return true;
    return false;
  };

  // Sort: protected first, then tier asc, then cost desc. The TAIL of
  // this sort is the demote candidate set.
  const sorted = [...active].sort((a, b) => {
    const aProt = isProtected(a) ? 0 : 1;
    const bProt = isProtected(b) ? 0 : 1;
    if (aProt !== bProt) return aProt - bProt;
    const aTier = tierRank(a);
    const bTier = tierRank(b);
    if (aTier !== bTier) return aTier - bTier;
    const aCost = (a.cognitiveCost as number | null) ?? 0;
    const bCost = (b.cognitiveCost as number | null) ?? 0;
    return bCost - aCost;
  });

  const keep = sorted.slice(0, COGNITIVE_BUDGET.MAX_DAILY_TASKS);
  const demote = sorted.slice(COGNITIVE_BUDGET.MAX_DAILY_TASKS);

  let demoted = 0;
  for (const t of demote) {
    if (isProtected(t)) continue; // belt-and-suspenders
    try {
      await repos.dailyTasks.update(t.id, {
        payload: {
          priority: "bonus",
          isBonus: true,
          demotedFrom:
            (t.payload as Record<string, unknown>)?.priority ?? "should-do",
          demotedAt: new Date().toISOString(),
        },
      });
      demoted++;
    } catch (err) {
      console.warn(`[trim-today] demote ${t.id} failed:`, err);
    }
  }

  console.log(
    `[trim-today] date=${date} active=${active.length} kept=${keep.length} demoted=${demoted}`,
  );

  return {
    ok: true,
    demoted,
    kept: keep.length,
    total: active.length,
  };
}
