/**
 * Planning / AI-backed command handlers (goal plan generation,
 * reallocation, daily task regeneration, adaptive rescheduling).
 */

import {
  repos,
  runAI,
  getCurrentUserId,
  getEffectiveDate,
  getEffectiveDaysAgo,
  loadMemory,
  buildMemoryContext,
  computeCapacityProfile,
  emitAgentProgress,
  emitViewInvalidate,
  generateAndPersistDailyTasks,
  splitPlan,
  mergePlans,
  runStreamingHandler,
  getClient,
  ADAPTIVE_RESCHEDULE_SYSTEM,
  getModelForTask,
  personalizeSystem,
} from "./_helpers";
import {
  classifyReschedule,
  type RescheduleLevel,
  type RescheduleClassifierOutput,
} from "@northstar/core";
import { computeLowCompletionStreak } from "../../services/lowCompletionStreak";
import { LOCAL_RESCHEDULE_SYSTEM } from "../../agents/prompts/adaptiveReschedule";

/**
 * Lazy Week Expansion (GoalAct pattern) — when a locked week is unlocked,
 * generates detailed daily tasks using the week's objective and surrounding
 * context. Replaces the old "just flip locked: false" approach.
 */
export async function cmdExpandPlanWeek(
  body: Record<string, unknown>,
): Promise<unknown> {
  const goalId = body.goalId as string;
  const weekId = body.weekId as string;
  if (!goalId || !weekId) {
    throw new Error("command:expand-plan-week requires goalId and weekId");
  }

  const goal = await repos.goals.get(goalId);
  if (!goal) throw new Error(`Goal ${goalId} not found`);

  const nodes = await repos.goalPlan.listForGoal(goalId);
  const weekNode = nodes.find((n) => n.id === weekId && n.nodeType === "week");
  if (!weekNode) throw new Error(`Week ${weekId} not found in goal plan`);
  if (!weekNode.payload.locked) {
    return { ok: true, weekId, alreadyUnlocked: true };
  }

  // Gather surrounding context
  const weekParent = weekNode.parentId;
  const siblingWeeks = nodes
    .filter((n) => n.nodeType === "week" && n.parentId === weekParent)
    .sort((a, b) => a.orderIndex - b.orderIndex);
  const weekIdx = siblingWeeks.findIndex((w) => w.id === weekId);
  const prevWeek = weekIdx > 0 ? siblingWeeks[weekIdx - 1] : null;
  const nextWeek = weekIdx < siblingWeeks.length - 1 ? siblingWeeks[weekIdx + 1] : null;

  // Previous week tasks summary
  let previousWeekContext = "";
  if (prevWeek) {
    const prevDays = nodes.filter((n) => n.nodeType === "day" && n.parentId === prevWeek.id);
    const prevTasks = nodes.filter(
      (n) => n.nodeType === "task" && prevDays.some((d) => d.id === n.parentId),
    );
    previousWeekContext = prevTasks
      .map((t) => `- ${t.title} (${t.payload.completed ? "done" : "pending"})`)
      .join("\n") || "No tasks in previous week";
  }

  // Progress summary
  const allTasks = nodes.filter((n) => n.nodeType === "task");
  const completedTasks = allTasks.filter((n) => n.payload.completed);
  const progressSummary = `${completedTasks.length}/${allTasks.length} tasks completed (${
    allTasks.length > 0 ? Math.round((completedTasks.length / allTasks.length) * 100) : 0
  }%)`;

  // Pace data — simple calculation from plan stats
  let paceContext = "";
  try {
    const totalPlanTasks = allTasks.length;
    const completedCount = completedTasks.length;
    const remaining = totalPlanTasks - completedCount;
    if (remaining > 0 && goal.targetDate) {
      const daysLeft = Math.max(1, Math.ceil(
        (new Date(goal.targetDate).getTime() - Date.now()) / 86_400_000,
      ));
      const requiredPerDay = remaining / daysLeft;
      paceContext = `${completedCount}/${totalPlanTasks} done, ${remaining} remaining, need ~${requiredPerDay.toFixed(1)} tasks/day to finish by ${goal.targetDate}`;
    }
  } catch {
    // pace calculation failed — continue without it
  }

  const userId = getCurrentUserId();
  const [memory] = await Promise.all([loadMemory(userId)]);
  const memoryContext = await buildMemoryContext(memory, "planning");

  const client = getClient();
  if (!client) throw new Error("ANTHROPIC_API_KEY not configured");

  const { handleExpandWeek } = await import("../../ai/handlers/expandWeek");
  const result = await handleExpandWeek(
    client,
    {
      goalTitle: goal.title,
      goalDescription: goal.description ?? "",
      weekLabel: weekNode.title,
      weekObjective: (weekNode.payload.objective as string) ?? weekNode.description,
      previousWeekContext,
      nextWeekObjective: nextWeek
        ? (nextWeek.payload.objective as string) ?? nextWeek.description
        : "",
      progressSummary,
      paceContext,
      startDate: weekNode.startDate ?? "",
      endDate: weekNode.endDate ?? "",
    },
    memoryContext,
  );

  // Persist generated day+task nodes under the week
  const { goalPlan: goalPlanRepo } = repos;
  const newNodes: Array<import("../../repositories/goalPlanRepo").GoalPlanNode> = [];

  for (let dayIdx = 0; dayIdx < result.days.length; dayIdx++) {
    const day = result.days[dayIdx];
    const dayId = `${weekId}-day-${dayIdx}`;
    newNodes.push({
      id: dayId,
      goalId,
      parentId: weekId,
      nodeType: "day",
      title: day.label,
      description: "",
      startDate: day.label,
      endDate: day.label,
      orderIndex: dayIdx,
      payload: {},
    });

    for (let taskIdx = 0; taskIdx < day.tasks.length; taskIdx++) {
      const task = day.tasks[taskIdx];
      newNodes.push({
        id: `${dayId}-task-${taskIdx}`,
        goalId,
        parentId: dayId,
        nodeType: "task",
        title: task.title,
        description: task.description,
        startDate: day.label,
        endDate: day.label,
        orderIndex: taskIdx,
        payload: {
          durationMinutes: task.durationMinutes,
          priority: task.priority,
          category: task.category,
          completed: false,
        },
      });
    }
  }

  await goalPlanRepo.upsertNodes(goalId, newNodes);

  // Unlock the week
  await goalPlanRepo.patchNodePayload(weekId, { locked: false });

  emitAgentProgress(userId, {
    agentId: "expand-week",
    phase: "done",
    message: `Generated ${result.days.reduce((s, d) => s + d.tasks.length, 0)} tasks for ${weekNode.title}`,
  });

  return {
    ok: true,
    weekId,
    tasksCreated: result.days.reduce((s, d) => s + d.tasks.length, 0),
  };
}

