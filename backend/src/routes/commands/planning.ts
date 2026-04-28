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
} from "@starward/core";
import { computeLowCompletionStreak } from "../../services/lowCompletionStreak";
import { LOCAL_RESCHEDULE_SYSTEM } from "../../agents/prompts/adaptiveReschedule";
import { allocatePace } from "../../services/crossGoalAllocator";

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

/**
 * Generate (or regenerate) a big goal's plan.
 *
 * This handler runs inside the async job worker — `command:regenerate-goal-plan`
 * dispatches to `insertJob` in `commands.ts:202`, and the worker pulls the
 * row off job_queue and invokes us here.
 *
 * Pipeline (routes through bigGoalCoordinator for effort-aware planning,
 * matching `/ai/goal-plan-chat/stream` which has always used the same
 * coordinator for realtime plan edits):
 *
 *   1. Fetch the goal from `goals` table.
 *   2. Call `coordinateBigGoal`:
 *        • Haiku effort router classifies HIGH vs LOW.
 *        • HIGH → parallel research agent + personalization agent.
 *        • LOW  → quick personalization only.
 *      Returns `{ research, personalization, memoryContext, capacityContext }`.
 *   3. Build an enriched AI payload — goal fields (title/description/
 *      targetDate/importance/isHabit) plus `_researchSummary` +
 *      `_researchFindings` the prompt expects.
 *   4. Call `handleAIRequest("generate-goal-plan", …)` directly with the
 *      coordinator's memoryContext (skip `runAI` — it would rebuild a
 *      plainer memoryContext and clobber the coordinator's personalized one).
 *   5. Validate the plan shape, persist via `goalPlan.replacePlan`, flip
 *      `goal.planConfirmed`, emit view:invalidate via the command dispatcher.
 *
 * The old path called `runAI("generate-goal-plan", payload, "planning")` with
 * only `{goalId}` on the payload — the handler received `goalTitle:
 * undefined`, `targetDate: undefined`, etc. and generated a prompt with
 * literal "Goal: undefined". That's fixed here by fetching the goal and
 * explicitly populating the payload fields the handler reads.
 */
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

  // Step 1: Fetch the goal (needed for coordinator input + payload enrichment).
  const existing = await repos.goals.get(goalId);
  if (!existing) {
    throw new Error(`Goal ${goalId} not found`);
  }

  // Step 2: Route through the big-goal coordinator so the plan receives
  // research + personalization + personalized memoryContext. Graceful
  // fallback: if the coordinator fails (e.g. ANTHROPIC_API_KEY missing
  // on effort-router), we fall back to a plain memoryContext build so
  // the job still produces something.
  const todayISO = new Date().toISOString().split("T")[0];
  const [allGoals, todayTaskRecords] = await Promise.all([
    repos.goals.list(),
    repos.dailyTasks.listForDate(todayISO),
  ]);
  const currentCognitiveLoad = todayTaskRecords.reduce((sum, t) => {
    const w = (t.payload as Record<string, unknown>).cognitiveWeight;
    return sum + (typeof w === "number" ? w : 2);
  }, 0);

  const { coordinateBigGoal } = await import("../../coordinators/bigGoalCoordinator");
  let coordResult: Awaited<ReturnType<typeof coordinateBigGoal>> | null = null;
  try {
    coordResult = await coordinateBigGoal({
      userMessage: `Generate a plan for: ${existing.title}`,
      goal: {
        id: existing.id,
        title: existing.title,
        description: existing.description ?? "",
        targetDate: existing.targetDate ?? "",
        importance: existing.importance ?? "medium",
        goalType: existing.goalType ?? "big",
      },
      existingGoals: allGoals
        .filter((g) => g.id !== goalId)
        .map((g) => ({
          title: g.title,
          goalType: g.goalType ?? "big",
          status: g.status,
        })),
      todayTaskCount: todayTaskRecords.length,
      currentCognitiveLoad,
    });
  } catch (err) {
    console.warn(
      "[cmdRegenerateGoalPlan] bigGoalCoordinator failed, falling back to plain memoryContext:",
      err,
    );
  }

  // Step 3: Build the enriched AI payload. The generate-goal-plan handler
  // reads goalTitle/description/targetDate/importance/isHabit directly off
  // `payload`, plus `_researchSummary` and `_researchFindings` injected by
  // the coordinator. See backend/core/src/ai/handlers/generateGoalPlan.ts.
  const researchSummary = coordResult?.research?.summary ?? "";
  // `ResearchResult.findings` is a structured object (see
  // bigGoal/researchAgent.ts ResearchResult). The generate-goal-plan
  // handler expects `_researchFindings` as string[], so we flatten into
  // one bullet per finding category — Opus reads them as numbered lines.
  const researchFindings: string[] = [];
  const f = coordResult?.research?.findings;
  if (f) {
    if (f.estimatedTotalHours > 0)
      researchFindings.push(`Estimated total hours: ${f.estimatedTotalHours}`);
    if (f.suggestedTimeline)
      researchFindings.push(`Suggested timeline: ${f.suggestedTimeline}`);
    if (f.keyMilestones?.length)
      researchFindings.push(`Key milestones: ${f.keyMilestones.join("; ")}`);
    if (f.bestPractices?.length)
      researchFindings.push(`Best practices: ${f.bestPractices.join("; ")}`);
    if (f.commonPitfalls?.length)
      researchFindings.push(`Common pitfalls: ${f.commonPitfalls.join("; ")}`);
    if (f.dependencies?.length)
      researchFindings.push(`Dependencies: ${f.dependencies.join("; ")}`);
    if (f.domainAdvice)
      researchFindings.push(`Domain advice: ${f.domainAdvice}`);
  }
  // Resolve the goal's current phase from deadline distance so the
  // planner prompt can bias toward phase-appropriate work. Generic
  // archetype vocabulary ("early/mid/late/wrap") — job-search uses
  // "prep/apply/interview/decide" when archetype is hinted.
  const { resolvePhase } = await import(
    "../../coordinators/bigGoal/phaseResolver"
  );
  const resolvedPhase = resolvePhase({
    startDate: existing.createdAt?.split("T")[0] ?? todayISO,
    targetDate: existing.targetDate ?? "",
    today: todayISO,
  });
  const currentPhase = existing.currentPhase ?? resolvedPhase;

  const enrichedPayload: Record<string, unknown> = {
    ...payload,
    goalId,
    goalTitle: existing.title,
    description: existing.description ?? "",
    targetDate: existing.targetDate ?? "",
    importance: existing.importance ?? "medium",
    isHabit: existing.isHabit ?? false,
    startDate: existing.createdAt?.split("T")[0] ?? todayISO,
    _researchSummary: researchSummary,
    _researchFindings: researchFindings,
    // Methodology-layer fields (Phase D/E). Optional on the payload;
    // planner prompt only renders the block when any are present.
    _weeklyHoursTarget: existing.weeklyHoursTarget,
    _currentPhase: currentPhase,
    _funnelMetrics: existing.funnelMetrics,
    _skillMap: existing.skillMap,
    _laborMarketData: coordResult?.laborMarket ?? existing.laborMarketData,
    _clarificationAnswers: existing.clarificationAnswers,
  };

  // Step 4: Call the AI handler directly so we can pass the coordinator's
  // personalized memoryContext. `runAI` would rebuild a plainer memoryContext
  // via buildMemoryContext and overwrite ours.
  const userId = getCurrentUserId();
  let memoryContext = coordResult?.memoryContext ?? "";
  if (!memoryContext) {
    const memory = await loadMemory(userId);
    memoryContext = await buildMemoryContext(memory, "planning");
  }
  const { handleAIRequest } = await import("../../ai/router");
  const result = await handleAIRequest(
    "generate-goal-plan",
    enrichedPayload,
    memoryContext,
  );
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
  const plan = planCandidate as unknown as import("@starward/core").GoalPlan;
  // Goal was already fetched at the top for coordinator input; reuse it
  // for the date-range gap-fill + planConfirmed flip below.
  const goalStartDate = existing.createdAt?.split("T")[0];
  const goalEndDate = existing.targetDate;

  // Persist methodology-layer state produced by the planner/coordinator:
  //   - laborMarketData: from the (stubbed) web_search fetcher run in
  //     parallel with research + personalization (Phase C).
  //   - planRationale: top-level "why this shape" string from the AI's
  //     plan response (Phase E).
  //   - currentPhase: deterministic resolution from deadline distance.
  //
  // ⚠ Order matters: we flip `planConfirmed = true` BEFORE replacePlan.
  // goalPlanRepo.replacePlan auto-materializes daily_tasks only for
  // goals with planConfirmed=true (see its JSDoc). If we upserted after
  // replacePlan, materialization would read the pre-flip value (false)
  // and skip — leaving the Tasks page + Calendar empty for every
  // first-time plan generation. Flipping first keeps the helper's
  // invariant consistent with our intent here ("regenerate AND
  // confirm").
  const planRationale =
    typeof resultObj.planRationale === "string"
      ? (resultObj.planRationale as string)
      : existing.planRationale;
  await repos.goals.upsert({
    ...existing,
    plan,
    planConfirmed: true,
    status: existing.status === "planning" ? "active" : existing.status,
    laborMarketData: coordResult?.laborMarket ?? existing.laborMarketData,
    planRationale,
    currentPhase: currentPhase ?? existing.currentPhase,
  });
  await repos.goalPlan.replacePlan(goalId, plan, goalStartDate, goalEndDate);

  // If a Project Agent Context wasn't already loaded on this goal, save
  // the research + personalization from the coordinator so follow-up plan
  // edits (via /ai/goal-plan-chat/stream) can skip the research step. This
  // mirrors what `cmdConfirmGoalPlan` does via the onGoalConfirmed hook.
  if (
    coordResult &&
    coordResult.effort === "high" &&
    !coordResult.projectContextLoaded &&
    coordResult.research
  ) {
    try {
      const { saveProjectContext } = await import(
        "../../coordinators/bigGoal/projectAgentContext"
      );
      await saveProjectContext(goalId, {
        research: coordResult.research,
        personalization: {
          avgTasksPerDay: coordResult.personalization?.avgTasksPerDay ?? 0,
          completionRate: coordResult.personalization?.completionRate ?? 0,
          maxDailyWeight: coordResult.personalization?.maxDailyWeight ?? 10,
          overwhelmRisk: coordResult.personalization?.overwhelmRisk ?? "low",
          trend: coordResult.personalization?.trend ?? "stable",
        },
        decisions: [],
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.warn(
        "[cmdRegenerateGoalPlan] saveProjectContext failed (non-fatal):",
        err,
      );
    }
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
      const { computeDynamicBudget } = await import("@starward/core");

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
type GoalPlanT = import("@starward/core").GoalPlan;
type GoalPlanTaskT = import("@starward/core").GoalPlanTask;
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

  // Optional `paceOverride`: when multiple goals are being re-planned in
  // one user action (cmdAdjustAllOverloadedPlans), the orchestrator
  // divides the user's measured pace across goals by importance weight
  // and passes each goal's slice here. Single-goal callers (including
  // the "Adaptive reshuffle" button on Goal Plan) omit it and the
  // handler falls back to the measured user pace — byte-identical to
  // pre-allocator behavior. See services/crossGoalAllocator.ts.
  const paceOverrideRaw =
    (body.paceOverride as number | undefined) ??
    (payload.paceOverride as number | undefined);
  const paceOverride =
    typeof paceOverrideRaw === "number" && paceOverrideRaw > 0
      ? paceOverrideRaw
      : undefined;

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
  void user;
  const capacity = computeCapacityProfile(
    memory,
    logsForCapacity,
    new Date(today + "T00:00:00").getDay(),
  );
  const measuredPace = capacity.avgTasksCompletedPerDay || 2;
  const actualPace = paceOverride ?? measuredPace;
  console.log(
    `[adaptive-reschedule] goal=${goalId.slice(0, 8)} pace=${actualPace}` +
      ` (${paceOverride !== undefined ? "override" : "measured"})`,
  );

  // Phase G: persist the *measured* pace on the goal — not the fair-
  // share override. The snapshot represents how fast the user is
  // actually working, independent of how we slice that pace across
  // goals. Using measuredPace keeps the value stable across batch
  // reschedules.
  try {
    await repos.goals.setPaceSnapshot(goalId, measuredPace);
  } catch (err) {
    console.warn("[adaptive-reschedule] pace snapshot write failed:", err);
  }

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
    const forceFullRegen =
      body.forceFullRegen === true || payload.forceFullRegen === true;
    return runPlanLevelReschedule({
      userId,
      goalId,
      goal,
      today,
      actualPace,
      split,
      memory,
      forceFullRegen,
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
  /** When true, bypasses the L3 30-day rate limit. Set by manual
   *  user-initiated full regen (request-escalation with level=3). */
  forceFullRegen?: boolean;
}
interface ReschedContextWithClassification extends ReschedContext {
  classification: RescheduleClassifierOutput;
}

/** L3 rate limit: minimum days between full plan regenerations per
 *  goal. Codifies the plan's "Reserved for rare cases" intent so a
 *  bug or chat-intent loop can't burn tokens on repeated full regens. */
const FULL_REGEN_COOLDOWN_DAYS = 30;

async function runPlanLevelReschedule(
  ctx: ReschedContext,
): Promise<unknown> {
  const { userId, goalId, goal, today, actualPace, split, memory } = ctx;
  const { pastPlan, futurePlan, overdueTasks } = split;

  // L3 rate-limit gate. Reads goals.last_full_regen_at (migration 0016)
  // and rejects when the previous regen was less than the cooldown ago,
  // unless `forceFullRegen` is set on the request (manual override).
  try {
    const lastAt = await repos.goals.getLastFullRegenAt(goalId);
    if (lastAt) {
      const elapsedDays =
        (Date.now() - new Date(lastAt).getTime()) / 86_400_000;
      if (elapsedDays < FULL_REGEN_COOLDOWN_DAYS && !ctx.forceFullRegen) {
        const remaining = Math.ceil(FULL_REGEN_COOLDOWN_DAYS - elapsedDays);
        console.warn(
          `[adaptive-reschedule] L3 rate-limited for goal ${goalId} (${remaining}d remaining); falling back to local`,
        );
        // Fall back to the local (L2-shaped) path. Same context, no
        // throw — keeps the user-visible behavior smooth while still
        // protecting cost.
        return runLocalLevelReschedule(ctx as ReschedContextWithClassification);
      }
    }
  } catch (err) {
    // Best-effort. If the gate read fails, fall through to the regen
    // — better to occasionally re-run than to silently block.
    console.warn(`[adaptive-reschedule] rate-limit check failed for ${goalId}:`, err);
  }

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
    // L3 rate-limit stamp. Recorded only on a SUCCESSFUL full regen
    // so a parse failure or empty AI response doesn't burn the quota.
    try {
      await repos.goals.markFullRegen(goalId);
    } catch (err) {
      console.warn(`[adaptive-reschedule] markFullRegen failed for ${goalId}:`, err);
    }
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
    week: import("@starward/core").GoalPlanWeek;
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
    ? (resultObj.weeks as import("@starward/core").GoalPlanWeek[])
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

  // Compute the user's measured daily pace ONCE and divide it by
  // importance across all eligible big goals. Without this step every
  // per-goal reschedule would independently claim the full user pace,
  // so N goals each plan as if they own the whole day and the user
  // ends up right back in the same overload state. See
  // services/crossGoalAllocator.ts for the invariant.
  let allocation: ReturnType<typeof allocatePace> = {
    paceByGoalId: {},
    allocatedGoalIds: [],
    totalUserPace: 0,
  };
  try {
    const today = getEffectiveDate();
    const rangeStart = getEffectiveDaysAgo(14);
    const [allGoals, memory, taskRecords] = await Promise.all([
      repos.goals.list(),
      loadMemory(userId),
      repos.dailyTasks.listForDateRange(rangeStart, today),
    ]);
    const logsByDate = new Map<string, Array<{ completed: boolean; skipped?: boolean }>>();
    for (const t of taskRecords) {
      const arr = logsByDate.get(t.date) ?? [];
      arr.push({ completed: t.completed, skipped: Boolean(t.payload?.skipped) });
      logsByDate.set(t.date, arr);
    }
    const logsForCapacity = [...logsByDate.entries()].map(
      ([date, tasks]) => ({ date, tasks }),
    );
    const capacity = computeCapacityProfile(
      memory,
      logsForCapacity,
      new Date(today + "T00:00:00").getDay(),
    );
    const userPace = capacity.avgTasksCompletedPerDay || 2;
    allocation = allocatePace(allGoals, userPace);
    console.log(
      `[adjust-all] userPace=${userPace} eligible=${allocation.allocatedGoalIds.length} ` +
        `slices=${JSON.stringify(allocation.paceByGoalId)}`,
    );
  } catch (err) {
    console.warn(
      "[adjust-all] allocator setup failed; falling back to per-goal measured pace:",
      err,
    );
  }

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

    // paceOverride is undefined for goals that weren't in the eligible
    // filter (paused / not-confirmed / etc.); cmdAdaptiveReschedule
    // falls back to measured pace for those — same as before.
    const paceOverride = allocation.paceByGoalId[goalId];

    try {
      const res = await cmdAdaptiveReschedule({
        goalId,
        paceOverride,
      }) as { ok: boolean; planUpdated?: boolean };
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
/**
 * "Bonus task" button. Promotes one task that today's daily planner
 * coordinator already generated for today but that lightTriage demoted
 * to the bonus tier (because it was over the cognitive-budget cap).
 *
 * IMPORTANT: this handler MUST NOT create new tasks. Earlier versions
 * had an AI-generation fallback when the bonus pool was empty, which
 * caused duplicate task rows when users clicked repeatedly (each click
 * generated a new AI suggestion that often had the same title). The
 * user's design intent is unambiguous: the bonus button only surfaces
 * tasks the planner already chose for today; if nothing is left in the
 * bonus pool, return `bonus: null` and let the FE show a "caught up"
 * notice.
 *
 * Algorithm:
 *   1. Find existing bonus-tier tasks for today (priority=="bonus" OR
 *      isBonus). These were demoted by triage from real plan tasks the
 *      coordinator generated for today.
 *   2. Pick the highest-priority one (sort by demotedFrom: must-do >
 *      should-do > nice; tiebreak by cognitiveCost desc).
 *   3. PROMOTE it: clear isBonus, restore priority from demotedFrom,
 *      stamp userPromoted: true so triage's protection rule
 *      (services/dailyTriage.ts:isProtected) skips it on subsequent
 *      passes (otherwise it'd loop: promote → demote → promote …).
 *   4. If the bonus pool is empty, return { bonus: null }. NEVER fall
 *      through to AI generation — that creates duplicate tasks.
 */
export async function cmdGenerateBonusTask(
  body: Record<string, unknown>,
): Promise<unknown> {
  const today = (body.date as string) || getEffectiveDate();

  const existing = await repos.dailyTasks.listForDate(today);
  const demotedCandidates = existing
    .filter((t) => {
      if (t.completed) return false;
      const pl = t.payload as Record<string, unknown>;
      if (pl.skipped) return false;
      return pl.priority === "bonus" || Boolean(pl.isBonus);
    })
    .map((t) => {
      const pl = t.payload as Record<string, unknown>;
      const demotedFrom = (pl.demotedFrom as string | undefined) ?? "should-do";
      const demotedFromRank =
        demotedFrom === "must-do" ? 0 : demotedFrom === "should-do" ? 1 : 2;
      const cost = (t.cognitiveCost as number | null) ?? 0;
      return { task: t, demotedFromRank, cost };
    })
    .sort((a, b) => {
      if (a.demotedFromRank !== b.demotedFromRank) {
        return a.demotedFromRank - b.demotedFromRank;
      }
      return b.cost - a.cost;
    });

  // Bonus pool empty → caught up. The FE renders this as an "all
  // caught up" banner. Do not generate AI suggestions here — that
  // creates duplicate rows on repeated clicks.
  if (demotedCandidates.length === 0) {
    return { ok: true, bonus: null };
  }

  const { task } = demotedCandidates[0];
  const pl = task.payload as Record<string, unknown>;
  const restoredPriority = (pl.demotedFrom as string | undefined) ?? "should-do";
  await repos.dailyTasks.update(task.id, {
    payload: {
      priority: restoredPriority,
      isBonus: false,
      userPromoted: true,
      userPromotedAt: new Date().toISOString(),
      // Drop demoted-from / demoted-at since this task is no longer
      // demoted. Setting to undefined removes them from the merged
      // payload via dailyTasksRepo.update's spread.
      demotedFrom: undefined,
      demotedAt: undefined,
    },
  });
  return {
    ok: true,
    bonus: {
      id: task.id,
      title: task.title,
      description: (pl.description as string | undefined) ?? "",
      durationMinutes:
        task.estimatedDurationMinutes ??
        (pl.durationMinutes as number | undefined) ??
        30,
      cognitiveWeight: (pl.cognitiveWeight as number | undefined) ?? 3,
      category: (pl.category as string | undefined),
      promotedFrom: "bonus",
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

// ── Manual escalation request ──────────────────────────────
//
// User-initiated route into the L1/L2/L3 handlers, bypassing the
// classifier's automatic level decision. Used for explicit "redo
// this milestone" / "rebuild from scratch" intents from chat or
// (eventually) FE buttons.
//
// L3 still honors the 30-day rate limit unless `force=true` is
// passed. L1 and L2 have no cooldown (cheap and milestone-scoped).
//
// No FE wiring yet — invokable via dev harness or chat intent today.
// FE buttons ship in Phase F after notarization resolves.

export async function cmdRequestEscalation(
  body: Record<string, unknown>,
): Promise<unknown> {
  const goalId = typeof body.goalId === "string" ? body.goalId : null;
  const milestoneId = typeof body.milestoneId === "string" ? body.milestoneId : null;
  const level = body.level;
  const reason = (body.reason as string | undefined) ?? "manual";
  const force = body.force === true;

  if (level !== 1 && level !== 2 && level !== 3) {
    throw new Error("command:request-escalation requires level=1|2|3");
  }

  if (level === 1) {
    const { runL1DayScope } = await import("../../services/planAdjustmentL1");
    const result = await runL1DayScope({ rationale: `manual: ${reason}` });
    return { ok: true, level: 1, result };
  }

  if (level === 2) {
    if (!goalId || !milestoneId) {
      throw new Error("command:request-escalation level=2 requires goalId AND milestoneId");
    }
    const { runL2MilestoneScope } = await import("../../services/planAdjustmentL2");
    const result = await runL2MilestoneScope({
      goalId,
      milestoneId,
      rationale: `manual: ${reason}`,
    });
    return { ok: true, level: 2, result };
  }

  // level === 3
  if (!goalId) {
    throw new Error("command:request-escalation level=3 requires goalId");
  }
  // Pass `force` through cmdAdaptiveReschedule via scopeOverride="plan".
  // forceFullRegen is read inside runPlanLevelReschedule's rate-limit gate.
  const result = await cmdAdaptiveReschedule({
    goalId,
    scopeOverride: "plan",
    forceFullRegen: force,
  } as Record<string, unknown>);
  return { ok: true, level: 3, result };
}

// ── Pending-action accept / reject ────────────────────────
//
// The user confirms (or rejects) an AI-proposed mutation. Accept
// dispatches the underlying intent via the same handler that would
// have run if the FE had auto-dispatched it. Reject just marks the
// row rejected — no mutation, no chat termination. Subsequent chat
// turns can read recently-rejected actions (via
// pendingActionsRepo.listRecentRejectionsForSession) so the AI can
// react conversationally.
//
// Per-intent-kind switch lives here rather than in pendingActionsRepo
// so the repo stays a thin DB layer and the dispatcher imports are
// available at command-routing time.

export async function cmdAcceptPendingAction(
  body: Record<string, unknown>,
): Promise<unknown> {
  const actionId =
    (body.actionId as string | undefined) ??
    (body.id as string | undefined);
  if (!actionId) {
    throw new Error("command:accept-pending-action requires args.actionId");
  }

  const action = await repos.pendingActions.get(actionId);
  if (!action) {
    const { EntityNotFoundError } = await import("../../repositories/_context");
    throw new EntityNotFoundError("pending_action", actionId);
  }
  if (action.status !== "pending") {
    throw new Error(
      `pending_action ${actionId} is ${action.status}, not pending`,
    );
  }

  // Dispatch the underlying intent. Switch on intent_kind. The intent
  // payload is exactly what the FE auto-dispatcher would have sent to
  // the corresponding command. Add new kinds here as the AI's intent
  // vocabulary grows.
  const payload = action.intentPayload;
  let dispatchResult: unknown;
  switch (action.intentKind) {
    case "manage-task": {
      const action_ = (payload.action as string | undefined) ?? "";
      const taskId = payload.taskId as string | undefined;
      if (!taskId) throw new Error(`manage-task intent missing taskId`);
      const tasksMod = await import("./tasks");
      if (action_ === "complete") {
        dispatchResult = await tasksMod.cmdToggleTask({ taskId });
      } else if (action_ === "skip") {
        dispatchResult = await tasksMod.cmdSkipTask({ taskId });
      } else if (action_ === "delete") {
        dispatchResult = await tasksMod.cmdDeleteTask({ taskId });
      } else if (action_ === "reschedule") {
        const targetDate =
          (payload.rescheduleDate as string | undefined) ??
          (payload.targetDate as string | undefined);
        if (!targetDate) throw new Error("reschedule intent missing targetDate");
        dispatchResult = await tasksMod.cmdRescheduleTask({
          taskId,
          targetDate,
          force: true,
        });
      } else {
        throw new Error(`unknown manage-task action: ${action_}`);
      }
      break;
    }
    case "manage-reminder": {
      const action_ = (payload.action as string | undefined) ?? "";
      const calendarMod = await import("./calendar");
      if (action_ === "acknowledge") {
        // The original intent identifies the reminder by `term` (a free
        // text matcher). Without the FE's reminder-resolution helper,
        // we can't reliably translate term → id here. For now: require
        // the AI to include a resolved id, otherwise reject this kind.
        const id = payload.id as string | undefined;
        if (!id) {
          throw new Error(
            "manage-reminder accept requires resolved reminder id; AI must propose with id, not just term",
          );
        }
        dispatchResult = await calendarMod.cmdAcknowledgeReminder({ id });
      } else {
        throw new Error(`unknown manage-reminder action: ${action_}`);
      }
      break;
    }
    case "create-task":
    case "create": {
      const tasksMod = await import("./tasks");
      dispatchResult = await tasksMod.cmdCreateTask(payload);
      break;
    }
    default:
      throw new Error(
        `cmdAcceptPendingAction: no dispatcher for intent kind "${action.intentKind}". Add a case here when introducing new intent vocabulary.`,
      );
  }

  await repos.pendingActions.markAccepted(actionId);

  // Dismiss the proactive nudge that was created alongside the pending
  // action so it doesn't linger after acceptance.
  try {
    await repos.nudges.dismissByContext(`pending-action:${actionId}`);
  } catch {
    /* best-effort */
  }

  return { ok: true, actionId, dispatchResult };
}

export async function cmdRejectPendingAction(
  body: Record<string, unknown>,
): Promise<unknown> {
  const actionId =
    (body.actionId as string | undefined) ??
    (body.id as string | undefined);
  if (!actionId) {
    throw new Error("command:reject-pending-action requires args.actionId");
  }
  const reason =
    typeof body.reason === "string" ? (body.reason as string) : undefined;
  await repos.pendingActions.markRejected(actionId, reason);
  // Dismiss the proactive nudge so the user isn't left with a stale
  // proposal banner after they explicitly rejected it.
  try {
    await repos.nudges.dismissByContext(`pending-action:${actionId}`);
  } catch {
    /* best-effort */
  }
  return { ok: true, actionId, rejected: true };
}

// ── Plan-edit classify (preview) ─────────────────────────
//
// Read-only command. Takes a proposed plan, computes a diff against
// the current persisted plan, returns the projected impact WITHOUT
// applying the rewrite. Lets a future FE render a confirmation dialog
// before the user commits to a destructive overhaul:
//
//   "This change will reset 12 future tasks. Continue?"
//
// Today, every plan rewrite that goes through `goalPlan.replacePlan`
// already audits + emits a nudge after-the-fact. This command is the
// before-the-fact equivalent — same diff math, no DB writes.
//
// No FE wiring yet (waiting on notarization). Invokable via dev
// harness or chat intent in the meantime.

export async function cmdPlanEditClassify(
  body: Record<string, unknown>,
): Promise<unknown> {
  const goalId = typeof body.goalId === "string" ? body.goalId : null;
  const proposed = body.proposedPlan as Record<string, unknown> | undefined;
  if (!goalId) {
    throw new Error("command:plan-edit-classify requires goalId");
  }
  if (!proposed || typeof proposed !== "object") {
    throw new Error(
      "command:plan-edit-classify requires proposedPlan (GoalPlan shape)",
    );
  }

  const goal = await repos.goals.get(goalId);
  if (!goal) throw new Error(`goal ${goalId} not found`);

  const { diffPlans } = await import("@starward/core");
  const diff = diffPlans(goal.plan ?? null, proposed as unknown as import("@starward/core").GoalPlan);

  // Project how many materialized daily_tasks would be cleared if the
  // user committed this rewrite. Count daily_tasks currently linked to
  // plan nodes that the new plan removes; that's exactly what
  // pruneOrphanedPlanTasks would delete on apply.
  let projectedDailyTasksAffected = 0;
  try {
    const existingDailyTasks = await repos.dailyTasks.listForDateRange(
      new Date().toISOString().slice(0, 10),
      // 90-day horizon catches everything materializePlanTasks could touch
      // plus the rolling reschedule window.
      new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10),
    );
    const newTaskIds = new Set<string>();
    if (proposed && Array.isArray((proposed as Record<string, unknown>).years)) {
      for (const y of (proposed as Record<string, unknown>).years as Array<Record<string, unknown>>) {
        for (const m of (y.months as Array<Record<string, unknown>>) ?? []) {
          for (const w of (m.weeks as Array<Record<string, unknown>>) ?? []) {
            for (const d of (w.days as Array<Record<string, unknown>>) ?? []) {
              for (const t of (d.tasks as Array<Record<string, unknown>>) ?? []) {
                if (typeof t.id === "string") newTaskIds.add(t.id);
              }
            }
          }
        }
      }
    }
    projectedDailyTasksAffected = existingDailyTasks.filter(
      (dt) =>
        dt.goalId === goalId &&
        dt.planNodeId !== null &&
        !newTaskIds.has(dt.planNodeId),
    ).length;
  } catch (err) {
    console.warn("[plan-edit-classify] projection scan failed:", err);
  }

  return {
    ok: true,
    diff,
    projectedDailyTasksAffected,
    recommendation: diff.isOverhaul
      ? "Treated as an overhaul — applying will clear materialized future tasks and re-materialize from the new plan."
      : "Small edit — applying will preserve most materialized tasks; only ones linked to removed plan nodes will be cleared.",
  };
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
