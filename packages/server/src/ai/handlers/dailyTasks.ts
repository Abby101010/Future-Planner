/* NorthStar — Daily Tasks handler

   The largest handler: assembles a rich user message with
   capacity profile, monthly context, scheduling, environment,
   calendar events, and multi-goal context; then enforces
   shared cognitive budget rules on the AI's output. */

import Anthropic from "@anthropic-ai/sdk";
import { getScheduleContext } from "../../calendar";
import { loadMemory, computeCapacityProfile } from "../../memory";
import { getCurrentUserId } from "../../middleware/requestContext";
import { getMonthlyContext } from "../../database";
import { runStreamingHandler } from "../streaming";
import { emitAgentProgress } from "../../ws";
import { getModelForTask } from "@northstar/core";
import {
  enforceBudgetSnake,
  bonusTaskFits,
  COGNITIVE_BUDGET,
} from "@northstar/core";
import { DAILY_TASKS_SYSTEM } from "@northstar/core";
import { personalizeSystem } from "@northstar/core";
import type { DailyTasksPayload } from "@northstar/core";

export async function handleDailyTasks(
  client: Anthropic,
  payload: DailyTasksPayload,
  memoryContext: string,
): Promise<unknown> {
  const { date, heatmap, deviceIntegrations } = payload;
  const breakdown = payload.breakdown ?? payload.roadmap;
  const pastLogs = payload.pastLogs ?? [];
  const inAppEvents = payload.inAppEvents ?? [];

  let todayFreeMinutes = 120;
  try {
    const schedule = await getScheduleContext(
      date,
      date,
      inAppEvents as any,
      deviceIntegrations,
    );
    if (schedule.days.length > 0) {
      todayFreeMinutes = Math.min(schedule.days[0].freeMinutes, 240);
    }
  } catch {
    // no calendar data
  }

  const yesterday =
    pastLogs && pastLogs.length > 0 ? pastLogs[pastLogs.length - 1] : null;

  // ── Compute capacity profile from behavioral history ──
  const memory = await loadMemory(getCurrentUserId());
  const todayDayOfWeek = new Date(date).getDay();
  const logsForCapacity = (pastLogs || []).map((l) => ({
    date: l.date as string,
    tasks: ((l.tasks || []) as Array<Record<string, unknown>>).map((t) => ({
      completed: !!t.completed,
      skipped: !!t.skipped,
    })),
  }));

  // Fetch monthly context for capacity adjustment
  const currentMonth = date.substring(0, 7); // "YYYY-MM"
  let monthlyCtx: {
    capacityMultiplier: number;
    maxDailyTasks: number;
    intensity: string;
    description: string;
  } | null = null;
  try {
    const dbCtx = await getMonthlyContext(currentMonth);
    if (dbCtx) {
      monthlyCtx = {
        capacityMultiplier: dbCtx.capacity_multiplier,
        maxDailyTasks: dbCtx.max_daily_tasks,
        intensity: dbCtx.intensity,
        description: dbCtx.description,
      };
    }
  } catch {
    /* no monthly context */
  }

  const capacityProfile = computeCapacityProfile(
    memory,
    logsForCapacity,
    todayDayOfWeek,
    monthlyCtx,
  );

  const capacityBlock = `
CAPACITY PROFILE (computed from user's behavioral history):
  capacity_budget: ${capacityProfile.capacityBudget} (max cognitive weight points for today — HARD LIMIT)
  recent_completion_rate: ${capacityProfile.recentCompletionRate === -1 ? "no data (new user — default to 3-4 tasks, total weight ≤ 10)" : `${capacityProfile.recentCompletionRate}%`}
  avg_tasks_completed_per_day: ${capacityProfile.avgTasksCompletedPerDay}
  avg_tasks_assigned_per_day: ${capacityProfile.avgTasksAssignedPerDay}
  day_of_week_modifier: ${capacityProfile.dayOfWeekModifier > 0 ? "+" : ""}${capacityProfile.dayOfWeekModifier} (${capacityProfile.dayOfWeekModifier > 0 ? "strong day" : capacityProfile.dayOfWeekModifier < 0 ? "weak day" : "neutral"})
  overwhelm_days_last_14d: ${capacityProfile.overwhelmDays}
  trend: ${capacityProfile.trend}
  is_new_user: ${capacityProfile.isNewUser}
  chronic_snooze_patterns: ${capacityProfile.chronicSnoozePatterns.length > 0 ? capacityProfile.chronicSnoozePatterns.join(", ") : "none detected"}`;

  // Determine recommended task count based on capacity
  let recommendedCount: string;
  if (capacityProfile.recentCompletionRate === -1) {
    recommendedCount = "3-4 (new user)";
  } else if (capacityProfile.recentCompletionRate < 40) {
    recommendedCount = "2 (user is overwhelmed — rebuild confidence)";
  } else if (capacityProfile.recentCompletionRate < 60) {
    recommendedCount = "2-3 (user is struggling)";
  } else if (capacityProfile.recentCompletionRate < 75) {
    recommendedCount = "3-4 (building momentum)";
  } else if (capacityProfile.recentCompletionRate < 85) {
    recommendedCount = "3-5 (healthy zone)";
  } else {
    recommendedCount = "3-5 + bonus (strong performer)";
  }

  // Apply monthly context task cap
  if (capacityProfile.maxDailyTasks != null) {
    const max = capacityProfile.maxDailyTasks;
    recommendedCount = `${Math.max(1, max - 1)}-${max} (monthly context: ${monthlyCtx?.intensity || "adjusted"})`;
  }

  // ── Additional data sources ──
  const goalPlanSummaries = (payload.goalPlanSummaries ?? []) as Array<{
    goalId?: string;
    goalTitle: string;
    scope: string;
    goalType?: string;
    status: string;
    todayTasks: Array<{
      goalId?: string;
      planNodeId?: string;
      title: string;
      description: string;
      durationMinutes: number;
      priority: string;
      category: string;
    }>;
  }>;
  const confirmedQuickTasks = (payload.confirmedQuickTasks ?? []) as Array<{
    title: string;
    description: string;
    durationMinutes: number;
    cognitiveWeight: number;
    priority: string;
    category: string;
  }>;
  const todayCalendarEvents = (payload.todayCalendarEvents ?? []) as Array<{
    title: string;
    startDate: string;
    endDate: string;
    durationMinutes: number;
    category: string;
    isAllDay: boolean;
    recurring?: { frequency: string };
  }>;
  const everydayGoals = (payload.everydayGoals ?? []) as Array<{
    title: string;
    description: string;
    suggestedTimeSlot: string | null;
    tasks: Array<{
      title: string;
      description: string;
      durationMinutes: number;
      priority: string;
      category: string;
    }>;
  }>;
  const repeatingGoals = (payload.repeatingGoals ?? []) as Array<{
    title: string;
    timeOfDay: string | null;
    durationMinutes: number;
    frequency: string;
  }>;
  const isVacationDay = !!payload.isVacationDay;
  const todayReminders = (payload.todayReminders ?? []) as Array<{
    title: string;
    description?: string;
    reminderTime: string;
    repeat?: string | null;
  }>;

  let remindersBlock = "";
  if (todayReminders.length > 0) {
    const lines = todayReminders.map((r) => {
      const time = r.reminderTime?.includes("T")
        ? r.reminderTime.split("T")[1]?.slice(0, 5)
        : r.reminderTime;
      return `  - "${r.title}" at ${time}${r.repeat ? ` (repeats ${r.repeat})` : ""}${r.description ? ` — ${r.description}` : ""}`;
    });
    remindersBlock = `\nACTIVE REMINDERS TODAY (user-set — do NOT schedule tasks that conflict with these time slots, and DO surface them if the user asks what's on their plate):\n${lines.join("\n")}`;
  }

  // Build goal plan tasks block (what's scheduled for today across all goals).
  // Each task includes its source_goal_id + source_plan_node_id so the LLM
  // can echo them back in the output and we can persist the link in the
  // daily_tasks row (enables TasksPage to show the goal badge and lets
  // toggle-task flow back up to the plan tree).
  let goalPlanTasksBlock = "";
  if (goalPlanSummaries.length > 0) {
    const lines = goalPlanSummaries.flatMap((g) => [
      `  Goal: "${g.goalTitle}" (${g.scope}) [goalId:${g.goalId ?? ""}]`,
      ...g.todayTasks.map(
        (t) =>
          `    - "${t.title}" (${t.durationMinutes}min, ${t.priority}, ${t.category}) [goalId:${t.goalId ?? ""}] [planNodeId:${t.planNodeId ?? ""}]: ${t.description}`,
      ),
    ]);
    goalPlanTasksBlock = `\nTASKS FROM GOAL PLANS (scheduled for today — SELECT from these; copy source_goal_id and source_plan_node_id verbatim for any task you pick from here):\n${lines.join("\n")}`;
  }

  // Build confirmed quick tasks block (user added via chat)
  let quickTasksBlock = "";
  if (confirmedQuickTasks.length > 0) {
    const lines = confirmedQuickTasks.map(
      (t) =>
        `  - "${t.title}" (weight: ${t.cognitiveWeight}, ${t.durationMinutes}min, ${t.priority})`,
    );
    quickTasksBlock = `\nCONFIRMED QUICK TASKS (user added today via chat — MUST include these):\n${lines.join("\n")}`;
  }

  // Build calendar events block
  let calendarBlock = "";
  if (todayCalendarEvents.length > 0) {
    const lines = todayCalendarEvents.map(
      (e) =>
        `  - "${e.title}" (${e.startDate} – ${e.endDate}, ${e.durationMinutes}min, ${e.category}${e.recurring ? `, recurring: ${e.recurring.frequency}` : ""})`,
    );
    calendarBlock = `\nCALENDAR EVENTS TODAY (account for these — reduce free time accordingly):\n${lines.join("\n")}`;
  }

  // Build everyday goals block
  let everydayBlock = "";
  if (everydayGoals.length > 0) {
    const lines = everydayGoals.flatMap((g) => [
      `  "${g.title}"${g.suggestedTimeSlot ? ` (suggested: ${g.suggestedTimeSlot})` : ""}`,
      ...g.tasks.map(
        (t) =>
          `    - "${t.title}" (${t.durationMinutes}min, ${t.priority})`,
      ),
    ]);
    everydayBlock = `\nEVERYDAY TASKS (one-off tasks to slot into the day — allocate a suitable time):\n${lines.join("\n")}`;
  }

  // Build repeating goals block
  let repeatingBlock = "";
  if (repeatingGoals.length > 0) {
    const lines = repeatingGoals.map(
      (g) =>
        `  - "${g.title}" (${g.durationMinutes}min${g.timeOfDay ? ` at ${g.timeOfDay}` : ""})`,
    );
    repeatingBlock = `\nREPEATING EVENTS TODAY (FIXED time blocks — schedule other tasks around these):\n${lines.join("\n")}`;
    // Reduce free minutes by repeating event durations
    const repeatingMinutes = repeatingGoals.reduce(
      (sum, g) => sum + g.durationMinutes,
      0,
    );
    todayFreeMinutes = Math.max(0, todayFreeMinutes - repeatingMinutes);
  }

  // Monthly context block
  let monthlyContextBlock = "";
  if (monthlyCtx) {
    monthlyContextBlock = `
MONTHLY CONTEXT (${currentMonth}):
  Intensity: ${monthlyCtx.intensity} (capacity multiplier: ${monthlyCtx.capacityMultiplier}x)
  Max daily tasks: ${monthlyCtx.maxDailyTasks}
  User's description: "${monthlyCtx.description}"
  → Adjust task count and difficulty accordingly. During "${monthlyCtx.intensity}" months, respect the max daily tasks limit of ${monthlyCtx.maxDailyTasks}.
`;
  }

  // Vacation mode
  let vacationBlock = "";
  if (isVacationDay) {
    vacationBlock = `\n*** VACATION MODE ACTIVE ***\nThe user is on vacation today. Do NOT assign any big goal tasks.\nOnly include: light everyday tasks (errands, reminders) and non-negotiable repeating events (classes).\nKeep the total to 1-2 tasks maximum. Make it restful.\n`;
  }

  // Inject scheduling context from the coordinator (if available)
  const schedulingContextFormatted =
    payload._schedulingContextFormatted ?? "";
  let schedulingBlock = "";
  if (schedulingContextFormatted) {
    schedulingBlock = `\n${schedulingContextFormatted}\n`;
  }

  // Inject environment context (time, location, GPS)
  const environmentFormatted =
    payload._environmentContextFormatted ?? "";
  let environmentBlock = "";
  if (environmentFormatted) {
    environmentBlock = `\n${environmentFormatted}\n`;
  }

  const handlerKind = "dailyTasks";
  const userId = getCurrentUserId();
  emitAgentProgress(userId, {
    agentId: handlerKind,
    phase: "running",
    message: "Generating today's tasks",
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parsed = await runStreamingHandler<any>({
    handlerKind,
    client,
    createRequest: () => ({
      model: getModelForTask("daily-tasks"),
      max_tokens: 2048,
      system: personalizeSystem(DAILY_TASKS_SYSTEM, memoryContext),
      messages: [
        {
          role: "user",
          content: `Today is ${date}. I have ${todayFreeMinutes} minutes available for goal work.
${environmentBlock}${monthlyContextBlock}${vacationBlock}${schedulingBlock}${capacityBlock}
  recommended_task_count: ${recommendedCount}
${calendarBlock}
${repeatingBlock}
${remindersBlock}
${goalPlanTasksBlock}
${everydayBlock}
${quickTasksBlock}

IMPORTANT REMINDERS:
- You MUST generate between 2 and 5 tasks. Not 6, not 10, not 15. Between 2 and 5.
- Total cognitive_weight across ALL tasks MUST be ≤ ${capacityProfile.capacityBudget}.
- Total duration MUST be ≤ ${Math.round(todayFreeMinutes * 0.8)} minutes (80% of available time).
- If there are CONFIRMED QUICK TASKS, include them in the count (they are pre-approved).
- If there are EVERYDAY TASKS, slot them into gaps — don't let them hang unfinished.
- REPEATING EVENTS are non-negotiable time blocks. Include them and schedule around them.${isVacationDay ? "\n- VACATION DAY: Only light everyday tasks and mandatory repeating events. No big goal work." : ""}
- If there are GOAL PLAN TASKS, select the most impactful ones for today.
- If the user has calendar events, schedule tasks around them (not during them).
- Sequence: momentum task first → hardest task → moderate → satisfying close.

CURRENT GOAL BREAKDOWN (general plan context):
${JSON.stringify(breakdown, null, 2)}

YESTERDAY'S LOG:
${yesterday ? JSON.stringify(yesterday, null, 2) : "None (first day)"}

EXECUTION HISTORY (recent 14 days):
${JSON.stringify(((heatmap as unknown[]) || []).slice(-14), null, 2)}

Generate EXACTLY ${recommendedCount.split(" ")[0]} core tasks for today. Include confirmed quick tasks in the count. Respect all constraints.`,
        },
      ],
    }),
    parseResult: (finalText) => {
      const cleaned = finalText
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();
      return JSON.parse(cleaned);
    },
  });

  emitAgentProgress(userId, { agentId: handlerKind, phase: "done" });

  // ── Post-processing guardrails ──
  // Hard limits enforced via shared/domain/cognitiveBudget so the renderer
  // and the AI pipeline always agree on the same policy.
  const rawTasks: Array<Record<string, unknown>> = parsed.tasks || [];
  const taskHardLimit =
    capacityProfile.maxDailyTasks ?? COGNITIVE_BUDGET.MAX_DAILY_TASKS;
  const coreTasks = enforceBudgetSnake(
    rawTasks as Array<Record<string, unknown>> & {
      cognitive_weight?: number;
      duration_minutes?: number;
      priority?: string;
    }[],
    taskHardLimit,
    capacityProfile.capacityBudget,
  ) as Array<Record<string, unknown>>;
  if (rawTasks.length !== coreTasks.length) {
    console.warn(
      `[NorthStar] AI returned ${rawTasks.length} tasks — trimmed to ${coreTasks.length} via cognitive budget`,
    );
  }

  // Map bonus_task separately (only if within bonus grace)
  const totalWeight = coreTasks.reduce(
    (sum, t) =>
      sum + ((t.cognitive_weight as number) ?? COGNITIVE_BUDGET.DEFAULT_WEIGHT),
    0,
  );
  const allTasks = [...coreTasks];
  if (parsed.bonus_task) {
    const bonusWeight = (parsed.bonus_task.cognitive_weight as number) || 2;
    if (bonusTaskFits(totalWeight, bonusWeight, capacityProfile.capacityBudget)) {
      allTasks.push({ ...parsed.bonus_task, priority: "bonus" });
    }
  }

  return {
    id: `log-${date}`,
    userId: "local",
    date: parsed.date || date,
    tasks: allTasks.map((t: Record<string, unknown>) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      durationMinutes: t.duration_minutes,
      cognitiveWeight: t.cognitive_weight || 3,
      whyToday: t.why_today,
      priority: t.priority,
      isMomentumTask: t.is_momentum_task || false,
      progressContribution: t.progress_contribution || "",
      category: t.category,
      // source_* fields link a selected task back to its origin in the
      // goal plan tree so daily_tasks can persist goal_id / plan_node_id.
      // Null when the task came from adaptive reasoning, not a plan node.
      goalId:
        (typeof t.source_goal_id === "string" && t.source_goal_id) ||
        null,
      planNodeId:
        (typeof t.source_plan_node_id === "string" && t.source_plan_node_id) ||
        null,
      completed: false,
    })),
    heatmapEntry: parsed.heatmap_entry
      ? {
          date: parsed.heatmap_entry.date,
          completionLevel: parsed.heatmap_entry.completion_level,
          currentStreak: parsed.heatmap_entry.current_streak,
          totalActiveDays: parsed.heatmap_entry.total_active_days,
          longestStreak: parsed.heatmap_entry.longest_streak,
        }
      : {
          date,
          completionLevel: 0,
          currentStreak: 0,
          totalActiveDays: 0,
          longestStreak: 0,
        },
    notificationBriefing: parsed.notification_briefing || "",
    adaptiveReasoning: parsed.adaptive_reasoning || "",
    milestoneCelebration: parsed.milestone_celebration || null,
    progress: parsed.progress
      ? {
          overallPercent: parsed.progress.overall_percent || 0,
          milestonePercent: parsed.progress.milestone_percent || 0,
          currentMilestone:
            parsed.progress.current_month_focus ||
            parsed.progress.current_milestone ||
            "",
          projectedCompletion: parsed.progress.projected_completion || "",
          daysAheadOrBehind: parsed.progress.days_ahead_or_behind || 0,
        }
      : {
          overallPercent: 0,
          milestonePercent: 0,
          currentMilestone: "",
          projectedCompletion: "",
          daysAheadOrBehind: 0,
        },
    yesterdayRecap: parsed.yesterday_recap || null,
    encouragement: parsed.encouragement || "",
    createdAt: new Date().toISOString(),
  };
}