export async function cmdRegenerateGoalPlan(
  body: Record<string, unknown>,
): Promise<unknown> {
  const payload =
    (body.payload as Record<string, unknown> | undefined) ?? body ?? {};
  const goalId = payload.goalId as string | undefined;
  if (!goalId) {
    throw new Error(
      "command:regenerate-goal-plan requires args.payload.goalId",
    );
  }
  const result = await runAI("generate-goal-plan", payload, "planning");
  // handleGenerateGoalPlan returns the raw parsed JSON. The prompt asks
  // for { reply, plan: {...} } but be tolerant of a bare plan.
  const resultObj = (result ?? {}) as Record<string, unknown>;
  const planCandidate =
    (resultObj.plan as Record<string, unknown> | undefined) ?? resultObj;
  if (
    !planCandidate ||
    typeof planCandidate !== "object" ||
    !Array.isArray((planCandidate as { years?: unknown }).years)
  ) {
    throw new Error("AI returned invalid plan shape");
  }
  const plan = planCandidate as unknown as import("@northstar/core").GoalPlan;
  // Fetch goal for date range to enable timeline gap-fill
  const existing = await repos.goals.get(goalId);
  const goalStartDate = existing?.createdAt?.split("T")[0];
  const goalEndDate = existing?.targetDate;
  await repos.goalPlan.replacePlan(goalId, plan, goalStartDate, goalEndDate);
  // Flip planConfirmed on the goal so dashboards/goal-plan view stop
  // showing the "not planned" state.
  if (existing) {
    await repos.goals.upsert({
      ...existing,
      plan,
      planConfirmed: true,
      status: existing.status === "planning" ? "active" : existing.status,
    });
  }
  const reply = resultObj.reply as string | undefined;

  // ── Phase 2 pilot: detached critique pass ──
  // Runs Haiku in the background to review the generated plan. Advisory only
  // — the primary response ships first and is unaffected by critique outcome.
  // Wrapped in an async IIFE so the memory rebuild does not delay the return.
  void (async () => {
    try {
      const userId = getCurrentUserId();
      const memory = await loadMemory(userId);
      const memoryContext = await buildMemoryContext(memory, "planning");
      const { runCritique } = await import("../../critique");
      await runCritique({
        userId,
        handler: "generate-goal-plan",
        primaryOutput: resultObj,
        memoryContext,
        payload,
        correlationId: goalId,
      });
    } catch (err) {
      console.error("[critique-pilot] dispatch failed:", err);
    }
  })();

  return { ok: true, goalId, reply };
}

export async function cmdReallocateGoalPlan(
  body: Record<string, unknown>,
): Promise<unknown> {
  const payload =
    (body.payload as Record<string, unknown> | undefined) ?? body ?? {};
  const result = await runAI("reallocate", payload, "daily");
  return { ok: true, result };
}

/**
 * Confirm (approve) the AI-proposed daily tasks so the tasks page
 * switches from the proposal card to the normal task list.
 */
export async function cmdConfirmDailyTasks(
  body: Record<string, unknown>,
): Promise<unknown> {
  const today = (body.date as string) || getEffectiveDate();
  const existing = await repos.dailyLogs.get(today);
  const mergedPayload = { ...(existing?.payload ?? {}), tasksConfirmed: true };
  await repos.dailyLogs.upsert({
    date: today,
    mood: existing?.mood,
    energy: existing?.energy,
    notes: existing?.notes,
    reflection: existing?.reflection,
    payload: mergedPayload,
  });

  // Generate and persist behavioral nudges based on today's tasks.
  // Best-effort — failures here don't affect the confirmation.
  try {
    const { generateNudges } = await import("../../reflection");
    const userId = getCurrentUserId();
    const todayTasks = await repos.dailyTasks.listForDate(today);
    const nudgeTasks = todayTasks.map((t) => {
      const pl = t.payload as Record<string, unknown>;
      return {
        id: t.id,
        title: t.title,
        category: (pl.category as string) ?? "planning",
        durationMinutes: (pl.durationMinutes as number) ?? 30,
        completed: t.completed,
        completedAt: t.completedAt ?? undefined,
        startedAt: (pl.startedAt as string) ?? undefined,
        actualMinutes: (pl.actualMinutes as number) ?? undefined,
        snoozedCount: (pl.snoozedCount as number) ?? undefined,
        skipped: (pl.skipped as boolean) ?? false,
        priority: (pl.priority as string) ?? "should-do",
      };
    });
    const nudges = await generateNudges(userId, nudgeTasks);
    for (const nudge of nudges.slice(0, 3)) {
      try {
        await repos.nudges.insert({
          id: nudge.id,
          kind: nudge.type,
          title: nudge.message.slice(0, 120),
          body: nudge.message,
          priority: Math.round(nudge.priority * 5),
          context: nudge.context,
          actions: nudge.actions ?? [],
        });
      } catch {
        // deduplication conflict — nudge already exists
      }
    }
  } catch (err) {
    console.warn("[confirm-daily-tasks] nudge generation failed:", err);
  }

  return { ok: true, date: today };
}

/**
 * Unified Refresh — routes to the appropriate scenario based on current state.
 * Replaces the old Suggest / Plan my day / Generate distinction.
 */
