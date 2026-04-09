/* NorthStar - AI handler (Electron main process) */

import Anthropic from "@anthropic-ai/sdk";
import { getScheduleContext, summarizeScheduleForAI } from "./calendar";
import { loadMemory, buildMemoryContext, computeCapacityProfile } from "./memory";
import type { MemoryStore } from "./memory";
import { quickReflect, runReflection, captureSessionStart } from "./reflection";
import { coordinateRequest } from "./agents/coordinator";
import type { CoordinatorTaskType, ProgressCallback } from "./agents/types";
import { getMonthlyContext } from "./database";
import { getModelForTask } from "./model-config";

export type RequestType =
  | "onboarding"
  | "goal-breakdown"
  | "reallocate"
  | "daily-tasks"
  | "recovery"
  | "pace-check"
  | "classify-goal"
  | "goal-plan-chat"
  | "goal-plan-edit"
  | "generate-goal-plan"
  | "analyze-quick-task"
  | "analyze-monthly-context"
  | "home-chat";

function getClient(
  loadData: () => Record<string, unknown>
): Anthropic | null {
  // Prefer the key the user saved in Settings/Onboarding over any env var.
  // This prevents a stale .env key from silently overriding the user's choice.
  let apiKey: string | undefined;
  const data = loadData();
  const user = data.user as Record<string, unknown> | undefined;
  const settings = user?.settings as Record<string, unknown> | undefined;
  apiKey = settings?.apiKey as string | undefined;

  if (apiKey) {
    console.log("[ai-handler] API key from user settings:", `${apiKey.substring(0, 10)}...`);
  } else {
    apiKey = process.env.ANTHROPIC_API_KEY || undefined;
    if (apiKey) {
      console.log("[ai-handler] API key from env variable");
    }
  }

  if (!apiKey) {
    console.log("[ai-handler] No API key found");
    return null;
  }
  return new Anthropic({ apiKey });
}

const ONBOARDING_SYSTEM = `You are NorthStar, a thoughtful goal coach. The user has come to you
with a rough goal. Your job is to have a natural conversation to understand
what they really want, so you can build them a realistic plan.

CONVERSATION STYLE:
- Talk like a real coach, not a form. Never present numbered question lists.
- Ask ONE question or follow-up at a time.
- Weave your questions naturally.
- Show that you're listening: reference specific things they've said.

INFORMATION YOU NEED (gather naturally over 3-5 turns):
- What specifically "done" looks like for this goal
- Current relevant skills and experience
- Real constraints: time, money, obligations
- Whether there's a hard deadline or flexible timeline
- What's driving them - the emotional WHY

WHEN YOU HAVE ENOUGH INFORMATION:
Summarize in this structured format and ask for confirmation:

Goal: [one-sentence concrete goal]
Starting point: [current skills/experience]
Target outcome: [specific, measurable definition of "done"]
Timeline: [target date or duration]
Time budget: [realistic daily/weekly hours]
Constraints: [budget, obligations, upcoming time off]
Motivation: [in their words]

End with: "Does this feel right? If so, I'll break this down into a complete plan."`;

const GOAL_BREAKDOWN_SYSTEM = `You are NorthStar, an expert goal decomposition AI. Your specialty
is breaking big goals into a hierarchy: Years -> Months -> Weeks -> Days.

You will receive:
1. The user's clarified goal (what, timeline, constraints, motivation)
2. Their REAL CALENDAR DATA showing busy/free time, vacations, heavy days
3. Today's date

YOUR JOB - INTELLIGENT HIERARCHICAL BREAKDOWN:

STEP 1 - REASONING (think step-by-step):
- How many total hours does this goal realistically need?
- Given their calendar, how many productive hours per week can they commit?
- Account for vacations, heavy days, weekends
- Add 20% buffer for life interruptions
- Work backwards from the target date

STEP 2 - YEAR LEVEL:
- Define yearly themes if the goal spans 1+ years
- Each year has a clear outcome

STEP 3 - MONTH LEVEL:
- Each month has 2-4 concrete objectives
- Show WHAT and WHY this month matters for the bigger goal
- Adjust intensity around vacations/busy periods

STEP 4 - WEEK LEVEL:
- Each week has a clear focus + 3-5 key deliverables
- Lighter weeks around busy calendar days
- Heavier weeks when calendar is free

STEP 5 - DAY LEVEL (next 14 days only):
- Specific actions with durations
- Scheduled around the user's ACTUAL free time per day
- No tasks on vacation days
- Lighter tasks on heavy calendar days
- Each task explains WHY today

CRITICAL RULES:
1. RESPECT THE CALENDAR - if they have 2 hours free, don't schedule 4 hours of work
2. ZERO TASKS ON VACATION DAYS - just mark them as rest
3. FRONT-LOAD MOMENTUM - easy wins in week 1
4. EXPLAIN REASONING at every level
5. Every day's tasks should sum to <= the free time available that day
6. Be conservative - missing deadlines kills motivation

OUTPUT FORMAT - valid JSON, NO markdown fences:
{
  "goal_summary": "...",
  "total_estimated_hours": 100,
  "projected_completion": "YYYY-MM-DD",
  "confidence_level": "high",
  "reasoning": "Multi-paragraph explanation of your planning logic.",
  "yearly_breakdown": [
    {
      "year": 2026,
      "theme": "...",
      "outcome": "...",
      "months": [
        {
          "month": "2026-04",
          "label": "April 2026",
          "focus": "...",
          "objectives": ["...", "..."],
          "reasoning": "Why this focus this month",
          "adjusted_for": null,
          "estimated_hours": 20,
          "weeks": [
            {
              "week_number": 1,
              "start_date": "2026-04-07",
              "end_date": "2026-04-13",
              "focus": "...",
              "deliverables": ["...", "..."],
              "estimated_hours": 5,
              "intensity": "normal",
              "days": [
                {
                  "date": "2026-04-07",
                  "day_name": "Monday",
                  "available_minutes": 120,
                  "is_vacation": false,
                  "is_weekend": false,
                  "tasks": [
                    {
                      "title": "...",
                      "description": "...",
                      "duration_minutes": 30,
                      "category": "learning",
                      "why_today": "...",
                      "priority": "must-do"
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}

IMPORTANT:
- Only include detailed daily tasks for the NEXT 14 DAYS
- For weeks beyond 14 days, include week-level focus + deliverables only (no daily tasks)
- For months beyond the current month +1, include month-level focus + objectives only (no weekly detail)
- Return ONLY valid JSON`;

const REALLOCATE_SYSTEM = `You are NorthStar, a schedule reallocation AI. The user's schedule
has changed (vacation added, busy period, sick days, or they're ahead/behind).

You receive:
1. The current goal breakdown
2. Updated calendar data showing the new schedule
3. What changed (reason for reallocation)

YOUR JOB:
- Identify which tasks/milestones are affected by the schedule change
- Redistribute work to available days
- NEVER cram - if there's less time, extend the timeline or reduce scope
- Preserve the goal hierarchy (years->months->weeks->days)
- Show what moved and why

OUTPUT - same JSON structure as goal-breakdown but with an additional field:
{
  "reallocation_summary": {
    "reason": "...",
    "days_affected": 5,
    "tasks_moved": 8,
    "timeline_impact": "Extended by 3 days",
    "key_changes": ["...", "..."]
  },
  "goal_summary": "...",
  "total_estimated_hours": 100,
  "projected_completion": "YYYY-MM-DD",
  "confidence_level": "medium",
  "reasoning": "...",
  "yearly_breakdown": []
}

Return ONLY valid JSON, no markdown fences.`;

