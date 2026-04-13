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
  generateAndPersistDailyTasks,
  splitPlan,
  mergePlans,
  runStreamingHandler,
  getClient,
  ADAPTIVE_RESCHEDULE_SYSTEM,
  getModelForTask,
  personalizeSystem,
} from "./_helpers";

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
  await repos.goalPlan.replacePlan(goalId, plan);
  // Flip planConfirmed on the goal so dashboards/goal-plan view stop
  // showing the "not planned" state.
  const existing = await repos.goals.get(goalId);
  if (existing) {
    await repos.goals.upsert({
      ...existing,
      plan,
      planConfirmed: true,
      status: existing.status === "planning" ? "active" : existing.status,
    });
  }
  const reply = resultObj.reply as string | undefined;
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

export async function cmdRegenerateDailyTasks(
  body: Record<string, unknown>,
): Promise<unknown> {
  const today = (body.date as string) || getEffectiveDate();
  const rangeStart = getEffectiveDaysAgo(90);

  // Save completed/skipped state before regeneration
  const existingTasks = await repos.dailyTasks.listForDateRange(today, today);
  const completedNodes = new Set<string>();
  const completedTitles = new Set<string>();
  for (const t of existingTasks) {
    if (t.completed) {
      if (t.planNodeId) completedNodes.add(t.planNodeId);
      completedTitles.add(t.title.toLowerCase());
    }
  }

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

  await generateAndPersistDailyTasks({
    date: today,
    goals,
    pastLogs: pastLogs as any,
    heatmapData,
    activeReminders,
  });

  // Restore completed state: re-mark tasks that were completed before
  const freshTasks = await repos.dailyTasks.listForDateRange(today, today);
  for (const t of freshTasks) {
    const wasCompleted =
      (t.planNodeId && completedNodes.has(t.planNodeId)) ||
      completedTitles.has(t.title.toLowerCase());
    if (wasCompleted && !t.completed) {
      await repos.dailyTasks.update(t.id, { completed: true });
    }
  }

  return { ok: true, date: today, taskCount: freshTasks.length };
}

export async function cmdAdaptiveReschedule(
  body: Record<string, unknown>,
): Promise<unknown> {
  const goalId = (body.goalId as string) || (body.payload as Record<string, unknown>)?.goalId as string;
  if (!goalId) throw new Error("command:adaptive-reschedule requires goalId");
  const goal = await repos.goals.get(goalId);
  if (!goal) throw new Error(`goal ${goalId} not found`);
  if (!goal.plan || !Array.isArray(goal.plan.years)) {
    throw new Error(`goal ${goalId} has no plan to reschedule`);
  }

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
  const memory = await loadMemory(userId);
  const capacity = computeCapacityProfile(
    memory,
    logsForCapacity,
    new Date(today + "T00:00:00").getDay(),
  );
  const actualPace = capacity.avgTasksCompletedPerDay || 2;

  const { pastPlan, futurePlan, overdueTasks } = splitPlan(goal.plan);

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

  const memoryContext = buildMemoryContext(memory, "daily");

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

OVERDUE TASKS (${overdueTasks.length} incomplete from past weeks — must be rescheduled):
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
    const typedFuture = newFuturePlan as unknown as import("@northstar/core").GoalPlan;

    // Strip incomplete tasks from locked (past) weeks — they've been
    // redistributed into the future plan by the AI. Leaving them causes
    // detectPaceMismatches to keep counting them as overdue.
    const cleanedPast: import("@northstar/core").GoalPlan = {
      milestones: pastPlan.milestones,
      years: pastPlan.years.map((yr) => ({
        ...yr,
        months: yr.months.map((mo) => ({
          ...mo,
          weeks: mo.weeks.map((wk) => ({
            ...wk,
            days: (wk.days ?? []).map((d) => ({
              ...d,
              tasks: (d.tasks ?? []).filter((t) => t.completed),
            })),
          })),
        })),
      })),
    };

    const merged = mergePlans(cleanedPast, typedFuture);
    await repos.goalPlan.replacePlan(goalId, merged);

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
    console.log(`[adaptive-reschedule] Plan updated for goal ${goalId}. targetDate → ${projectedCompletion}, overdue cleaned: ${overdueTasks.length}`);
  } else {
    console.warn(`[adaptive-reschedule] AI response missing valid plan.years — plan not updated. Keys: ${Object.keys(resultObj).join(", ")}`);
  }

  return { ok: true, planUpdated, goalId, summary, overdueTasks: overdueTasks.length, actualPace };
}