export async function cmdRefreshDailyPlan(
  body: Record<string, unknown>,
): Promise<unknown> {
  const { routeRefresh } = await import(
    "../../coordinators/dailyPlanner/scenarios"
  );
  const date = (body.date as string) || getEffectiveDate();
  const result = await routeRefresh(date);

  // ── Phase B: detached critique on the daily-tasks output ──
  // Fire-and-forget so the primary flow is unaffected. The payload includes
  // the user's dailyCognitiveBudget so the critique can flag budget
  // violations without fabricating the limit.
  void (async () => {
    try {
      const userId = getCurrentUserId();
      const memory = await loadMemory(userId);
      const memoryContext = await buildMemoryContext(memory, "daily");
      const user = await repos.users.get();
      const { runCritique } = await import("../../critique");
      const { computeDynamicBudget } = await import("@northstar/core");

      // Compute a 3-day rolling check for lifetime/quarter tasks so the
      // critique agent has the signal it needs for the rubric without
      // having to re-query the DB.
      const threeDaysAgo = new Date(date);
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 2);
      const startDate = threeDaysAgo.toISOString().slice(0, 10);
      const recentTasks = await repos.dailyTasks.listForDateRange(startDate, date);
      const recentTiers = recentTasks.map((t) => ({
        date: t.date,
        tier: t.tier,
      }));

      // A-3: mirror the scheduler's budget resolution so critique cites the
      // same effective number the scheduler used for trim decisions. Reaches
      // Phase-1 byte-identical output when recentCompletionRate is unknown.
      const recentLogs = await repos.dailyLogs.list(startDate, date);
      const rate = recentLogs.length > 0
        ? (() => {
            const tasks = recentTasks;
            const total = tasks.length;
            const completed = tasks.filter((t) => t.completed).length;
            return total > 0 ? completed / total : -1;
          })()
        : -1;
      const segment = user?.settings?.userSegment ?? "general";
      const base = user?.settings?.dailyCognitiveBudget ?? 22;
      const budgetResult = computeDynamicBudget({
        base,
        segment,
        dayOfWeek: new Date(date + "T00:00:00").getDay(),
        recentCompletionRate: rate >= 0 ? rate : undefined,
      });

      await runCritique({
        userId,
        handler: "regenerate-daily-tasks",
        primaryOutput: result,
        memoryContext,
        payload: {
          date,
          // Preserve the base for rubric context; add effective so critique
          // can cite what the scheduler actually applied.
          dailyCognitiveBudget: base,
          effectiveCognitiveBudget: budgetResult.effective,
          recentTiers, // last 3 days, for the lifetime/quarter streak check
        },
        correlationId: date,
      });
    } catch (err) {
      console.error("[critique] daily-tasks dispatch failed:", err);
    }
  })();

  return result;
}

/** @deprecated — delegate to cmdRefreshDailyPlan for backward compat */
export async function cmdRegenerateDailyTasks(
  body: Record<string, unknown>,
): Promise<unknown> {
  return cmdRefreshDailyPlan(body);
}

// ── Adaptive reschedule ──────────────────────────────────
//
// Phase 1 (Initiative B) splits this into three scopes behind a pure
// classifier. Plan-level preserves byte-identical behaviour for rollback
// safety. Local and micro are additive rewriters.

type GoalRow = NonNullable<Awaited<ReturnType<typeof repos.goals.get>>>;
type GoalPlanT = import("@northstar/core").GoalPlan;
type GoalPlanTaskT = import("@northstar/core").GoalPlanTask;
type SplitT = ReturnType<typeof splitPlan>;

const VALID_SCOPE: readonly RescheduleLevel[] = ["micro", "local", "plan"];

function validateScopeOverride(v: unknown): RescheduleLevel | null {
  if (typeof v !== "string") return null;
  return (VALID_SCOPE as readonly string[]).includes(v)
    ? (v as RescheduleLevel)
    : null;
}

function clonePlan(plan: GoalPlanT): GoalPlanT {
  return JSON.parse(JSON.stringify(plan)) as GoalPlanT;
}

export async function cmdAdaptiveReschedule(
  body: Record<string, unknown>,
): Promise<unknown> {
  const payload = (body.payload as Record<string, unknown> | undefined) ?? {};
  const goalId =
    (body.goalId as string) || (payload.goalId as string);
  if (!goalId) throw new Error("command:adaptive-reschedule requires goalId");
  const goal = await repos.goals.get(goalId);
  if (!goal) throw new Error(`goal ${goalId} not found`);
  if (!goal.plan || !Array.isArray(goal.plan.years)) {
    throw new Error(`goal ${goalId} has no plan to reschedule`);
  }

  const scopeOverride =
    validateScopeOverride(body.scopeOverride) ??
    validateScopeOverride(payload.scopeOverride);

  const userId = getCurrentUserId();
  const today = getEffectiveDate();
  const rangeStart = getEffectiveDaysAgo(14);
  const taskRecords = await repos.dailyTasks.listForDateRange(rangeStart, today);
  const logsByDate = new Map<string, Array<{ completed: boolean; skipped?: boolean }>>();
  for (const t of taskRecords) {
    const arr = logsByDate.get(t.date) ?? [];
    arr.push({ completed: t.completed, skipped: Boolean(t.payload?.skipped) });
    logsByDate.set(t.date, arr);
  }
  const logsForCapacity = [...logsByDate.entries()].map(([date, tasks]) => ({ date, tasks }));
  const [memory, user] = await Promise.all([loadMemory(userId), repos.users.get()]);
  const capacity = computeCapacityProfile(
    memory,
    logsForCapacity,
    new Date(today + "T00:00:00").getDay(),
    undefined,
    user?.weeklyAvailability,
  );
  const actualPace = capacity.avgTasksCompletedPerDay || 2;

  const split = splitPlan(goal.plan);
  const streak = computeLowCompletionStreak(logsForCapacity, today);
  const classification = classifyReschedule({
    overdueTasks: split.overdueTasks.map((t) => ({
      id: t.id,
      originalWeek: t.originalWeek,
      originalDay: t.originalDay,
    })),
    milestones: goal.plan.milestones ?? [],
    avgTasksCompletedPerDay: actualPace,
    lowCompletionStreakDays: streak,
    scopeOverride,
  });

  console.log(
    `[adaptive-reschedule] level=${classification.level} overdue=${split.overdueTasks.length} ` +
      `weeks=${classification.affectedWeekLabels.length} streak=${streak} override=${scopeOverride ?? "none"}`,
  );

  if (classification.level === "plan") {
    return runPlanLevelReschedule({
      userId,
      goalId,
      goal,
      today,
      actualPace,
      split,
      memory,
    });
  }
  if (classification.level === "local") {
    return runLocalLevelReschedule({
      userId,
      goalId,
      goal,
      today,
      actualPace,
      split,
      memory,
      classification,
    });
  }
  return runMicroLevelReschedule({
    userId,
    goalId,
    goal,
    today,
    actualPace,
    split,
    memory,
    classification,
  });
}