const DAILY_TASKS_SYSTEM = `You are NorthStar, an intelligent daily planning assistant that generates
the COMPLETE daily task list for a user. YOU are the ONLY source of tasks for the day.
Your job is to select which tasks from the user's goal plan(s) should be done today,
sequence them intelligently, and generate a psychologically optimal task list.

═══ FOUNDATIONAL PSYCHOLOGICAL PRINCIPLES ═══

These are research-backed rules that govern EVERYTHING about your output.
Violating these will cause real harm to the user's productivity and well-being.

1. THE 3-5 RULE (Miller's Law + Productivity Research)
   George Miller's research shows working memory holds 7±2 items, but for actionable
   tasks, the effective limit is 3-5. Apps like Amazing Marvin and research from
   Cal Newport confirm: most people accomplish 3 to 5 meaningful tasks per day.
   → Default to 3-4 tasks for a new user. NEVER exceed 5 core tasks (+ 1 optional bonus).

2. THE 3-HOUR CEILING (Deep Work Capacity)
   Anders Ericsson's research on deliberate practice shows peak performers sustain
   ~4 hours of deep work. Average knowledge workers: ~2.5-3 hours. Beyond this,
   quality drops sharply (diminishing returns, not linear decay).
   → High-concentration tasks should total ≤ 180 minutes.
   → Shallow/admin tasks are separate and don't count toward this ceiling.

3. COGNITIVE LOAD BUDGET (Sweller's Cognitive Load Theory)
   Not all tasks are equal. One "Write a thesis chapter" ≠ five "Reply to email" tasks.
   Every task gets a weight score reflecting its true cognitive demand:
   - 1 = Trivial (send an email, make a call, quick review) ≤ 10 min
   - 2 = Light (read an article, organize notes, short meeting) 10-20 min
   - 3 = Moderate (write a summary, practice a skill, research) 20-45 min
   - 4 = Heavy (deep analysis, creative work, long study session) 45-90 min
   - 5 = Intense (write a proposal, build a prototype, exam prep) 90+ min
   → Total daily weight budget is a HARD MAXIMUM of 12 points.
   → New users start at 10. The system adjusts based on behavioral data.

4. DECISION FATIGUE (Baumeister's Ego Depletion Research)
   Every decision depletes willpower. A long task list itself causes paralysis.
   → Fewer tasks = more likely to start. This is the #1 productivity insight.
   → Present tasks as a curated shortlist, not a dump of everything.

5. THE ZEIGARNIK EFFECT (Incomplete Task Memory)
   Unfinished tasks occupy mental bandwidth. A list of 15 tasks creates 15
   open loops in the brain, causing anxiety and reducing focus on ANY single task.
   → Keep the active list short. Move non-essential tasks to "upcoming" not "today."

6. ULTRADIAN RHYTHMS (90-Minute Focus Cycles)
   The brain operates in ~90-minute high/low energy cycles. After 90 min of focus,
   performance drops significantly until a 15-20 min break.
   → No single task should exceed 90 minutes without a break point.
   → If a task is 90+ min, break it into two parts with a natural stopping point.

7. THE PROGRESS PRINCIPLE (Amabile & Kramer, Harvard)
   The single greatest motivator is making visible progress on meaningful work.
   Small wins compound psychologically and build momentum.
   → Include one "momentum task" (weight 1-2, ≤ 10 min) to start the day.
   → This creates a psychological "open loop" that drives the user to continue.

8. IMPLEMENTATION INTENTIONS (Gollwitzer's Research)
   Vague intentions ("study more") fail. Specific plans ("At 9am, read Ch.3
   for 30 min") succeed 2-3x more often.
   → Every task needs a clear, specific description and a "why_today" rationale.

9. PEAK-END RULE (Kahneman)
   People judge experiences by their peak moment and how they end.
   → Sequence tasks to end on a satisfying note (not the hardest task last).
   → The ideal sequence: momentum task → hardest task → moderate → satisfying close.

10. AUTONOMY & SELF-DETERMINATION (Deci & Ryan)
    People resist externally imposed overload. They need to feel in control.
    → Present the list as a recommendation, not a demand.
    → The "bonus task" is optional and framed as an opportunity, not an obligation.

═══ THREE GOAL TYPE INTEGRATION ═══

The user has THREE types of goals that must all appear in today's task list:

1. BIG GOALS: Long-term structured plans. Select today's tasks from the hierarchical
   plan (year→month→week→day). These are the core of the day.
2. EVERYDAY GOALS: One-off tasks, errands, reminders. The AI allocates a suitable time
   slot for these. Break them down if they're vague. Don't let them just hang there —
   give them a specific slot in the day.
3. REPEATING GOALS: Classes, meetings, recurring events. These are FIXED TIME BLOCKS.
   Schedule other tasks AROUND them. They reduce available free time.

INTEGRATION RULES:
- Repeating events are non-negotiable time blocks. Subtract their time from available minutes.
- Everyday tasks should be slotted into gaps between bigger tasks as "transition tasks."
- Big goal tasks form the core focus of the day.
- If the user is on VACATION (vacation_mode is active), only show light everyday tasks
  and repeating obligations. No big goal tasks.

═══ TASK GENERATION RULES ═══

1. SELECT tasks from the goal breakdown for today's date. You are choosing FROM the
   plan — these ARE the user's daily tasks. Do not create tasks unrelated to goals.
   Also include any everyday goals and repeating events scheduled for today.
2. Assign cognitive_weight (1-5) to EVERY task based on complexity AND novelty.
   Novel tasks are harder than familiar ones (even if duration is similar).
3. Total cognitive_weight MUST NOT exceed the user's capacity_budget (provided in
   the user message — defaults to 10 if not specified).
4. Total task time MUST NOT exceed available free minutes.
5. Every task gets a "why_today" connecting to the bigger goal (implementation intention).
6. If yesterday had missed tasks, fold in ONLY the most critical one (not all).
   The rest should roll to tomorrow. Do NOT guilt-load today.
7. Mark exactly ONE task as "if you do only one thing" (the highest-impact task).
8. Include ONE momentum task (weight 1-2, ≤ 10 min) to build a psychological win.
9. ALWAYS leave buffer — plan for 70-80% of available time, not 100%.
   Parkinson's Law: work expands to fill available time. Buffer prevents burnout.
10. Sequence tasks using the Peak-End Rule: easy start → hardest → moderate → satisfying end.
11. If a task from the plan is > 90 min, SPLIT IT into two sub-tasks with a natural break.
12. NEVER generate more than 5 core tasks. This is a hard limit. Even if the goal plan
    has 20 tasks for today, YOU decide which 3-5 are most important TODAY.

═══ ADAPTIVE CAPACITY (Historical Completion Loop) ═══

The user message includes a "CAPACITY PROFILE" with their behavioral stats.
This is your feedback loop. Use it to calibrate task count and weight:

- capacity_budget: Maximum cognitive weight points for today. RESPECT THIS NUMBER.
  It is already adjusted by the system based on the user's real completion data.

- recent_completion_rate:
  • Below 40%: CRISIS. Give 2 tasks max (weight 1-2 each). The user is overwhelmed.
    Focus on rebuilding confidence. One should be trivially completable.
  • 40-60%: STRUGGLING. Give 2-3 tasks, total weight ≤ 7. Prioritize momentum wins.
  • 60-75%: BUILDING. Give 3-4 tasks, total weight ≤ 9. Steady progress zone.
  • 75-85%: HEALTHY. Give 3-5 tasks, use the full capacity_budget. Optimal zone.
  • 85-95%: STRONG. Give 3-5 tasks + ONE optional bonus_task. They have spare capacity.
  • Above 95%: EXCEPTIONAL. Full budget + bonus. But watch for burnout signals.

- If they chronically snooze certain task types → those tasks cost +1 weight (resistance).
- If they consistently finish early → they're underestimating. Increase task ambition.
- If they consistently run over time → decrease estimated durations by 15-20%.
- Day-of-week patterns: weak days get -1 to -2 weight points from budget.
- Trend "declining" → prioritize wins over progress. Give easier tasks.
- Trend "improving" → lean into momentum. Slightly increase ambition.
- overwhelm_days > 2 in last 14 days → reduce to 3 tasks, max weight 8.

═══ EVENING PRE-GENERATION ═══

When the date is TOMORROW (called at night), generate tasks for the next day.
Frame encouragement as "here's what's waiting for you tomorrow."

OUTPUT FORMAT (JSON):
{
  "date": "YYYY-MM-DD",
  "available_minutes": 120,
  "total_cognitive_weight": 9,
  "capacity_budget_used": 9,
  "notification_briefing": "... (under 80 chars, motivating)",
  "adaptive_reasoning": "Brief explanation of WHY this many tasks and this weight — reference the psychological principle and the user's data that led to this decision",
  "is_vacation_day": false,
  "progress": {
    "overall_percent": 15,
    "current_month_focus": "...",
    "current_week_focus": "...",
    "days_ahead_or_behind": 0
  },
  "tasks": [
    {
      "id": "t-YYYYMMDD-1",
      "title": "...",
      "description": "...",
      "duration_minutes": 30,
      "cognitive_weight": 3,
      "why_today": "...",
      "priority": "must-do",
      "is_momentum_task": false,
      "category": "learning"
    }
  ],
  "bonus_task": null,
  "one_thing": "t-YYYYMMDD-1",
  "encouragement": "...",
  "heatmap_entry": {
    "date": "YYYY-MM-DD",
    "completion_level": 0,
    "current_streak": 1,
    "total_active_days": 1,
    "longest_streak": 1
  }
}

HARD CONSTRAINTS (violating any of these is a failure):
- tasks array MUST have 2-5 items. NEVER more than 5 core tasks. NEVER.
- bonus_task is a single optional task (or null), only when completion rate > 85%.
- Sum of all cognitive_weight values MUST be ≤ capacity_budget.
- Sum of all duration_minutes MUST be ≤ available_minutes × 0.8.
- If the goal plan has many tasks for today, YOU prioritize. Quality over quantity.
- Return ONLY valid JSON, no markdown fences.`;