// ── Plan-level: byte-identical to pre-Phase-1 behaviour ────────────

interface ReschedContext {
  userId: string;
  goalId: string;
  goal: GoalRow;
  today: string;
  actualPace: number;
  split: SplitT;
  memory: Awaited<ReturnType<typeof loadMemory>>;
}
interface ReschedContextWithClassification extends ReschedContext {
  classification: RescheduleClassifierOutput;
}

async function runPlanLevelReschedule(
  ctx: ReschedContext,
): Promise<unknown> {
  const { userId, goalId, goal, today, actualPace, split, memory } = ctx;
  const { pastPlan, futurePlan, overdueTasks } = split;

  const futureTasks: Array<{ title: string; description: string; week: string; day: string }> = [];
  for (const yr of futurePlan.years) {
    for (const mo of yr.months) {
      for (const wk of mo.weeks) {
        for (const dy of wk.days) {
          for (const tk of dy.tasks) {
            if (!tk.completed) {
              futureTasks.push({ title: tk.title, description: tk.description, week: wk.label, day: dy.label });
            }
          }
        }
      }
    }
  }

  const client = getClient();
  if (!client) throw new Error("ANTHROPIC_API_KEY not configured");

  const memoryContext = await buildMemoryContext(memory, "daily");

  emitAgentProgress(userId, { agentId: "adaptive-reschedule", phase: "running", message: "Adjusting plan to your pace" });

  const parsed = await runStreamingHandler<Record<string, unknown>>({
    handlerKind: "adaptive-reschedule",
    client,
    createRequest: () => ({
      model: getModelForTask("reallocate"),
      max_tokens: 16384,
      system: personalizeSystem(ADAPTIVE_RESCHEDULE_SYSTEM, memoryContext),
      messages: [{
        role: "user",
        content: `TODAY: ${today}
GOAL: "${goal.title}"
DESCRIPTION: ${goal.description ?? ""}
TARGET DATE: ${goal.targetDate ?? "none"}

ACTUAL PACE: ${actualPace} tasks/day (averaged over past 2 weeks)

INCOMPLETE PAST TASKS (${overdueTasks.length} from past weeks — need rescheduling):
${overdueTasks.map((t) => `- "${t.title}" (was: ${t.originalWeek}, ${t.originalDay})`).join("\n") || "None"}

FUTURE TASKS (${futureTasks.length} currently scheduled):
${futureTasks.map((t) => `- "${t.title}" (${t.week}, ${t.day})`).join("\n") || "None"}

Please redistribute all tasks at my actual pace of ${actualPace} tasks/day.`,
      }],
    }),
    parseResult: (text) => {
      const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      return JSON.parse(cleaned);
    },
  });

  emitAgentProgress(userId, { agentId: "adaptive-reschedule", phase: "done" });

  const resultObj = (parsed ?? {}) as Record<string, unknown>;
  const newFuturePlan = (resultObj.plan as Record<string, unknown> | undefined) ?? null;
  const summary = resultObj.reschedule_summary ?? null;

  let planUpdated = false;
  if (newFuturePlan && Array.isArray((newFuturePlan as { years?: unknown }).years)) {
    const typedFuture = newFuturePlan as unknown as GoalPlanT;

    // Keep past plan exactly as-is — completed tasks stay, incomplete
    // tasks stay in their original positions. The AI has redistributed
    // overdue tasks into the future plan; the originals remain as a
    // record of where they were originally scheduled.
    const merged = mergePlans(pastPlan, typedFuture);
    const startDate = goal.createdAt?.split("T")[0];
    const endDate = goal.targetDate;
    await repos.goalPlan.replacePlan(goalId, merged, startDate, endDate);

    // Compute projected completion: try AI summary first, then derive
    // from remaining tasks / actual pace as a reliable fallback.
    const summaryObj = (typeof summary === "object" && summary !== null ? summary : {}) as Record<string, unknown>;
    let projectedCompletion = (summaryObj.projected_completion ?? summaryObj.projectedCompletion) as string | undefined;
    if (!projectedCompletion || !/^\d{4}-\d{2}-\d{2}/.test(projectedCompletion)) {
      let remaining = 0;
      for (const yr of merged.years ?? []) {
        for (const mo of yr.months ?? []) {
          for (const wk of mo.weeks ?? []) {
            for (const dy of wk.days ?? []) {
              for (const tk of dy.tasks ?? []) {
                if (!tk.completed) remaining++;
              }
            }
          }
        }
      }
      const projectedDays = Math.ceil(remaining / Math.max(actualPace, 0.5));
      const d = new Date(today + "T00:00:00");
      d.setDate(d.getDate() + projectedDays);
      projectedCompletion = d.toISOString().split("T")[0];
    }

    const updatedGoal = {
      ...goal,
      plan: merged,
      targetDate: projectedCompletion,
      rescheduleBannerDismissed: true,
    } as typeof goal;
    await repos.goals.upsert(updatedGoal);
    await repos.nudges.dismissByContext(goalId);
    planUpdated = true;

    // Dismiss overdue daily_tasks for this goal so the overload banner
    // doesn't reappear after refresh. The plan has been redistributed —
    // the old materialized tasks are stale.
    try {
      const pendingTasks = await repos.dailyTasks.listPendingReschedule(today);
      const goalOverdue = pendingTasks.filter((t) => t.goalId === goalId);
      for (const t of goalOverdue) {
        await repos.dailyTasks.update(t.id, {
          payload: { rescheduleDismissed: true },
        });
      }
      if (goalOverdue.length > 0) {
        console.log(`[adaptive-reschedule] Dismissed ${goalOverdue.length} overdue daily_tasks for goal ${goalId}`);
      }
    } catch (err) {
      console.warn(`[adaptive-reschedule] Failed to dismiss overdue tasks for goal ${goalId}:`, err);
    }

    console.log(`[adaptive-reschedule] Plan updated for goal ${goalId}. targetDate → ${projectedCompletion}, incomplete tasks redistributed: ${overdueTasks.length}`);
  } else {
    console.warn(`[adaptive-reschedule] AI response missing valid plan.years — plan not updated. Keys: ${Object.keys(resultObj).join(", ")}`);
  }

  return { ok: true, planUpdated, goalId, summary, overdueTasks: overdueTasks.length, actualPace };
}

// ── Local-level: narrow AI rewrite of a bounded future window ──────

async function runLocalLevelReschedule(
  ctx: ReschedContextWithClassification,
): Promise<unknown> {
  const { userId, goalId, goal, today, actualPace, split, memory, classification } = ctx;
  const { pastPlan, futurePlan, overdueTasks } = split;

  // Build an ordered list of future weeks with their month-coordinates so
  // we can splice AI-returned weeks back in place.
  type WeekLocator = {
    yearIdx: number;
    monthIdx: number;
    weekIdx: number;
    week: import("@northstar/core").GoalPlanWeek;
  };
  const weekList: WeekLocator[] = [];
  futurePlan.years.forEach((yr, yi) => {
    yr.months.forEach((mo, mi) => {
      mo.weeks.forEach((wk, wi) => {
        weekList.push({ yearIdx: yi, monthIdx: mi, weekIdx: wi, week: wk });
      });
    });
  });

  if (weekList.length === 0) {
    console.warn(`[adaptive-reschedule] local path found no future weeks for goal ${goalId} — falling back to plan`);
    return runPlanLevelReschedule(ctx);
  }

  // Target window: 2-4 weeks, enough to fit overdue load at actualPace.
  const targetCount = Math.max(
    2,
    Math.min(
      4,
      Math.ceil((overdueTasks.length + 3) / Math.max(actualPace * 5, 1)) + 1,
    ),
  );
  const targetWeeks = weekList.slice(0, Math.min(targetCount, weekList.length));

  const client = getClient();
  if (!client) throw new Error("ANTHROPIC_API_KEY not configured");

  const memoryContext = await buildMemoryContext(memory, "daily");
  const milestoneTitle =
    classification.affectedMilestoneIds.length > 0
      ? (goal.plan!.milestones ?? []).find(
          (m) => m.id === classification.affectedMilestoneIds[0],
        )?.title ?? ""
      : "";

  emitAgentProgress(userId, {
    agentId: "adaptive-reschedule",
    phase: "running",
    message: "Adjusting part of your plan",
  });

  const userMessage = `TODAY: ${today}
GOAL: "${goal.title}"
DESCRIPTION: ${goal.description ?? ""}
MILESTONE CONTEXT: ${milestoneTitle || "(unspecified — rewrite within the window)"}

ACTUAL PACE: ${actualPace} tasks/day (averaged over past 2 weeks)

OVERDUE TASKS (${overdueTasks.length} — need to land inside the window below):
${overdueTasks.map((t) => `- "${t.title}" (was: ${t.originalWeek}, ${t.originalDay}) — "${t.description}"`).join("\n") || "None"}

MILESTONE WEEKS (window you may rewrite — preserve these week ids in order):
${JSON.stringify(targetWeeks.map((w) => w.week), null, 2)}

Return ONLY the rewritten weeks for this window as {"weeks":[...]} using the same week ids.`;

  const parsed = await runStreamingHandler<Record<string, unknown>>({
    handlerKind: "adaptive-reschedule-local",
    client,
    createRequest: () => ({
      model: getModelForTask("reallocate"),
      max_tokens: 8192,
      system: personalizeSystem(LOCAL_RESCHEDULE_SYSTEM, memoryContext),
      messages: [{ role: "user", content: userMessage }],
    }),
    parseResult: (text) => {
      const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      return JSON.parse(cleaned);
    },
  });

  emitAgentProgress(userId, { agentId: "adaptive-reschedule", phase: "done" });

  const resultObj = (parsed ?? {}) as Record<string, unknown>;
  const returnedWeeks = Array.isArray(resultObj.weeks)
    ? (resultObj.weeks as import("@northstar/core").GoalPlanWeek[])
    : null;

  if (!returnedWeeks || returnedWeeks.length === 0) {
    console.warn(`[adaptive-reschedule] local AI returned no valid weeks for goal ${goalId} — plan not updated`);
    return { ok: true, planUpdated: false, goalId, summary: null, overdueTasks: overdueTasks.length, actualPace };
  }

  // Splice back by week id
  const cloned = clonePlan(futurePlan);
  const returnedById = new Map(returnedWeeks.filter((w) => w && w.id).map((w) => [w.id, w]));
  let spliced = 0;
  for (const loc of targetWeeks) {
    const replacement = returnedById.get(loc.week.id);
    if (!replacement) continue;
    const month = cloned.years[loc.yearIdx]?.months?.[loc.monthIdx];
    if (!month) continue;
    month.weeks[loc.weekIdx] = {
      ...loc.week,
      ...replacement,
      id: loc.week.id,
      label: loc.week.label,
      locked: false,
    };
    spliced++;
  }

  if (spliced === 0) {
    console.warn(`[adaptive-reschedule] local splice matched 0 weeks for goal ${goalId} — plan not updated`);
    return { ok: true, planUpdated: false, goalId, summary: null, overdueTasks: overdueTasks.length, actualPace };
  }

  const merged = mergePlans(pastPlan, cloned);
  await repos.goalPlan.replacePlan(
    goalId,
    merged,
    goal.createdAt?.split("T")[0],
    goal.targetDate,
  );
  // Local scope does NOT touch targetDate — that's plan-level's job.
  const updatedGoal = {
    ...goal,
    plan: merged,
    rescheduleBannerDismissed: true,
  } as typeof goal;
  await repos.goals.upsert(updatedGoal);
  await repos.nudges.dismissByContext(goalId);

  try {
    const pendingTasks = await repos.dailyTasks.listPendingReschedule(today);
    const goalOverdue = pendingTasks.filter((t) => t.goalId === goalId);
    for (const t of goalOverdue) {
      await repos.dailyTasks.update(t.id, { payload: { rescheduleDismissed: true } });
    }
    if (goalOverdue.length > 0) {
      console.log(`[adaptive-reschedule] Dismissed ${goalOverdue.length} overdue daily_tasks for goal ${goalId} (local)`);
    }
  } catch (err) {
    console.warn(`[adaptive-reschedule] Failed to dismiss overdue tasks for goal ${goalId}:`, err);
  }

  emitViewInvalidate(userId, {
    viewKinds: ["view:goal-plan", "view:dashboard", "view:tasks", "view:calendar"],
  });

  console.log(
    `[adaptive-reschedule] local path rewrote ${spliced} week(s) for goal ${goalId}. overdue=${overdueTasks.length}`,
  );

  void (async () => {
    try {
      const { runCritique } = await import("../../critique");
      await runCritique({
        userId,
        handler: "adaptive-reschedule-local",
        primaryOutput: { weeks: returnedWeeks, reasoning: classification.reasoning },
        memoryContext,
        payload: { goalId, level: "local", overdueCount: overdueTasks.length, actualPace },
        correlationId: goalId,
      });
    } catch (err) {
      console.error("[critique] adaptive-reschedule-local dispatch failed:", err);
    }
  })();

  return { ok: true, planUpdated: true, goalId, summary: null, overdueTasks: overdueTasks.length, actualPace };
}