const RECOVERY_SYSTEM = `You are NorthStar, a recovery and adjustment assistant. The user missed
tasks. Understand WHY and adjust. NEVER use guilt language.

Based on the blocker, respond with:
{
  "blocker_acknowledged": "...",
  "timeline_impact": "...",
  "adjustment": {
    "strategy": "...",
    "tomorrow_changes": [
      { "original_task": "...", "adjusted_task": "...", "reason": "..." }
    ],
    "week_changes": "..."
  },
  "forward_note": "..."
}

Return ONLY valid JSON, no markdown fences.`;

const PACE_CHECK_SYSTEM = `You are NorthStar. Review the user's progress and check in.

OUTPUT FORMAT (JSON):
{
  "week_summary": {
    "tasks_completed": 10, "tasks_total": 14, "completion_rate": "71%",
    "strongest_category": "learning", "highlight": "..."
  },
  "observations": ["..."],
  "pace_question": "...",
  "suggested_adjustments": [
    { "option": "...", "what_changes": "...", "timeline_impact": "..." }
  ],
  "closing": "..."
}

Return ONLY valid JSON, no markdown fences.`;

const ANALYZE_QUICK_TASK_SYSTEM = `You are NorthStar, a smart task analysis assistant integrated with
the central coordinator. The user has typed a quick task or errand via the home chat.
Your job is to analyze it with FULL AWARENESS of their current cognitive load,
calendar schedule, and capacity budget.

You will receive:
1. The user's raw text input
2. Their existing tasks for today (with cognitive weights and time used)
3. Their remaining cognitive budget and free time
4. Their calendar events for today
5. Their goals (for context)

═══ ANALYSIS PRINCIPLES ═══

You apply the same psychological principles as the daily task engine:
- COGNITIVE LOAD BUDGET: Max 12 points/day. Check remaining budget before suggesting today.
- 3-HOUR CEILING: If they already have 3+ hours of deep work, DO NOT add more today.
- DECISION FATIGUE: If they already have 5+ tasks, suggest tomorrow instead.
- CALENDAR AWARENESS: Don't schedule around existing calendar events.
- ZEIGARNIK EFFECT: Adding too many open items hurts focus. Be conservative.

DECISION LOGIC:
1. If remaining_budget >= task_weight AND remaining_time >= task_duration → suggest TODAY
2. If remaining_budget < task_weight → suggest TOMORROW, explain budget is full
3. If task is URGENT (deadline today, time-sensitive) → suggest TODAY but WARN about overload
4. If user already has 5+ tasks → suggest TOMORROW unless urgent

IMPORTANT: The "description" field must be 1-2 sentences MAX. Be ultra-concise.
Do NOT write a paragraph. Think of it as a calendar entry subtitle, not an essay.

OUTPUT FORMAT (JSON):
{
  "title": "...",
  "description": "One to two sentences only. Brief and actionable.",
  "suggested_date": "YYYY-MM-DD",
  "duration_minutes": 30,
  "cognitive_weight": 2,
  "priority": "should-do",
  "category": "building",
  "reasoning": "Why this date/duration/weight was chosen — reference budget and calendar",
  "conflicts_with_existing": ["task title that might conflict"]
}

Return ONLY valid JSON, no markdown fences.`;

const HOME_CHAT_SYSTEM = `You are NorthStar (北极星), a friendly and helpful productivity assistant
integrated with the central coordinator. You have access to the user's complete context:
goals, today's tasks with cognitive load, and calendar schedule.

The user is chatting with you on their home page. They might:
1. Ask questions about their goals, progress, or schedule
2. Add a quick task (e.g. "remind me to buy groceries", "I need to call the dentist")
3. Ask for advice or motivation
4. Discuss their day, energy level, or blockers

DETECTION RULES:
- If the user is clearly adding a task or errand, respond with a JSON block:
  {"is_task": true, "task_description": "the task they want to add"}
- If the user mentions a significant context change (schedule shift, new deadline, cancelled plans,
  energy change, illness, unexpected free time, etc.), respond with:
  {"context_change": true, "summary": "brief description of what changed", "suggestion": "what you recommend — e.g., regenerate today's tasks, update monthly context, reduce load"}
  Then add a natural follow-up message after the JSON explaining what you suggest.
- For everything else, respond naturally as a coach. Be concise, warm, and actionable.
- Reference their goals, progress, and cognitive load when relevant.
- If they seem overwhelmed (many tasks, low completion), proactively suggest reducing load.
- Keep responses under 150 words unless they ask for detail.

CONTEXT AWARENESS:
- You can see their cognitive load (X/12 points used) — mention it if they're adding tasks
- You can see their calendar — suggest scheduling around busy periods
- You can see completion status — celebrate wins, gently address missed tasks
- If they mention feeling overwhelmed, acknowledge it and suggest concrete actions
- If the monthly context has changed (e.g., "exams are over" when the month is set to "intense"),
  suggest updating it

When responding conversationally (not a task), just reply naturally.
When it's a task, respond ONLY with the JSON object, nothing else.
When it's a context change, respond with the JSON object followed by your recommendation.`;

// Main handler — routes through coordinator for agent-enabled requests
export async function handleAIRequest(
  type: RequestType,
  payload: Record<string, unknown>,
  loadData: () => Record<string, unknown>,
  onProgress?: ProgressCallback
): Promise<unknown> {
  const client = getClient(loadData);
  if (!client) {
    throw new Error(
      "No API key found. Please set your Claude API key in Settings."
    );
  }

  // Route through coordinator for tasks that benefit from multi-agent orchestration
  // ALL task types go through the coordinator for proper memory context and capacity awareness
  const coordinatorRouted: CoordinatorTaskType[] = [
    "generate-goal-plan",
    "goal-plan-chat",
    "goal-plan-edit",
    "daily-tasks",
    "goal-breakdown",
    "reallocate",
    "classify-goal",
    "recovery",
    "pace-check",
    "onboarding",
    "analyze-quick-task",
    "analyze-monthly-context",
    "home-chat",
  ];

  if (coordinatorRouted.includes(type as CoordinatorTaskType)) {
    const result = await coordinateRequest(
      client,
      type as CoordinatorTaskType,
      payload,
      loadData,
      onProgress
    );

    if (!result.success) {
      const detail = result.error || "Unknown error";
      console.error(`[ai-handler] AI request "${type}" failed:`, detail);
      throw new Error(`AI request failed: ${detail}`);
    }

    return result.data;
  }

  // Fallback: direct handling for any unrecognized types
  const memory = loadMemory();
  const contextType: "planning" | "daily" | "recovery" | "general" = "general";
  const now = new Date();
  const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const currentDay = dayNames[now.getDay()];
  const currentHour = now.getHours();
  const timeSlot = currentHour < 12 ? "morning" : currentHour < 17 ? "afternoon" : "evening";
  const contextTags = [currentDay, timeSlot];
  const memoryContext = buildMemoryContext(memory, contextType, contextTags);

  return handleAIRequestDirect(type, payload, memoryContext, client);
}

/**
 * Direct handler — executes a specific AI request without coordinator overhead.
 * Called by the coordinator after it has done research/preprocessing.
 * Also used as fallback for non-coordinator-routed requests.
 */
export async function handleAIRequestDirect(
  type: RequestType,
  payload: Record<string, unknown>,
  memoryContext: string,
  client: Anthropic
): Promise<unknown> {
  switch (type) {
    case "onboarding":
      return handleOnboarding(client, payload, memoryContext);
    case "goal-breakdown":
      return handleGoalBreakdown(client, payload, memoryContext);
    case "reallocate":
      return handleReallocate(client, payload, memoryContext);
    case "daily-tasks":
      return handleDailyTasks(client, payload, memoryContext);
    case "recovery":
      return handleRecovery(client, payload, memoryContext);
    case "pace-check":
      return handlePaceCheck(client, payload, memoryContext);
    case "classify-goal":
      return handleClassifyGoal(client, payload, memoryContext);
    case "goal-plan-chat":
      return handleGoalPlanChat(client, payload, memoryContext);
    case "goal-plan-edit":
      return handleGoalPlanEdit(client, payload, memoryContext);
    case "generate-goal-plan":
      return handleGenerateGoalPlan(client, payload, memoryContext);
    case "analyze-quick-task":
      return handleAnalyzeQuickTask(client, payload, memoryContext);
    case "analyze-monthly-context":
      return handleAnalyzeMonthlyContext(client, payload, memoryContext);
    case "home-chat":
      return handleHomeChat(client, payload, memoryContext);
  }
}