// ── Micro-level: deterministic placement, no AI ────────────────────

async function runMicroLevelReschedule(
  ctx: ReschedContextWithClassification,
): Promise<unknown> {
  const { userId, goalId, goal, today, actualPace, split, memory, classification } = ctx;
  const { pastPlan, futurePlan, overdueTasks } = split;

  if (overdueTasks.length === 0) {
    // Caught-up goal: classifier routes here; no work to do.
    emitViewInvalidate(userId, {
      viewKinds: ["view:dashboard", "view:tasks", "view:calendar"],
    });
    return { ok: true, planUpdated: false, goalId, summary: null, overdueTasks: 0, actualPace };
  }

  if (overdueTasks.length > 3) {
    // Forced scopeOverride=micro on a slip the micro path isn't sized for.
    console.log(
      `[adaptive-reschedule] micro path received ${overdueTasks.length} overdue tasks (>3) → falling back to local`,
    );
    return runLocalLevelReschedule(ctx);
  }

  const capacity = Math.max(Math.ceil(actualPace), 1);
  const cloned = clonePlan(futurePlan);
  const placements: Array<{ taskId: string; title: string; newDay: string }> = [];
  const toPlace = overdueTasks.slice(0, 3);

  for (const task of toPlace) {
    let placed = false;
    outer: for (const yr of cloned.years) {
      for (const mo of yr.months) {
        for (const wk of mo.weeks) {
          for (const dy of wk.days) {
            if (!dy.label || !/^\d{4}-\d{2}-\d{2}$/.test(dy.label)) continue;
            if (dy.label < today) continue;
            const dayTasks = dy.tasks ?? [];
            if (dayTasks.length < capacity) {
              const moved: GoalPlanTaskT = {
                id: task.id,
                title: task.title,
                description: task.description,
                durationMinutes: task.durationMinutes,
                priority: task.priority,
                category: task.category,
                completed: false,
              };
              dy.tasks = [...dayTasks, moved];
              placements.push({ taskId: task.id, title: task.title, newDay: dy.label });
              placed = true;
              break outer;
            }
          }
        }
      }
    }
    if (!placed) {
      console.log(
        `[adaptive-reschedule] micro-path capacity exhausted → falling back to local`,
      );
      return runLocalLevelReschedule(ctx);
    }
  }

  const merged = mergePlans(pastPlan, cloned);
  await repos.goalPlan.replacePlan(
    goalId,
    merged,
    goal.createdAt?.split("T")[0],
    goal.targetDate,
  );
  const updatedGoal = {
    ...goal,
    plan: merged,
    rescheduleBannerDismissed: true,
  } as typeof goal;
  await repos.goals.upsert(updatedGoal);
  await repos.nudges.dismissByContext(goalId);

  const placedTitles = new Set(placements.map((p) => p.title));
  try {
    const pendingTasks = await repos.dailyTasks.listPendingReschedule(today);
    const matches = pendingTasks.filter(
      (t) => t.goalId === goalId && placedTitles.has(t.title),
    );
    for (const t of matches) {
      await repos.dailyTasks.update(t.id, { payload: { rescheduleDismissed: true } });
    }
    if (matches.length > 0) {
      console.log(`[adaptive-reschedule] Dismissed ${matches.length} overdue daily_tasks for goal ${goalId} (micro)`);
    }
  } catch (err) {
    console.warn(`[adaptive-reschedule] Failed to dismiss overdue tasks for goal ${goalId}:`, err);
  }

  emitViewInvalidate(userId, {
    viewKinds: ["view:dashboard", "view:tasks", "view:calendar"],
  });

  console.log(
    `[adaptive-reschedule] micro path placed ${placements.length}/${overdueTasks.length} overdue tasks for goal ${goalId}`,
  );

  void (async () => {
    try {
      const memoryContext = await buildMemoryContext(memory, "daily");
      const { runCritique } = await import("../../critique");
      await runCritique({
        userId,
        handler: "adaptive-reschedule-micro",
        primaryOutput: { placements, reasoning: classification.reasoning },
        memoryContext,
        payload: { goalId, level: "micro", overdueCount: overdueTasks.length, actualPace },
        correlationId: goalId,
      });
    } catch (err) {
      console.error("[critique] adaptive-reschedule-micro dispatch failed:", err);
    }
  })();

  return { ok: true, planUpdated: true, goalId, summary: null, overdueTasks: overdueTasks.length, actualPace };
}

/**
 * Batch-adjust all overloaded goal plans when too many reschedule tasks
 * pile up. Runs cmdAdaptiveReschedule sequentially for each goal so the
 * AI redistributes tasks at the user's actual pace. Requires user
 * confirmation on the frontend before dispatching.
 */
export async function cmdAdjustAllOverloadedPlans(
  body: Record<string, unknown>,
): Promise<unknown> {
  const goalIds = (body.goalIds ?? (body.payload as Record<string, unknown>)?.goalIds) as string[];
  if (!Array.isArray(goalIds) || goalIds.length === 0) {
    throw new Error("command:adjust-all-overloaded-plans requires goalIds[]");
  }

  const userId = getCurrentUserId();
  const results: Array<{ goalId: string; ok: boolean; error?: string }> = [];
  let adjustedCount = 0;

  emitAgentProgress(userId, {
    agentId: "adaptive-reschedule",
    phase: "running",
    message: `Adjusting ${goalIds.length} overloaded plan${goalIds.length > 1 ? "s" : ""}...`,
  });

  for (let i = 0; i < goalIds.length; i++) {
    const goalId = goalIds[i];
    const goal = await repos.goals.get(goalId);
    const goalTitle = goal?.title ?? goalId.slice(0, 8);

    emitAgentProgress(userId, {
      agentId: "adaptive-reschedule",
      phase: "running",
      message: `Adjusting plan ${i + 1}/${goalIds.length}: ${goalTitle}`,
    });

    try {
      const res = await cmdAdaptiveReschedule({ goalId }) as { ok: boolean; planUpdated?: boolean };
      results.push({ goalId, ok: !!res?.planUpdated });
      if (res?.planUpdated) adjustedCount++;
    } catch (err) {
      console.warn(`[adjust-all] Failed for goal ${goalId}:`, err);
      results.push({ goalId, ok: false, error: String(err) });
    }
  }

  emitAgentProgress(userId, {
    agentId: "adaptive-reschedule",
    phase: "done",
    message: `Adjusted ${adjustedCount}/${goalIds.length} plans`,
  });

  return { ok: true, results, adjustedCount };
}