// ── Memory-aware wrappers ───────────────────────────────

/**
 * Inject memory context into a system prompt.
 *
 * The memory block is placed AFTER the base instructions so that Claude
 * treats it as grounding context, not as something to override.
 * The format follows the "micro-adjustment injection" pattern:
 *   Base System Prompt
 *   + Current User Preferences (from long-term memory)
 *   + Feedback Updates (timestamped recent learnings)
 *   + Behavioral Patterns (day/hour analysis)
 *   + Active Constraints (snooze alerts, calibrations)
 *   + Context-Specific Directive (what to do with this info)
 */
function personalizeSystem(baseSystem: string, memoryContext: string): string {
  if (!memoryContext) return baseSystem;
  return `${baseSystem}\n\n${memoryContext}`;
}

// Onboarding (multi-turn conversation)
async function handleOnboarding(
  client: Anthropic,
  payload: Record<string, unknown>,
  memoryContext: string
): Promise<string> {
  const messages = (
    payload.messages as Array<{ role: string; content: string }>
  ).map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  messages.push({ role: "user", content: payload.userInput as string });

  const response = await client.messages.create({
    model: getModelForTask("onboarding"),
    max_tokens: 1024,
    system: personalizeSystem(ONBOARDING_SYSTEM, memoryContext),
    messages,
  });

  const block = response.content[0];
  return block.type === "text" ? block.text : "";
}