/**
 * Generate a single lightweight bonus task when the user has completed
 * all tasks for the day. Appended to the existing list — never replaces.
 */
export async function cmdGenerateBonusTask(
  body: Record<string, unknown>,
): Promise<unknown> {
  const today = (body.date as string) || getEffectiveDate();
  const rangeStart = getEffectiveDaysAgo(90);

  const [goals, logs, tasks, heatmapData, activeReminders] =
    await Promise.all([
      repos.goals.list(),
      repos.dailyLogs.list(rangeStart, today),
      repos.dailyTasks.listForDateRange(rangeStart, today),
      repos.heatmap.listRange(rangeStart, today),
      repos.reminders.listActive(),
    ]);

  const tasksByDate = new Map<string, typeof tasks>();
  for (const t of tasks) {
    const arr = tasksByDate.get(t.date) ?? [];
    arr.push(t);
    tasksByDate.set(t.date, arr);
  }
  const pastLogs = logs
    .filter((l) => l.date !== today)
    .map((l) => {
      const dayTasks = tasksByDate.get(l.date) ?? [];
      return {
        date: l.date,
        tasks: dayTasks.map((dt) => ({
          id: dt.id,
          title: dt.title,
          completed: dt.completed,
          skipped: false,
        })),
      };
    })
    .slice(0, 14);

  // Generate with preserveExisting so AI knows what's already done
  const result = await generateAndPersistDailyTasks({
    date: today,
    goals,
    pastLogs: pastLogs as any,
    heatmapData,
    activeReminders,
    dryRun: true,
    preserveExisting: true,
  });

  // Pick the first task as the bonus suggestion
  const bonus = result.tasks?.[0];
  if (!bonus) {
    return { ok: true, bonus: null };
  }

  // Insert as an appended bonus task
  const existing = await repos.dailyTasks.listForDate(today);
  await repos.dailyTasks.insert({
    id: bonus.id ?? crypto.randomUUID(),
    date: today,
    title: bonus.title,
    completed: false,
    orderIndex: existing.length,
    goalId: bonus.goalId ?? null,
    planNodeId: bonus.planNodeId ?? null,
    source: bonus.goalId ? "big_goal" : "user_created",
    payload: {
      description: bonus.description,
      durationMinutes: bonus.durationMinutes,
      cognitiveWeight: bonus.cognitiveWeight ?? 2,
      whyToday: bonus.whyToday,
      priority: "bonus",
      category: bonus.category,
      source: "ai-generated",
      isBonus: true,
    },
  });

  return {
    ok: true,
    bonus: {
      id: bonus.id,
      title: bonus.title,
      description: bonus.description,
      durationMinutes: bonus.durationMinutes,
      cognitiveWeight: bonus.cognitiveWeight,
      category: bonus.category,
    },
  };
}

/**
 * Accept a single AI-proposed task (from post-confirmation regeneration).
 * Checks budget before inserting. If over budget, returns suggestion of
 * which existing task to swap out.
 */
export async function cmdAcceptTaskProposal(
  body: Record<string, unknown>,
): Promise<unknown> {
  const { runBudgetCheck } = await import("../../agents/gatekeeper");
  const today = (body.date as string) || getEffectiveDate();
  const proposal = body.proposal as Record<string, unknown> | undefined;
  if (!proposal || !proposal.title) {
    throw new Error("command:accept-task-proposal requires args.proposal with title");
  }

  const existing = await repos.dailyTasks.listForDate(today);
  const newWeight = (proposal.cognitiveWeight as number) ?? 3;

  const budget = runBudgetCheck(
    existing.map((t) => ({
      cognitiveWeight: (t.payload as Record<string, unknown>)?.cognitiveWeight as number | undefined,
      durationMinutes: (t.payload as Record<string, unknown>)?.durationMinutes as number | undefined,
    })),
    newWeight,
  );

  if (budget.overBudget && body.force !== true) {
    // Find the lowest-priority incomplete task to suggest swapping
    const swapCandidate = existing
      .filter((t) => !t.completed)
      .sort((a, b) =>
        ((a.payload as Record<string, unknown>)?.cognitiveWeight as number ?? 3) -
        ((b.payload as Record<string, unknown>)?.cognitiveWeight as number ?? 3),
      )[0];
    return {
      ok: false,
      budgetExceeded: true,
      budget,
      swapSuggestion: swapCandidate
        ? {
            id: swapCandidate.id,
            title: swapCandidate.title,
            cognitiveWeight:
              (swapCandidate.payload as Record<string, unknown>)?.cognitiveWeight as number ?? 3,
          }
        : null,
    };
  }

  const id = (proposal.id as string) ?? crypto.randomUUID();

  // B-4: gap-filler proposals ride in with a `proposedSlot` so we can dual-
  // write the time block at accept time. Other proposal sources have no
  // slot and this block is skipped entirely.
  const proposedSlot = (proposal.proposedSlot as
    | { startIso?: string; endIso?: string }
    | undefined) ?? undefined;
  const hasSlot =
    proposedSlot !== undefined &&
    typeof proposedSlot.startIso === "string" &&
    typeof proposedSlot.endIso === "string";

  await repos.dailyTasks.insert({
    id,
    date: today,
    title: proposal.title as string,
    completed: false,
    orderIndex: existing.length,
    goalId: (proposal.goalId as string) ?? null,
    planNodeId: (proposal.planNodeId as string) ?? null,
    source: (proposal.goalId as string) ? "big_goal" : "user_created",
    payload: {
      description: (proposal.description as string) ?? "",
      durationMinutes: (proposal.durationMinutes as number) ?? 30,
      cognitiveWeight: newWeight,
      priority: (proposal.priority as string) ?? "should-do",
      category: (proposal.category as string) ?? "planning",
      whyToday: (proposal.whyToday as string) ?? "",
      source: hasSlot ? "gap-filler" : "ai-generated",
      ...(hasSlot
        ? {
            scheduledTime: proposedSlot!.startIso!.slice(11, 16),
            scheduledEndTime: proposedSlot!.endIso!.slice(11, 16),
          }
        : {}),
    },
  });

  if (hasSlot) {
    try {
      await repos.dailyTasks.update(id, {
        scheduledStartIso: proposedSlot!.startIso!,
        scheduledEndIso: proposedSlot!.endIso!,
      });
    } catch (err) {
      console.error("[accept-task-proposal] failed to dual-write slot:", err);
    }
  }

  return { ok: true, taskId: id };
}