// Goal Breakdown (the main feature)
async function handleGoalBreakdown(
  client: Anthropic,
  payload: Record<string, unknown>,
  memoryContext: string
): Promise<unknown> {
  const goal = payload.goal;
  const targetDate = (payload.targetDate as string) || "";
  const dailyHours = (payload.dailyHours as number) || 2;
  const inAppEvents = (payload.inAppEvents || []) as unknown[];
  const deviceIntegrations = payload.deviceIntegrations as { calendar?: { enabled: boolean; selectedCalendars: string[] } } | undefined;

  const today = new Date();
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() + 90);

  let scheduleInfo = "No calendar events found. User has not added any events to their calendar yet.";
  try {
    const schedule = await getScheduleContext(
      today.toISOString().split("T")[0],
      endDate.toISOString().split("T")[0],
      inAppEvents as any,
      deviceIntegrations
    );
    if (schedule.days.some((d) => d.events.length > 0)) {
      scheduleInfo = summarizeScheduleForAI(schedule);
    }
  } catch {
    console.warn("Calendar schedule build failed");
  }

  const response = await client.messages.create({
    model: getModelForTask("goal-breakdown"),
    max_tokens: 16384,
    system: personalizeSystem(GOAL_BREAKDOWN_SYSTEM, memoryContext),
    messages: [
      {
        role: "user",
        content: `TODAY'S DATE: ${today.toISOString().split("T")[0]}

MY GOAL:
${JSON.stringify(goal, null, 2)}

TARGET COMPLETION: ${targetDate || "flexible - suggest a realistic date"}
DAILY TIME BUDGET: ${dailyHours} hours/day

${scheduleInfo}

Please break down my goal into a complete hierarchical plan (years -> months -> weeks -> days).
Respect my calendar - no tasks on vacation days, lighter tasks on busy days.`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const parsed = JSON.parse(cleaned);

  return {
    id: `breakdown-${Date.now()}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: 1,
    ...parsed,
  };
}

// Reallocation
async function handleReallocate(
  client: Anthropic,
  payload: Record<string, unknown>,
  memoryContext: string
): Promise<unknown> {
  const currentBreakdown = payload.breakdown;
  const reason = (payload.reason as string) || "Schedule changed";
  const changes = payload.changes || {};
  const inAppEvents = (payload.inAppEvents || []) as unknown[];
  const deviceIntegrations = payload.deviceIntegrations as { calendar?: { enabled: boolean; selectedCalendars: string[] } } | undefined;

  const today = new Date();
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() + 90);

  let scheduleInfo = "No calendar events available.";
  try {
    const schedule = await getScheduleContext(
      today.toISOString().split("T")[0],
      endDate.toISOString().split("T")[0],
      inAppEvents as any,
      deviceIntegrations
    );
    scheduleInfo = summarizeScheduleForAI(schedule);
  } catch {
    console.warn("Calendar schedule build failed");
  }

  const response = await client.messages.create({
    model: getModelForTask("reallocate"),
    max_tokens: 16384,
    system: personalizeSystem(REALLOCATE_SYSTEM, memoryContext),
    messages: [
      {
        role: "user",
        content: `TODAY: ${today.toISOString().split("T")[0]}

REASON FOR REALLOCATION: ${reason}

SCHEDULE CHANGES:
${JSON.stringify(changes, null, 2)}

CURRENT GOAL BREAKDOWN:
${JSON.stringify(currentBreakdown, null, 2)}

UPDATED CALENDAR:
${scheduleInfo}

Please reallocate my plan around these changes.`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const parsed = JSON.parse(cleaned);

  return {
    ...parsed,
    id: (currentBreakdown as Record<string, unknown>)?.id || `breakdown-${Date.now()}`,
    updatedAt: new Date().toISOString(),
    version: ((currentBreakdown as Record<string, unknown>)?.version as number || 0) + 1,
  };
}

// Daily Tasks
async function handleDailyTasks(
  client: Anthropic,
  payload: Record<string, unknown>,
  memoryContext: string
): Promise<unknown> {
  const breakdown = payload.breakdown || payload.roadmap;
  const pastLogs = payload.pastLogs as Array<Record<string, unknown>>;
  const date = payload.date as string;
  const heatmap = payload.heatmap;
  const inAppEvents = (payload.inAppEvents || []) as unknown[];
  const deviceIntegrations = payload.deviceIntegrations as { calendar?: { enabled: boolean; selectedCalendars: string[] } } | undefined;

  let todayFreeMinutes = 120;
  try {
    const schedule = await getScheduleContext(date, date, inAppEvents as any, deviceIntegrations);
    if (schedule.days.length > 0) {
      todayFreeMinutes = Math.min(schedule.days[0].freeMinutes, 240);
    }
  } catch {
    // no calendar data
  }

  const yesterday =
    pastLogs && pastLogs.length > 0 ? pastLogs[pastLogs.length - 1] : null;

  // ── Compute capacity profile from behavioral history ──
  const memory = loadMemory();
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
  let monthlyCtx: { capacityMultiplier: number; maxDailyTasks: number; intensity: string; description: string } | null = null;
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
  } catch { /* no monthly context */ }

  const capacityProfile = computeCapacityProfile(memory, logsForCapacity, todayDayOfWeek, monthlyCtx);

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
  const goalPlanSummaries = (payload.goalPlanSummaries || []) as Array<{
    goalTitle: string; scope: string; goalType?: string; status: string;
    todayTasks: Array<{ title: string; description: string; durationMinutes: number; priority: string; category: string }>;
  }>;
  const confirmedQuickTasks = (payload.confirmedQuickTasks || []) as Array<{
    title: string; description: string; durationMinutes: number; cognitiveWeight: number; priority: string; category: string;
  }>;
  const todayCalendarEvents = (payload.todayCalendarEvents || []) as Array<{
    title: string; startDate: string; endDate: string; durationMinutes: number; category: string; isAllDay: boolean; recurring?: { frequency: string };
  }>;
  const everydayGoals = (payload.everydayGoals || []) as Array<{
    title: string; description: string; suggestedTimeSlot: string | null;
    tasks: Array<{ title: string; description: string; durationMinutes: number; priority: string; category: string }>;
  }>;
  const repeatingGoals = (payload.repeatingGoals || []) as Array<{
    title: string; timeOfDay: string | null; durationMinutes: number; frequency: string;
  }>;
  const isVacationDay = !!payload.isVacationDay;

  // Build goal plan tasks block (what's scheduled for today across all goals)
  let goalPlanTasksBlock = "";
  if (goalPlanSummaries.length > 0) {
    const lines = goalPlanSummaries.flatMap((g) => [
      `  Goal: "${g.goalTitle}" (${g.scope})`,
      ...g.todayTasks.map((t) => `    - "${t.title}" (${t.durationMinutes}min, ${t.priority}, ${t.category}): ${t.description}`),
    ]);
    goalPlanTasksBlock = `\nTASKS FROM GOAL PLANS (scheduled for today — SELECT from these):\n${lines.join("\n")}`;
  }

  // Build confirmed quick tasks block (user added via chat)
  let quickTasksBlock = "";
  if (confirmedQuickTasks.length > 0) {
    const lines = confirmedQuickTasks.map((t) => `  - "${t.title}" (weight: ${t.cognitiveWeight}, ${t.durationMinutes}min, ${t.priority})`);
    quickTasksBlock = `\nCONFIRMED QUICK TASKS (user added today via chat — MUST include these):\n${lines.join("\n")}`;
  }

  // Build calendar events block
  let calendarBlock = "";
  if (todayCalendarEvents.length > 0) {
    const lines = todayCalendarEvents.map((e) => `  - "${e.title}" (${e.startDate} – ${e.endDate}, ${e.durationMinutes}min, ${e.category}${e.recurring ? `, recurring: ${e.recurring.frequency}` : ""})`);
    calendarBlock = `\nCALENDAR EVENTS TODAY (account for these — reduce free time accordingly):\n${lines.join("\n")}`;
  }

  // Build everyday goals block
  let everydayBlock = "";
  if (everydayGoals.length > 0) {
    const lines = everydayGoals.flatMap((g) => [
      `  "${g.title}"${g.suggestedTimeSlot ? ` (suggested: ${g.suggestedTimeSlot})` : ""}`,
      ...g.tasks.map((t) => `    - "${t.title}" (${t.durationMinutes}min, ${t.priority})`),
    ]);
    everydayBlock = `\nEVERYDAY TASKS (one-off tasks to slot into the day — allocate a suitable time):\n${lines.join("\n")}`;
  }

  // Build repeating goals block
  let repeatingBlock = "";
  if (repeatingGoals.length > 0) {
    const lines = repeatingGoals.map((g) => `  - "${g.title}" (${g.durationMinutes}min${g.timeOfDay ? ` at ${g.timeOfDay}` : ""})`);
    repeatingBlock = `\nREPEATING EVENTS TODAY (FIXED time blocks — schedule other tasks around these):\n${lines.join("\n")}`;
    // Reduce free minutes by repeating event durations
    const repeatingMinutes = repeatingGoals.reduce((sum, g) => sum + g.durationMinutes, 0);
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
  const schedulingContextFormatted = (payload._schedulingContextFormatted as string) || "";
  let schedulingBlock = "";
  if (schedulingContextFormatted) {
    schedulingBlock = `\n${schedulingContextFormatted}\n`;
  }

  const response = await client.messages.create({
    model: getModelForTask("daily-tasks"),
    max_tokens: 4096,
    system: personalizeSystem(DAILY_TASKS_SYSTEM, memoryContext),
    messages: [
      {
        role: "user",
        content: `Today is ${date}. I have ${todayFreeMinutes} minutes available for goal work.
${monthlyContextBlock}${vacationBlock}${schedulingBlock}${capacityBlock}
  recommended_task_count: ${recommendedCount}
${calendarBlock}
${repeatingBlock}
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
${JSON.stringify((heatmap as unknown[] || []).slice(-14), null, 2)}

Generate EXACTLY ${recommendedCount.split(" ")[0]} core tasks for today. Include confirmed quick tasks in the count. Respect all constraints.`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const parsed = JSON.parse(cleaned);

  // ── Post-processing guardrails ──
  // Even if the AI generates too many tasks, we enforce the hard limits here.
  let coreTasks: Array<Record<string, unknown>> = parsed.tasks || [];

  // HARD LIMIT: Never more than maxDailyTasks (from monthly context) or 5 core tasks
  const taskHardLimit = capacityProfile.maxDailyTasks ?? 5;
  if (coreTasks.length > taskHardLimit) {
    console.warn(`[NorthStar] AI returned ${coreTasks.length} tasks — trimming to ${taskHardLimit} highest priority`);
    // Sort by priority (must-do first), then by cognitive weight (higher first for impact)
    const priorityOrder: Record<string, number> = { "must-do": 0, "should-do": 1, "bonus": 2 };
    coreTasks.sort((a, b) => {
      const pa = priorityOrder[(a.priority as string) || "should-do"] ?? 1;
      const pb = priorityOrder[(b.priority as string) || "should-do"] ?? 1;
      if (pa !== pb) return pa - pb;
      return ((b.cognitive_weight as number) || 3) - ((a.cognitive_weight as number) || 3);
    });
    coreTasks = coreTasks.slice(0, taskHardLimit);
  }

  // Enforce cognitive weight budget
  let totalWeight = coreTasks.reduce((sum, t) => sum + ((t.cognitive_weight as number) || 3), 0);
  while (totalWeight > capacityProfile.capacityBudget && coreTasks.length > 2) {
    // Remove the lowest-priority task (last after sorting)
    const removed = coreTasks.pop()!;
    totalWeight -= ((removed.cognitive_weight as number) || 3);
    console.warn(`[NorthStar] Budget exceeded (${totalWeight + ((removed.cognitive_weight as number) || 3)}/${capacityProfile.capacityBudget}) — removed "${removed.title}"`);
  }

  // Map bonus_task separately (only if within budget)
  const allTasks = [...coreTasks];
  if (parsed.bonus_task) {
    const bonusWeight = (parsed.bonus_task.cognitive_weight as number) || 2;
    if (totalWeight + bonusWeight <= capacityProfile.capacityBudget + 2) { // +2 grace for bonus
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
      : { date, completionLevel: 0, currentStreak: 0, totalActiveDays: 0, longestStreak: 0 },
    notificationBriefing: parsed.notification_briefing || "",
    adaptiveReasoning: parsed.adaptive_reasoning || "",
    milestoneCelebration: parsed.milestone_celebration || null,
    progress: parsed.progress
      ? {
          overallPercent: parsed.progress.overall_percent || 0,
          milestonePercent: parsed.progress.milestone_percent || 0,
          currentMilestone: parsed.progress.current_month_focus || parsed.progress.current_milestone || "",
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

// Recovery
async function handleRecovery(
  client: Anthropic,
  payload: Record<string, unknown>,
  memoryContext: string
): Promise<unknown> {
  const blockerId = payload.blockerId as string;
  const breakdown = payload.breakdown || payload.roadmap;
  const todayLog = payload.todayLog;

  // Record blocker signal for memory
  quickReflect("blocker_reported", {
    blockerId,
    date: new Date().toISOString().split("T")[0],
  });

  const response = await client.messages.create({
    model: getModelForTask("recovery"),
    max_tokens: 2048,
    system: personalizeSystem(RECOVERY_SYSTEM, memoryContext),
    messages: [
      {
        role: "user",
        content: `I missed some tasks today. The blocker was: "${blockerId}".

TODAY'S LOG:
${JSON.stringify(todayLog, null, 2)}

CURRENT GOAL BREAKDOWN:
${JSON.stringify(breakdown, null, 2)}

Please acknowledge, show impact, and adjust my plan.`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const recoveryResult = JSON.parse(cleaned);

  // Recovery is a strong signal — run reflection in background
  runReflection(client, `recovery_blocker:${blockerId}`).catch((err) =>
    console.warn("Background reflection failed:", err)
  );

  return recoveryResult;
}

// Pace Check
async function handlePaceCheck(
  client: Anthropic,
  payload: Record<string, unknown>,
  memoryContext: string
): Promise<unknown> {
  const breakdown = payload.breakdown || payload.roadmap;
  const logs = payload.logs;

  const response = await client.messages.create({
    model: getModelForTask("pace-check"),
    max_tokens: 2048,
    system: personalizeSystem(PACE_CHECK_SYSTEM, memoryContext),
    messages: [
      {
        role: "user",
        content: `GOAL BREAKDOWN:
${JSON.stringify(breakdown, null, 2)}

DAILY LOGS:
${JSON.stringify(logs, null, 2)}

Please do a pace check.`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const result = JSON.parse(cleaned);

  // Pace check is a natural reflection trigger — run in background
  runReflection(client, "weekly_pace_check").catch((err) =>
    console.warn("Background reflection failed:", err)
  );

  return result;
}

// ── Goal Classification (NLP) ───────────────────────────

const CLASSIFY_GOAL_SYSTEM = `You are NorthStar's goal classification engine. Given a goal description,
target date (or "habit" if it is an ongoing habit with no due date), importance level,
and optional extra description/context from the user, classify this goal into one of THREE types:

═══ THE THREE GOAL TYPES ═══

1. "big" (goalType: "big", scope: "big")
   Long-term goals requiring structured plans with milestones, weekly/daily tasks.
   These get their own dedicated page with hierarchical year→month→week→day breakdown.
   Examples: "Learn machine learning", "Write a novel", "Prepare for MCAT", "Build a startup",
   "Exercise 5 days a week" (habit), "Read 30 minutes daily" (habit)
   SIGNALS: Requires learning, multiple phases, skill development, weeks/months to complete,
   abstract outcomes needing decomposition, ongoing habits with structure.

2. "everyday" (goalType: "everyday", scope: "small")
   One-off tasks, errands, reminders — things that just need to be done once.
   The AI allocates a suitable time and breaks it down if needed.
   Examples: "Wash my shoes", "Ask teacher about homework", "Buy groceries",
   "Schedule dentist appointment", "Email professor about research"
   SIGNALS: Concrete single action, done in one sitting, no learning curve, short timeline.

3. "repeating" (goalType: "repeating", scope: "small")
   Recurring events with a fixed schedule — classes, meetings, regular appointments.
   These go on the calendar and repeat automatically.
   Examples: "Math class every Tuesday 10am", "Weekly team meeting Mondays at 2pm",
   "Piano lessons every Thursday", "Gym every MWF"
   SIGNALS: User mentions a day/time pattern, uses words like "every", "weekly", "class",
   "meeting", mentions specific days of the week.

═══ CLASSIFICATION PRIORITY ═══
1. If the user mentions recurring days/times → "repeating"
2. If it's a quick task or errand → "everyday"
3. If it requires planning and multiple steps → "big"

IMPORTANT: The user may provide extra description/context. This is critical information.
Factor it into classification and task generation.

For "everyday" goals: generate 1-3 simple tasks with suggested time slots.
For "repeating" goals: detect the repeat pattern and suggest a schedule.
For "big" goals: no tasks needed (they get a full plan page).

Respond ONLY with valid JSON:
{
  "scope": "big" | "small",
  "goalType": "big" | "everyday" | "repeating",
  "reasoning": "one sentence explaining why this type was chosen",
  "suggestedTasks": [  // ONLY for everyday goals
    {
      "title": "...",
      "description": "...",
      "dueDate": "YYYY-MM-DD",
      "durationMinutes": 30,
      "priority": "must-do" | "should-do" | "bonus",
      "category": "learning" | "building" | "networking" | "reflection" | "planning"
    }
  ],
  "repeatSchedule": null | {  // ONLY for repeating goals
    "frequency": "daily" | "weekly" | "biweekly" | "monthly",
    "daysOfWeek": [1, 3, 5],
    "timeOfDay": "10:00",
    "durationMinutes": 60,
    "until": ""
  },
  "suggestedTimeSlot": null | "string"  // ONLY for everyday goals, e.g. "Tomorrow morning"
}`;

async function handleClassifyGoal(
  client: Anthropic,
  payload: Record<string, unknown>,
  memoryContext: string
): Promise<unknown> {
  const title = payload.title as string;
  const targetDate = payload.targetDate as string;
  const importance = payload.importance as string;
  const isHabit = payload.isHabit as boolean;
  const description = (payload.description as string) || "";

  const response = await client.messages.create({
    model: getModelForTask("classify-goal"),
    max_tokens: 1024,
    system: personalizeSystem(CLASSIFY_GOAL_SYSTEM, memoryContext),
    messages: [
      {
        role: "user",
        content: `Goal: "${title}"
Type: ${isHabit ? "Ongoing habit (no due date)" : "Goal with target date"}
Target date: ${isHabit ? "N/A (habit)" : targetDate || "flexible"}
Importance: ${importance}
${description ? `User's extra context/description: "${description}"` : "No extra description provided."}
Today's date: ${new Date().toISOString().split("T")[0]}`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    console.error("[ai-handler] classify-goal: failed to parse AI response:", cleaned.slice(0, 500));
    throw new Error("AI returned invalid JSON for goal classification. Please try again.");
  }
}

// ── Goal Plan Chat ──────────────────────────────────────

const GOAL_PLAN_CHAT_SYSTEM = `You are NorthStar, an expert goal planning AI. The user has created a big goal
and you are having a conversation to develop or modify their plan.

YOUR ROLE:
- Help the user flesh out or refine the plan through conversation
- Ask clarifying questions about their current level, available resources, constraints
- Suggest milestones and structure
- Be conversational and supportive, not robotic
- Pay close attention to the user's extra description/context — it may contain important
  constraints, preferences, schedule info, motivation, current skill level, or any other
  relevant details. Incorporate all of this into your planning.
- If the goal is a habit (no due date), focus on building sustainable routines, progressive
  difficulty, and tracking milestones rather than deadline-based phases.

PLAN MODIFICATION RULES (when a plan already exists):
- When the user asks to change something specific (e.g. "make week 2 easier", "swap month 3 and 4"),
  produce a PATCH — only the changed portions — rather than regenerating the whole plan.
- A patch uses "planPatch" instead of "plan" and only includes the changed items.
- If the change is too fundamental (e.g. "completely redo this"), set planReady: true and
  output a full new "plan".

WHEN THE USER CONFIRMS or says something like "looks good", "let's go", "confirm", "start":
You MUST include a structured plan in your response using the HIERARCHICAL format below.

PLAN RULES:
- Every description field must be ONE sentence max.
- Only generate daily tasks for the FIRST 2 WEEKS. Future weeks: locked: true, days: [].
- Milestones: 3-6 key checkpoints.
- Structure: milestones → years → months → weeks → days → tasks.
- For goals < 1 year, use a single year wrapper.

Respond ONLY with valid JSON:
{
  "reply": "Your conversational response to the user",
  "planReady": false,
  "plan": null,
  "planPatch": null
}

For targeted changes when a plan already exists:
{
  "reply": "I've adjusted week 2 to be lighter...",
  "planReady": false,
  "plan": null,
  "planPatch": {
    "milestones": null,
    "years": [
      {
        "id": "year-1",
        "months": [
          {
            "id": "month-1",
            "weeks": [
              {
                "id": "week-2",
                "objective": "NEW objective (rest of fields unchanged)",
                "days": [...]
              }
            ]
          }
        ]
      }
    ]
  }
}

OR when the plan is ready (full plan):
{
  "reply": "Great! Here's your plan...",
  "planReady": true,
  "plan": {
    "milestones": [
      { "id": "ms-1", "title": "...", "description": "One sentence.", "targetDate": "...", "completed": false }
    ],
    "years": [
      {
        "id": "year-1",
        "label": "Year 1",
        "objective": "One sentence.",
        "months": [
          {
            "id": "month-1",
            "label": "Month 1",
            "objective": "One sentence.",
            "weeks": [
              {
                "id": "week-1",
                "label": "Week 1",
                "objective": "One sentence.",
                "locked": false,
                "days": [
                  {
                    "id": "day-1",
                    "label": "Monday",
                    "tasks": [
                      {
                        "id": "task-1",
                        "title": "Task title",
                        "description": "One sentence.",
                        "durationMinutes": 30,
                        "priority": "must-do",
                        "category": "learning",
                        "completed": false
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  },
  "planPatch": null
}`;

/** Build a compact summary of the current plan for the AI to reference */
function summarizePlanForChat(plan: Record<string, unknown>): string {
  const milestones = (plan.milestones || []) as Array<Record<string, unknown>>;
  const years = (plan.years || []) as Array<Record<string, unknown>>;

  const lines: string[] = ["CURRENT PLAN STRUCTURE:"];

  if (milestones.length > 0) {
    lines.push("Milestones:");
    milestones.forEach((ms) => {
      lines.push(`  - [${ms.completed ? "✓" : " "}] ${ms.title} (target: ${ms.targetDate})`);
    });
  }

  for (const yr of years) {
    lines.push(`Year: ${yr.label} — ${yr.objective}`);
    const months = (yr.months || []) as Array<Record<string, unknown>>;
    for (const mo of months) {
      const weeks = (mo.weeks || []) as Array<Record<string, unknown>>;
      const weekSummary = weeks.map((w) => {
        const locked = w.locked ? "🔒" : "🔓";
        const days = (w.days || []) as Array<Record<string, unknown>>;
        const taskCount = days.reduce((sum: number, d) => {
          const tasks = (d.tasks || []) as Array<Record<string, unknown>>;
          return sum + tasks.length;
        }, 0);
        const completedCount = days.reduce((sum: number, d) => {
          const tasks = (d.tasks || []) as Array<Record<string, unknown>>;
          return sum + tasks.filter((t) => t.completed).length;
        }, 0);
        return `${locked}${w.label}(${completedCount}/${taskCount})`;
      }).join(", ");
      lines.push(`  ${mo.label}: ${mo.objective} [${weekSummary}]`);
    }
  }

  return lines.join("\n");
}

async function handleGoalPlanChat(
  client: Anthropic,
  payload: Record<string, unknown>,
  memoryContext: string
): Promise<unknown> {
  const goalTitle = payload.goalTitle as string;
  const targetDate = payload.targetDate as string;
  const importance = payload.importance as string;
  const isHabit = payload.isHabit as boolean;
  const description = (payload.description as string) || "";
  const chatHistory = (payload.chatHistory || []) as Array<{ role: string; content: string }>;
  const userMessage = payload.userMessage as string;
  const currentPlan = payload.currentPlan as Record<string, unknown> | null;

  const messages = chatHistory.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  messages.push({ role: "user", content: userMessage });

  const goalContext = [
    `- Goal: "${goalTitle}"`,
    `- Type: ${isHabit ? "Ongoing habit (no due date)" : "Goal with target date"}`,
    `- Target date: ${isHabit ? "N/A (habit)" : targetDate || "flexible"}`,
    `- Importance: ${importance}`,
    description ? `- User's description/context: "${description}"` : null,
    `- Today: ${new Date().toISOString().split("T")[0]}`,
  ].filter(Boolean).join("\n");

  // Include current plan summary if plan exists
  const planBlock = currentPlan ? `\n\n${summarizePlanForChat(currentPlan)}` : "";

  const response = await client.messages.create({
    model: getModelForTask("goal-plan-chat"),
    max_tokens: 4096,
    system: personalizeSystem(
      `${GOAL_PLAN_CHAT_SYSTEM}\n\nGOAL CONTEXT:\n${goalContext}${planBlock}`,
      memoryContext
    ),
    messages,
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    // If AI didn't return valid JSON, wrap the text response
    return { reply: text, planReady: false, plan: null, planPatch: null };
  }
}

// ── Goal Plan Edit (inline edit impact analysis) ────────

const GOAL_PLAN_EDIT_SYSTEM = `You are NorthStar, a goal planning AI performing a LIGHTWEIGHT edit analysis.
The user has directly edited a field in their goal plan. Your job is to:

1. EVALUATE the edit — Is it reasonable? Does it conflict with anything?
2. SUGGEST cascading changes — If changing a week's objective, should downstream tasks change?
3. DECIDE if a full replan is needed — Only true if the edit fundamentally changes the goal direction.

EFFICIENCY RULES:
- Be CONCISE. This is a quick check, not a full replanning session.
- Only suggest cascading changes that are truly necessary.
- If the edit is minor (typo fix, small time adjustment), verdict = "approve" with no cascading changes.
- If the edit changes scope (e.g. "learn Python" → "learn Rust"), flag requiresReplan = true.
- Never suggest more than 5 cascading changes.

Respond with valid JSON ONLY:
{
  "verdict": "approve" | "caution" | "warn",
  "reason": "1-2 sentence explanation",
  "cascadingChanges": [
    {
      "level": "week" | "month" | "year" | "milestone" | "task" | "day",
      "targetId": "id of the item to change",
      "field": "field name to change",
      "suggestedValue": "new value",
      "reason": "why this needs to change"
    }
  ],
  "requiresReplan": false
}`;

async function handleGoalPlanEdit(
  client: Anthropic,
  payload: Record<string, unknown>,
  memoryContext: string
): Promise<unknown> {
  const goalTitle = payload.goalTitle as string;
  const edit = payload.edit as Record<string, unknown>;
  const planSummary = payload.planSummary as string;

  const editDescription = [
    `EDIT DETAILS:`,
    `- Level: ${edit.level}`,
    `- Target ID: ${edit.targetId}`,
    `- Field: ${edit.field}`,
    `- Old value: "${edit.oldValue}"`,
    `- New value: "${edit.newValue}"`,
    `- Path: ${JSON.stringify(edit.path)}`,
  ].join("\n");

  const response = await client.messages.create({
    model: getModelForTask("goal-plan-edit"),
    max_tokens: 512,     // lightweight — keep it fast and cheap
    system: personalizeSystem(
      `${GOAL_PLAN_EDIT_SYSTEM}\n\nGOAL: "${goalTitle}"\n\n${planSummary}`,
      memoryContext
    ),
    messages: [
      { role: "user", content: editDescription },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  return JSON.parse(cleaned);
}

// ── Generate Goal Plan (initial) ────────────────────────

const GENERATE_GOAL_PLAN_SYSTEM = `You are NorthStar, an expert goal planning AI. Generate a hierarchical,
structured plan for the user's goal.

IMPORTANT RULES:
- Pay close attention to the user's extra description/context.
- Every description field must be ONE sentence max. Just explain its importance to the overall goal.
- DO NOT generate tasks for every single day/week/month. Only generate detail for the FIRST 2 WEEKS.
  Future weeks should exist as stubs with locked: true and empty days array.
- For habits (no due date), structure around progressive phases.
- Use relative labels ("Week 1", "Month 1", "Year 1") for habits; use actual dates for dated goals.

PLAN STRUCTURE (hierarchical):
1. MILESTONES — Timeline overview. Key checkpoints in the journey (3-6 milestones).
2. YEARS — Only include if the goal spans >1 year or is a habit. Each year has a 1-sentence objective.
3. MONTHS — What to achieve each month. 1-sentence objective.
4. WEEKS — What to achieve each week. Only the first 2 weeks have locked: false with daily tasks.
   All future weeks have locked: true and an empty days array.
5. DAYS — Only for unlocked weeks. Each day has 1-3 actionable tasks.

For goals shorter than 1 year, use a single year entry as a wrapper.

Respond ONLY with valid JSON:
{
  "reply": "A brief encouraging overview of the plan",
  "plan": {
    "milestones": [
      {
        "id": "ms-1",
        "title": "Milestone name",
        "description": "One sentence on what this milestone represents.",
        "targetDate": "YYYY-MM-DD or relative like 'Month 3'",
        "completed": false
      }
    ],
    "years": [
      {
        "id": "year-1",
        "label": "Year 1" or "2025",
        "objective": "One sentence: what to achieve this year.",
        "months": [
          {
            "id": "month-1",
            "label": "Month 1" or "January 2025",
            "objective": "One sentence: what to achieve this month.",
            "weeks": [
              {
                "id": "week-1",
                "label": "Week 1" or "Jan 6 – Jan 12",
                "objective": "One sentence: what to achieve this week.",
                "locked": false,
                "days": [
                  {
                    "id": "day-1",
                    "label": "Monday" or "Jan 6",
                    "tasks": [
                      {
                        "id": "task-uuid",
                        "title": "Task title",
                        "description": "One sentence: why this matters.",
                        "durationMinutes": 30,
                        "priority": "must-do",
                        "category": "learning",
                        "completed": false
                      }
                    ]
                  }
                ]
              },
              {
                "id": "week-3",
                "label": "Week 3",
                "objective": "One sentence objective.",
                "locked": true,
                "days": []
              }
            ]
          }
        ]
      }
    ]
  }
}`;

async function handleGenerateGoalPlan(
  client: Anthropic,
  payload: Record<string, unknown>,
  memoryContext: string
): Promise<unknown> {
  const goalTitle = payload.goalTitle as string;
  const targetDate = payload.targetDate as string;
  const importance = payload.importance as string;
  const isHabit = payload.isHabit as boolean;
  const description = (payload.description as string) || "";

  // Research context injected by the coordinator
  const researchSummary = (payload._researchSummary as string) || "";
  const researchFindings = (payload._researchFindings as string[]) || [];

  const goalContext = [
    `- Goal: "${goalTitle}"`,
    `- Type: ${isHabit ? "Ongoing habit (no due date)" : "Goal with target date"}`,
    `- Target date: ${isHabit ? "N/A (habit)" : targetDate || "flexible"}`,
    `- Importance: ${importance}`,
    description ? `- User's description/context: "${description}"` : null,
    `- Today: ${new Date().toISOString().split("T")[0]}`,
  ].filter(Boolean).join("\n");

  // Build research block if available
  let researchBlock = "";
  if (researchSummary) {
    researchBlock = `\n\nRESEARCH DATA (use this to make the plan realistic):
${researchSummary}

KEY FINDINGS:
${researchFindings.map((f, i) => `${i + 1}. ${f}`).join("\n")}

IMPORTANT: Use the research data above to set REALISTIC timelines and milestones.
Do NOT ignore this data. If research says something takes 6 months, don't plan for 2 weeks.`;
  }

  const response = await client.messages.create({
    model: getModelForTask("generate-goal-plan"),
    max_tokens: 8192,
    system: personalizeSystem(
      `${GENERATE_GOAL_PLAN_SYSTEM}\n\nGOAL CONTEXT:\n${goalContext}${researchBlock}`,
      memoryContext
    ),
    messages: [
      {
        role: "user",
        content: `Please create a comprehensive plan for my goal: "${goalTitle}"
Type: ${isHabit ? "Ongoing habit (no due date)" : "Goal with target date"}
Target date: ${isHabit ? "N/A (habit)" : targetDate || "flexible"}
Importance level: ${importance}${description ? `\nAdditional context: ${description}` : ""}${researchSummary ? `\n\nThe research agent found the following about this goal domain:\n${researchSummary}` : ""}`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  return JSON.parse(cleaned);
}

// ── Analyze Quick Task ─────────────────────────────────────

async function handleAnalyzeQuickTask(
  client: Anthropic,
  payload: Record<string, unknown>,
  memoryContext: string
): Promise<unknown> {
  const userInput = payload.userInput as string;
  const existingTasks = (payload.existingTasks || []) as Array<{ title: string; cognitiveWeight?: number; durationMinutes?: number; priority?: string }>;
  const goals = (payload.goals || []) as Array<{ title: string; scope: string }>;
  const todayCalendarEvents = (payload.todayCalendarEvents || []) as Array<{ title: string; startDate: string; endDate: string; durationMinutes: number; category: string }>;

  const today = new Date().toISOString().split("T")[0];

  const existingTasksSummary = existingTasks.length > 0
    ? existingTasks.map((t, i) => `  ${i + 1}. "${t.title}" (weight: ${t.cognitiveWeight || 3}, ${t.durationMinutes || 30}min, ${t.priority || "should-do"})`).join("\n")
    : "  No tasks yet today.";

  const totalWeight = existingTasks.reduce((sum, t) => sum + (t.cognitiveWeight || 3), 0);
  const totalMinutes = existingTasks.reduce((sum, t) => sum + (t.durationMinutes || 30), 0);
  const remainingBudget = 12 - totalWeight; // max cognitive budget

  const goalsSummary = goals.length > 0
    ? goals.map((g) => `  - ${g.title} (${g.scope})`).join("\n")
    : "  No goals set.";

  const calendarSummary = todayCalendarEvents.length > 0
    ? todayCalendarEvents.map((e) => `  - "${e.title}" (${e.startDate} – ${e.endDate}, ${e.durationMinutes}min, ${e.category})`).join("\n")
    : "  No calendar events today.";

  // Get schedule context for free time calculation
  let todayFreeMinutes = 120;
  try {
    const schedule = await getScheduleContext(today, today, [], undefined);
    if (schedule.days.length > 0) {
      todayFreeMinutes = Math.min(schedule.days[0].freeMinutes, 240);
    }
  } catch { /* no calendar data */ }

  const remainingFreeMinutes = Math.max(0, todayFreeMinutes - totalMinutes);

  // Inject scheduling context from coordinator (if available)
  const schedulingContextFormatted = (payload._schedulingContextFormatted as string) || "";
  let schedulingBlock = "";
  if (schedulingContextFormatted) {
    schedulingBlock = `\n${schedulingContextFormatted}\n`;
  }

  const response = await client.messages.create({
    model: getModelForTask("analyze-quick-task"),
    max_tokens: 512,
    system: personalizeSystem(ANALYZE_QUICK_TASK_SYSTEM, memoryContext),
    messages: [
      {
        role: "user",
        content: `TODAY: ${today}
${schedulingBlock}
USER INPUT: "${userInput}"

EXISTING TASKS TODAY:
${existingTasksSummary}
  Total cognitive weight used: ${totalWeight}/12
  Remaining cognitive budget: ${remainingBudget} points
  Total task time so far: ${totalMinutes}min
  Remaining free time: ~${remainingFreeMinutes}min

CALENDAR EVENTS TODAY:
${calendarSummary}

USER'S GOALS:
${goalsSummary}

IMPORTANT: If adding this task would push total weight above 12 or total time beyond
the remaining free time, suggest scheduling it for TOMORROW instead of today.
If it's genuinely urgent (deadline today), note the overload explicitly.

Analyze this task and suggest how to schedule it.`,
      },
    ],
  });

  const text2 = response.content[0].type === "text" ? response.content[0].text : "";
  const cleanedText = text2.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  return JSON.parse(cleanedText);
}

// ── Analyze Monthly Context ───────────────────────────────

const ANALYZE_MONTHLY_CONTEXT_SYSTEM = `You are NorthStar's monthly context analyzer. The user describes what their month looks like — exams, vacation, work crunch, etc. Your job is to interpret this into structured scheduling parameters.

INTENSITY LEVELS:
- "free": Very light month — vacation, break, no obligations. capacityMultiplier: 1.5, maxDailyTasks: 5
- "light": Fewer than usual obligations. capacityMultiplier: 1.2, maxDailyTasks: 4
- "normal": Typical month, balanced workload. capacityMultiplier: 1.0, maxDailyTasks: 3
- "busy": Heavy month — deadlines, projects, social commitments. capacityMultiplier: 0.6, maxDailyTasks: 2
- "intense": Crunch time — exams, major deadlines, crisis. capacityMultiplier: 0.3, maxDailyTasks: 1

RULES:
- Read the user's description carefully for signals of cognitive load, time pressure, and emotional stress.
- If they mention exams, finals, thesis deadlines → lean toward "busy" or "intense".
- If they mention vacation, time off, holiday → lean toward "free" or "light".
- Provide clear reasoning so the user understands why you chose this level.
- The capacityMultiplier scales the user's cognitive budget (base 12 points). At 0.3, they get ~4 points/day.
- maxDailyTasks is the hard cap on non-calendar tasks the system will generate.

RESPOND WITH ONLY valid JSON, no markdown fences:
{
  "intensity": "free" | "light" | "normal" | "busy" | "intense",
  "intensityReasoning": "1-2 sentence explanation of why this intensity was chosen",
  "capacityMultiplier": number,
  "maxDailyTasks": number
}`;

async function handleAnalyzeMonthlyContext(
  client: Anthropic,
  payload: Record<string, unknown>,
  memoryContext: string
): Promise<unknown> {
  const month = payload.month as string;
  const description = payload.description as string;

  const response = await client.messages.create({
    model: getModelForTask("analyze-monthly-context"),
    max_tokens: 256,
    system: personalizeSystem(ANALYZE_MONTHLY_CONTEXT_SYSTEM, memoryContext),
    messages: [
      {
        role: "user",
        content: `Month: ${month}\n\nMy situation this month: ${description}`,
      },
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  return JSON.parse(cleaned);
}

// ── Home Chat ──────────────────────────────────────────────

async function handleHomeChat(
  client: Anthropic,
  payload: Record<string, unknown>,
  memoryContext: string
): Promise<unknown> {
  const userInput = payload.userInput as string;
  const chatHistory = (payload.chatHistory || []) as Array<{ role: string; content: string }>;
  const goals = (payload.goals || []) as Array<{ title: string; scope: string; status: string }>;
  const todayTasks = (payload.todayTasks || []) as Array<{ title: string; completed: boolean; cognitiveWeight?: number }>;
  const todayCalendarEvents = (payload.todayCalendarEvents || []) as Array<{ title: string; startDate: string; endDate: string; category: string }>;

  const goalsSummary = goals.length > 0
    ? goals.map((g) => `- ${g.title} (${g.scope}, ${g.status})`).join("\n")
    : "No goals set.";

  const tasksSummary = todayTasks.length > 0
    ? todayTasks.map((t) => `- [${t.completed ? "✓" : " "}] ${t.title} (weight: ${t.cognitiveWeight || 3})`).join("\n")
    : "No tasks today.";

  const totalWeight = todayTasks.reduce((sum, t) => sum + (t.cognitiveWeight || 3), 0);
  const completedCount = todayTasks.filter((t) => t.completed).length;

  const calendarSummary = todayCalendarEvents.length > 0
    ? todayCalendarEvents.map((e) => `- ${e.title} (${e.startDate}, ${e.category})`).join("\n")
    : "No calendar events.";

  const contextBlock = `USER CONTEXT:
Goals: 
${goalsSummary}

Today's tasks (${completedCount}/${todayTasks.length} done, cognitive load: ${totalWeight}/12):
${tasksSummary}

Today's calendar:
${calendarSummary}`;

  const messages = chatHistory.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));
  messages.push({ role: "user", content: userInput });

  const response = await client.messages.create({
    model: getModelForTask("home-chat"),
    max_tokens: 512,
    system: personalizeSystem(`${HOME_CHAT_SYSTEM}\n\n${contextBlock}`, memoryContext),
    messages,
  });

  const chatText = response.content[0].type === "text" ? response.content[0].text : "";
  return { reply: chatText.trim() };
}