/**
 * One-time heal: re-normalize all big goal plans with timeline gap-fill.
 * Does NOT delete any tasks — only adds missing structural nodes
 * (years, months, weeks, days) so the timeline is a complete grid.
 */
export async function cmdHealAllGoalPlans(): Promise<unknown> {
  const goals = await repos.goals.list();
  const bigGoals = goals.filter(
    (g) =>
      g.status !== "archived" &&
      g.status !== "completed" &&
      (g.goalType === "big" || ((!g.goalType) && g.scope === "big")) &&
      g.planConfirmed,
  );

  const results: Array<{ goalId: string; title: string; healed: boolean; nodesBefore?: number; nodesAfter?: number }> = [];

  for (const goal of bigGoals) {
    try {
      const nodes = await repos.goalPlan.listForGoal(goal.id);
      console.log(`[heal-all] ${goal.title}: ${nodes.length} nodes in DB, planConfirmed=${goal.planConfirmed}`);
      let plan = nodes.length > 0
        ? repos.goalPlan.reconstructPlan(nodes)
        : null;
      // Fall back to inline plan if reconstruction is empty
      if (!plan || (plan.years.length === 0 && plan.milestones.length === 0)) {
        plan = goal.plan ?? null;
        console.log(`[heal-all] ${goal.title}: using inline plan, years=${plan?.years?.length}`);
      }
      if (!plan || !Array.isArray(plan.years) || plan.years.length === 0) {
        console.log(`[heal-all] ${goal.title}: skipped — no plan data`);
        results.push({ goalId: goal.id, title: goal.title, healed: false });
        continue;
      }

      const startDate = goal.createdAt?.split("T")[0];
      const endDate = goal.targetDate;
      const nodesBefore = nodes.length;
      console.log(`[heal-all] ${goal.title}: healing with startDate=${startDate}, endDate=${endDate}`);

      // normalizePlan + gap-fill, then persist
      await repos.goalPlan.replacePlan(goal.id, plan, startDate, endDate);

      const nodesAfter = (await repos.goalPlan.listForGoal(goal.id)).length;
      console.log(`[heal-all] ${goal.title}: ${nodesBefore} → ${nodesAfter} nodes`);
      results.push({ goalId: goal.id, title: goal.title, healed: true, nodesBefore, nodesAfter });
    } catch (err) {
      console.warn(`[heal-all] Failed for ${goal.id}:`, err);
      results.push({ goalId: goal.id, title: goal.title, healed: false });
    }
  }

  return { ok: true, healed: results.filter((r) => r.healed).length, total: bigGoals.length, results };
}

// ── Priority feedback (A-2) ─────────────────────────────────

/**
 * Explicit priority feedback from the UI ("this shouldn't be priority 1
 * today"). Writes a priority_feedback signal that reflection later
 * distills into ranking-preference rules.
 *
 * Implicit feedback (complete/skip/defer) is captured automatically from
 * the task command handlers; this path is the explicit "wrong priority"
 * button.
 */
export async function cmdSubmitPriorityFeedback(
  body: Record<string, unknown>,
): Promise<unknown> {
  const taskId = body.taskId as string | undefined;
  const signal = body.signal as string | undefined;
  const reason = body.reason as string | undefined;
  if (!taskId) throw new Error("command:submit-priority-feedback requires args.taskId");
  if (!signal) throw new Error("command:submit-priority-feedback requires args.signal");
  const allowed = new Set(["complete", "skip", "defer", "wrong_priority"]);
  if (!allowed.has(signal)) {
    throw new Error(
      `command:submit-priority-feedback signal must be one of complete|skip|defer|wrong_priority, got ${signal}`,
    );
  }
  const task = await repos.dailyTasks.get(taskId);
  if (!task) return { ok: true, noop: true };
  const pl = task.payload as Record<string, unknown>;
  const category = (pl?.category as string) ?? "planning";
  const tier = (pl?.tier as string) ?? undefined;
  const dayOfWeek = new Date(task.date + "T00:00:00").getDay();
  const { recordPriorityFeedback } = await import("../../services/signalRecorder");
  await recordPriorityFeedback(task.title, signal as "complete" | "skip" | "defer" | "wrong_priority", {
    category,
    tier,
    dayOfWeek,
    reason,
  });
  return { ok: true };
}

// ── Gap fillers (B-4) ──────────────────────────────────────

/**
 * B-4: detect today's calendar gaps, pick short plan tasks that fit, and
 * write them into `pending_tasks` with `status="ready"` so the existing
 * `command:accept-task-proposal` path can promote them into daily_tasks.
 *
 * Flag-gated — when `settings.gapFillersEnabled` is not true the command
 * returns `{ ok: true, skipped: true }` without reading gaps or writing
 * proposals. That keeps B-4 additive for pre-upgrade users.
 */
export async function cmdProposeGapFillers(
  body: Record<string, unknown>,
): Promise<unknown> {
  const date = (body.date as string) || getEffectiveDate();
  const { proposeGapFillers } = await import("../../services/gapFiller");
  const result = await proposeGapFillers(date);
  if (result.skipped) {
    return { ok: true, skipped: true, reason: result.reason ?? "skipped" };
  }
  return {
    ok: true,
    proposals: result.proposals.map((p) => ({
      id: p.proposalId,
      title: p.task.title,
      goalId: p.task.goalId,
      durationMinutes: p.task.durationMinutes,
      proposedSlot: { startIso: p.gap.startIso, endIso: p.gap.endIso },
    })),
    gapsDetected: result.gaps.length,
  };
}
