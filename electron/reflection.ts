/* ──────────────────────────────────────────────────────────
   NorthStar — Reflection Engine (Micro-Adjustment Loop)
   
   The "secret sauce" — every user interaction is treated as
   a data point for calibration. This module:
   
   1. CAPTURES: Records behavioral signals (explicit + implicit)
   2. DISTILLS: Runs a background AI call to extract insights
   3. UPSERTS: Saves insights into Long-Term + Semantic memory
   4. RETRIEVES: Memory is queried next time the AI plans
   
   Reflection runs automatically after key events:
   - End of day (tasks completed/missed)
   - Recovery triggered (blocker reported)
   - Week boundary (pace check)
   - User gives explicit feedback
   ────────────────────────────────────────────────────────── */

import Anthropic from "@anthropic-ai/sdk";
import {
  loadMemory,
  saveMemory,
  recordSignal,
  recordSnooze,
  recordTaskTiming,
  upsertFact,
  upsertPreference,
  getManager,
  type MemoryStore,
  type SignalType,
  type FactCategory,
} from "./memory";

const MODEL = "claude-sonnet-4-6";

// ── Reflection System Prompt ────────────────────────────

const REFLECTION_SYSTEM = `You are the NorthStar Reflection Engine — an introspective module
that observes user behavior and distills it into structured insights.

You are NOT talking to the user. You are analyzing behavioral data to extract
patterns that will improve future planning.

Given a batch of behavioral signals, you must output:

1. FACTS: Concrete, structured facts about this user
2. PREFERENCES: Softer "vibe" preferences about how they work
3. CALIBRATIONS: Duration/timing adjustments based on actual performance

PAY SPECIAL ATTENTION TO:
- Day-of-week patterns (e.g. "User struggles on Tuesdays", "Fridays are strong")
- Time-of-day patterns (e.g. "Completes tasks before 10 AM", "Skips evening tasks")
- Day+time combinations (e.g. "Tuesday evenings after meetings are low-energy")
- Overwhelm signals (3+ skips in a day means task load was too heavy)
- Snooze-to-completion patterns (tasks snoozed 3x may need restructuring)
- Category performance (e.g. "Exercise tasks complete better in mornings")

OUTPUT FORMAT (JSON, NO markdown fences):
{
  "facts": [
    {
      "category": "schedule|preference|capacity|motivation|pattern|constraint|strength|struggle",
      "key": "snake_case_key",
      "value": "Natural language description — be specific about days/times/contexts",
      "evidence": "What signals led to this conclusion"
    }
  ],
  "preferences": [
    {
      "text": "Natural language preference statement",
      "tags": ["tag1", "tag2", "tag3"],
      "weight": 0.8,
      "example": "Specific instance that shows this"
    }
  ],
  "calibrations": [
    {
      "category": "task category",
      "insight": "What we learned about duration/timing"
    }
  ],
  "proactive_question": "A question to ask the user next time, or null"
}

RULES:
- Be SPECIFIC. "User lacks energy on Tuesday evenings" is better than "User has energy patterns."
- Include day names and time ranges when relevant (e.g. "mornings before 10 AM", "Wednesday afternoons")
- weight is -1 (strong dislike) to +1 (strong preference)
- Don't invent things not supported by signals
- If signals are contradictory, note the uncertainty
- Focus on ACTIONABLE insights that change future plans
- tags should include day names, time-of-day words, and category names when relevant`;

// ── Public API ──────────────────────────────────────────

/**
 * Record a behavioral signal and save to memory.
 * Called from IPC handlers whenever something interesting happens.
 */
export function captureSignal(
  type: SignalType,
  context: string,
  value: string
): void {
  let memory = loadMemory();
  memory = recordSignal(memory, type, context, value);
  saveMemory(memory);
}

/**
 * Record a task snooze (implicit feedback).
 */
export function captureSnooze(
  taskTitle: string,
  taskCategory: string,
  originalDate: string
): void {
  let memory = loadMemory();
  memory = recordSnooze(memory, taskTitle, taskCategory, originalDate);
  memory = recordSignal(memory, "task_snoozed", taskTitle, `Snoozed on ${originalDate}`);
  saveMemory(memory);
}

/**
 * Record task completion timing (implicit calibration data).
 */
export function captureTaskTiming(
  taskCategory: string,
  taskTitle: string,
  estimatedMinutes: number,
  actualMinutes: number
): void {
  let memory = loadMemory();
  // Extract simple keywords from title
  const keywords = taskTitle
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 5);
  memory = recordTaskTiming(memory, taskCategory, keywords, estimatedMinutes, actualMinutes);

  // Also record as signal
  const diff = actualMinutes - estimatedMinutes;
  if (Math.abs(diff) >= 10) {
    memory = recordSignal(
      memory,
      diff > 0 ? "task_completed_late" : "task_completed_early",
      taskTitle,
      `Est: ${estimatedMinutes}min, Actual: ${actualMinutes}min (${diff > 0 ? "+" : ""}${diff}min)`
    );
  }

  saveMemory(memory);
}

/**
 * Record app session start (track when user is active).
 */
export function captureSessionStart(): void {
  let memory = loadMemory();
  memory = recordSignal(memory, "session_time", "app_opened", new Date().toISOString());
  saveMemory(memory);
}

/**
 * Run the full reflection loop.
 * This calls Claude to analyze recent signals and distill insights.
 * Should be called:
 *   - After end-of-day task review
 *   - After recovery events
 *   - Periodically (e.g. weekly)
 */
export async function runReflection(
  client: Anthropic,
  triggerContext: string
): Promise<{ success: boolean; newInsights: number; proactiveQuestion: string | null }> {
  let memory = loadMemory();

  // Gather recent signals (since last reflection, or last 50)
  const sinceDate = memory.lastReflectionAt || "2020-01-01";
  const recentSignals = memory.signals.filter(
    (s) => s.timestamp > sinceDate
  );

  if (recentSignals.length < 3) {
    return { success: true, newInsights: 0, proactiveQuestion: null };
  }

  // Also gather snooze data and timing data
  const snoozeData = memory.snoozeRecords.filter(
    (s) => s.lastSnoozed > sinceDate
  );
  const timingData = memory.taskTimings.filter(
    (t) => t.date > sinceDate.split("T")[0]
  );

  // Build day-of-week summary from signals for richer analysis
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const dayBreakdown: Record<string, { completed: number; skipped: number; snoozed: number }> = {};
  for (const s of recentSignals) {
    const day = dayNames[new Date(s.timestamp).getDay()];
    if (!dayBreakdown[day]) dayBreakdown[day] = { completed: 0, skipped: 0, snoozed: 0 };
    if (s.type === "task_completed" || s.type === "task_completed_early") dayBreakdown[day].completed++;
    if (s.type === "task_skipped") dayBreakdown[day].skipped++;
    if (s.type === "task_snoozed") dayBreakdown[day].snoozed++;
  }

  // Build the reflection prompt
  const userMessage = `REFLECTION TRIGGER: ${triggerContext}
DATE: ${new Date().toISOString().split("T")[0]}
DAY: ${dayNames[new Date().getDay()]}

RECENT BEHAVIORAL SIGNALS (${recentSignals.length} events):
${JSON.stringify(recentSignals.slice(-50), null, 2)}

DAY-OF-WEEK PERFORMANCE BREAKDOWN:
${JSON.stringify(dayBreakdown, null, 2)}

SNOOZE DATA:
${snoozeData.length > 0 ? JSON.stringify(snoozeData, null, 2) : "No snooze records"}

TASK TIMING DATA:
${timingData.length > 0 ? JSON.stringify(timingData, null, 2) : "No timing data"}

EXISTING FACTS (for reference — update or add to these):
${JSON.stringify(
  memory.facts.map((f) => ({ category: f.category, key: f.key, value: f.value, confidence: f.confidence })),
  null,
  2
)}

EXISTING PREFERENCES (for reference):
${JSON.stringify(
  memory.preferences.map((p) => ({ text: p.text, weight: p.weight, frequency: p.frequency, tags: p.tags })),
  null,
  2
)}

Analyze these signals and extract structured insights. Focus on:
1. What's NEW or what UPDATES existing knowledge
2. Day-of-week patterns (which days are strong/weak)
3. Time-of-day patterns (morning vs evening performance)
4. Day+time combinations (e.g. "Tuesday evenings are consistently bad")
5. Category-specific patterns (e.g. "exercise tasks are better in mornings")
6. Signs of overwhelm (multiple skips in a single day)
Include day names and times in your fact values and preference tags.`;

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: REFLECTION_SYSTEM,
      messages: [{ role: "user", content: userMessage }],
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";
    const cleaned = text
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
    const result = JSON.parse(cleaned);

    let insightCount = 0;

    // Upsert facts
    if (Array.isArray(result.facts)) {
      for (const fact of result.facts) {
        memory = upsertFact(
          memory,
          fact.category as FactCategory,
          fact.key,
          fact.value,
          fact.evidence,
          "reflection"
        );
        insightCount++;
      }
    }

    // Upsert preferences
    if (Array.isArray(result.preferences)) {
      for (const pref of result.preferences) {
        memory = upsertPreference(
          memory,
          pref.text,
          pref.tags || [],
          pref.weight || 0,
          pref.example || ""
        );
        insightCount++;
      }
    }

    // Update meta
    memory.lastReflectionAt = new Date().toISOString();
    memory.reflectionCount += 1;

    saveMemory(memory);

    return {
      success: true,
      newInsights: insightCount,
      proactiveQuestion: result.proactive_question || null,
    };
  } catch (err) {
    console.error("Reflection failed:", err);
    return { success: false, newInsights: 0, proactiveQuestion: null };
  }
}

/**
 * Quick reflection without AI call — just pattern matching.
 * Use for immediate feedback (e.g. task completed/snoozed).
 * 
 * Enriches every signal with day-of-week + time-of-day context
 * so the reflection engine can discover day+time patterns.
 */
export function quickReflect(
  event: "task_completed" | "task_snoozed" | "task_skipped" | "blocker_reported",
  details: {
    taskTitle?: string;
    taskCategory?: string;
    date?: string;
    blockerId?: string;
    completionTime?: number;
    estimatedTime?: number;
  }
): void {
  let memory = loadMemory();
  const now = new Date();
  const hour = now.getHours();
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const dayName = dayNames[now.getDay()];
  const timeSlot = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  const timeLabel = `${hour}:00`;

  switch (event) {
    case "task_completed": {
      memory = recordSignal(
        memory,
        "task_completed",
        details.taskTitle || "unknown",
        `Completed at ${timeLabel} on ${dayName} ${timeSlot}, category: ${details.taskCategory || "unknown"}`
      );

      // Track energy windows with day context
      if (hour >= 6 && hour <= 10) {
        memory = recordSignal(memory, "high_energy_window", "morning", `Completed "${details.taskTitle}" on ${dayName} morning`);
      } else if (hour >= 14 && hour <= 16) {
        memory = recordSignal(memory, "high_energy_window", "afternoon", `Completed "${details.taskTitle}" on ${dayName} afternoon`);
      } else if (hour >= 22 || hour <= 5) {
        memory = recordSignal(memory, "high_energy_window", "night", `Completed "${details.taskTitle}" on ${dayName} late at night`);
      }

      // Timing calibration
      if (details.completionTime && details.estimatedTime) {
        const keywords = (details.taskTitle || "")
          .toLowerCase()
          .split(/\s+/)
          .filter((w) => w.length > 3)
          .slice(0, 5);
        memory = recordTaskTiming(
          memory,
          details.taskCategory || "other",
          keywords,
          details.estimatedTime,
          details.completionTime
        );
      }
      break;
    }

    case "task_snoozed": {
      memory = recordSnooze(
        memory,
        details.taskTitle || "unknown",
        details.taskCategory || "other",
        details.date || now.toISOString().split("T")[0]
      );
      // Also record the day+time context for snoozes
      memory = recordSignal(
        memory,
        "low_energy_window",
        `${dayName}_${timeSlot}`,
        `Snoozed "${details.taskTitle}" on ${dayName} ${timeSlot} at ${timeLabel}`
      );
      break;
    }

    case "task_skipped": {
      memory = recordSignal(
        memory,
        "task_skipped",
        details.taskTitle || "unknown",
        `Skipped on ${dayName} ${details.date || now.toISOString().split("T")[0]}, ${timeSlot} at ${timeLabel}, category: ${details.taskCategory || "unknown"}`
      );
      break;
    }

    case "blocker_reported": {
      memory = recordSignal(
        memory,
        "blocker_reported",
        details.blockerId || "unknown",
        `Reported at ${timeLabel} on ${dayName} ${timeSlot}, ${details.date || now.toISOString().split("T")[0]}`
      );
      memory = recordSignal(
        memory,
        "recovery_triggered",
        "recovery",
        details.blockerId || "unknown"
      );
      break;
    }
  }

  saveMemory(memory);
}

/**
 * Record explicit user feedback (e.g. from a "Was this helpful?" prompt).
 */
export function captureExplicitFeedback(
  context: string,
  feedback: string,
  isPositive: boolean
): void {
  let memory = loadMemory();
  memory = recordSignal(
    memory,
    isPositive ? "positive_feedback" : "negative_feedback",
    context,
    feedback
  );

  // Immediately create a preference from explicit feedback
  const tags = feedback
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 6);
  memory = upsertPreference(
    memory,
    feedback,
    [...tags, isPositive ? "liked" : "disliked", context],
    isPositive ? 0.8 : -0.8,
    `User said: "${feedback}" about ${context}`
  );

  saveMemory(memory);
}

// ── Contextual Nudge Engine ─────────────────────────────
// The "Feedback Trigger" Logic — don't ask "How did I do?"
// Instead, use contextual probing based on what just happened.

export interface NudgeResult {
  id: string;
  type: "early_finish" | "snooze_probe" | "missed_deadline" | "dead_zone" | "overwhelm" | "streak" | "proactive";
  message: string;
  actions?: Array<{
    label: string;
    feedbackValue: string;
    isPositive: boolean;
  }>;
  priority: number;
  context: string;
}

/**
 * Generate contextual nudges based on current state.
 * Called after task actions to produce smart feedback probes.
 *
 * This implements the "Feedback Trigger" logic:
 *   - Positive Reinforcement: "You finished early. More intense next time?"
 *   - Course Correction: "We missed X. Was it too ambitious?"
 *   - Snooze Probe: "Snoozed 3x. Timing or scope?"
 *   - Dead Zone Detection: "You skip tasks around 2 PM consistently."
 *   - Overwhelm Detection: "3+ skips today — should I lighten the load?"
 */
export function generateNudges(
  todayTasks: Array<{
    id: string;
    title: string;
    category: string;
    durationMinutes: number;
    completed: boolean;
    completedAt?: string;
    startedAt?: string;
    actualMinutes?: number;
    snoozedCount?: number;
    skipped?: boolean;
    priority: string;
  }>,
  proactiveQuestion?: string | null
): NudgeResult[] {
  const nudges: NudgeResult[] = [];
  const memory = loadMemory();
  const now = new Date();
  const hour = now.getHours();

  // ── 1. EARLY FINISH — Positive Reinforcement ──
  for (const task of todayTasks) {
    if (task.completed && task.actualMinutes && task.durationMinutes) {
      const savedMinutes = task.durationMinutes - task.actualMinutes;
      if (savedMinutes >= 10) {
        nudges.push({
          id: `nudge-early-${task.id}`,
          type: "early_finish",
          message: `You finished "${task.title}" ${savedMinutes} minutes early! Should I schedule more challenging work during this window next time?`,
          actions: [
            { label: "Yes, give me more", feedbackValue: `Schedule more intense ${task.category} tasks — I can handle more than ${task.durationMinutes}min`, isPositive: true },
            { label: "No, keep it as is", feedbackValue: `Keep ${task.category} task durations at current levels — the buffer is nice`, isPositive: false },
          ],
          priority: 0.8,
          context: `early_finish:${task.category}`,
        });
      }
    }
  }

  // ── 2. SNOOZE PROBE — "Timing or scope?" ──
  // Check both today's snoozed tasks AND chronic snooze records
  for (const task of todayTasks) {
    if (task.snoozedCount && task.snoozedCount >= 3) {
      nudges.push({
        id: `nudge-snooze-${task.id}`,
        type: "snooze_probe",
        message: `I noticed we keep pushing "${task.title}" (snoozed ${task.snoozedCount}x). Is the timing wrong, or is the task too big?`,
        actions: [
          { label: "Wrong time of day", feedbackValue: `"${task.title}" is scheduled at the wrong time — I need it at a different slot`, isPositive: false },
          { label: "Task is too big", feedbackValue: `"${task.title}" needs to be broken into smaller subtasks — it feels overwhelming at ${task.durationMinutes}min`, isPositive: false },
          { label: "Just been busy", feedbackValue: `"${task.title}" snoozes were situational, not a pattern — keep scheduling as-is`, isPositive: true },
        ],
        priority: 1.5,
        context: `snooze_probe:${task.title}`,
      });
    }
  }

  // Also check memory for chronically snoozed tasks not in today's list
  const chronicSnoozes = memory.snoozeRecords.filter((s) => s.snoozeCount >= 3);
  for (const s of chronicSnoozes.slice(0, 2)) {
    const alreadyCovered = nudges.some((n) => n.context.includes(s.taskTitle));
    if (!alreadyCovered) {
      nudges.push({
        id: `nudge-snooze-chronic-${s.taskTitle.replace(/\s+/g, "-").slice(0, 20)}`,
        type: "snooze_probe",
        message: `"${s.taskTitle}" has been snoozed ${s.snoozeCount} times over multiple days. Should I restructure it?`,
        actions: [
          { label: "Break it down", feedbackValue: `Break "${s.taskTitle}" into smaller 15-20min subtasks`, isPositive: true },
          { label: "Move to a different day", feedbackValue: `"${s.taskTitle}" should be on a day when I have more energy`, isPositive: true },
          { label: "Remove it", feedbackValue: `Drop "${s.taskTitle}" — it's not realistic right now`, isPositive: false },
        ],
        priority: 1.8,
        context: `chronic_snooze:${s.taskTitle}`,
      });
    }
  }

  // ── 3. MISSED DEADLINE — Course Correction ──
  const missedMustDos = todayTasks.filter(
    (t) => !t.completed && !t.skipped && t.priority === "must-do"
  );
  // Only trigger if it's late enough in the day that they're likely done
  if (missedMustDos.length > 0 && hour >= 20) {
    const taskNames = missedMustDos.map((t) => `"${t.title}"`).join(", ");
    nudges.push({
      id: `nudge-missed-${now.toISOString().split("T")[0]}`,
      type: "missed_deadline",
      message: `We missed ${missedMustDos.length} must-do task${missedMustDos.length > 1 ? "s" : ""} today: ${taskNames}. Was the plan too ambitious, or did something unexpected come up?`,
      actions: [
        { label: "Too ambitious", feedbackValue: "Today's task load was too heavy — reduce number of must-do tasks", isPositive: false },
        { label: "Something came up", feedbackValue: "Missed tasks were due to unexpected interruption, not bad planning", isPositive: true },
        { label: "Timing was off", feedbackValue: "Tasks were scheduled at bad times — need better time slot allocation", isPositive: false },
      ],
      priority: 1.2,
      context: "missed_must_do_tasks",
    });
  }

  // ── 4. DEAD ZONE Detection — Interaction Friction ──
  // O(1) hourly stats from MemoryManager instead of O(n) signal scans
  const mgr = getManager();
  const hourlyStats = mgr.getHourlyStats(hour);
  const skipsAtCurrentHour = hourlyStats.skipped;
  const completionsAtCurrentHour = hourlyStats.completed;

  if (skipsAtCurrentHour >= 3 && skipsAtCurrentHour > completionsAtCurrentHour * 2) {
    const label = hour < 12 ? "AM" : "PM";
    const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    nudges.push({
      id: `nudge-deadzone-${hour}`,
      type: "dead_zone",
      message: `I've noticed you tend to skip tasks around ${displayHour}${label}. Should I avoid scheduling important work at this time?`,
      actions: [
        { label: "Yes, it's a dead zone", feedbackValue: `${displayHour}${label} is a dead zone — avoid scheduling tasks here`, isPositive: true },
        { label: "No, it's fine", feedbackValue: `${displayHour}${label} is not consistently bad — keep scheduling normally`, isPositive: false },
      ],
      priority: 0.9,
      context: `dead_zone:${hour}`,
    });
  }

  // ── 5. OVERWHELM Detection — too many skips today ──
  const skippedToday = todayTasks.filter((t) => t.skipped).length;
  const snoozedToday = todayTasks.filter((t) => (t.snoozedCount || 0) > 0).length;
  const frictionCount = skippedToday + snoozedToday;

  if (frictionCount >= 3 && todayTasks.length > 0) {
    nudges.push({
      id: `nudge-overwhelm-${now.toISOString().split("T")[0]}`,
      type: "overwhelm",
      message: `Looks like today's load might be too much — you've snoozed or skipped ${frictionCount} tasks. Want me to lighten tomorrow's schedule?`,
      actions: [
        { label: "Yes, lighten it", feedbackValue: "Reduce daily task count — I'm feeling overwhelmed at current levels", isPositive: true },
        { label: "Just a bad day", feedbackValue: "Today was an outlier — keep the normal task load", isPositive: false },
      ],
      priority: 1.6,
      context: "overwhelm_detected",
    });
  }

  // ── 6. STREAK Celebration — Positive Reinforcement ──
  const allCompleted = todayTasks.length > 0 && todayTasks.every((t) => t.completed || t.skipped);
  if (allCompleted && todayTasks.filter((t) => t.completed).length >= 3) {
    // O(1) type-indexed lookup instead of O(n) scan
    const recentCompleted = mgr.getSignalsByType("task_completed").slice(-20);
    const recentDates = [...new Set(recentCompleted.map((s) => s.timestamp.split("T")[0]))];
    if (recentDates.length >= 3) {
      nudges.push({
        id: `nudge-streak-${now.toISOString().split("T")[0]}`,
        type: "streak",
        message: `🔥 You've been crushing it! ${recentDates.length} active days recently. Should I gradually increase the challenge?`,
        actions: [
          { label: "Yes, level up!", feedbackValue: "I'm ready for more challenging tasks and tighter schedules", isPositive: true },
          { label: "Keep current pace", feedbackValue: "Current difficulty is perfect — don't increase the load", isPositive: false },
        ],
        priority: 0.7,
        context: "streak_celebration",
      });
    }
  }

  // ── 7. PROACTIVE QUESTION from reflection ──
  if (proactiveQuestion) {
    nudges.push({
      id: `nudge-proactive-${Date.now()}`,
      type: "proactive",
      message: proactiveQuestion,
      priority: 1.0,
      context: "reflection_proactive",
    });
  }

  // Sort by priority (highest first)
  return nudges.sort((a, b) => b.priority - a.priority);
}

/**
 * Auto-detect if a reflection should be triggered based on signal accumulation.
 * Returns true if enough new signals have accumulated since last reflection.
 * Uses MemoryManager for O(1) type-indexed lookups.
 */
export function shouldAutoReflect(): boolean {
  const mgr = getManager();
  const store = mgr.getStore();
  const since = store.lastReflectionAt || "2020-01-01";
  const recentSignals = store.signals.filter((s) => s.timestamp > since);

  // Trigger conditions:
  // 1. At least 10 new signals since last reflection
  if (recentSignals.length >= 10) return true;

  // 2. OR at least 3 recovery/blocker signals (urgent pattern) — O(1) type lookup
  const recoveries = mgr.getRecentSignalsByType("recovery_triggered", since);
  const blockers = mgr.getRecentSignalsByType("blocker_reported", since);
  if (recoveries.length + blockers.length >= 3) return true;

  // 3. OR it's been more than 7 days since last reflection and there are >= 5 signals
  if (store.lastReflectionAt) {
    const daysSince = (Date.now() - new Date(store.lastReflectionAt).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince >= 7 && recentSignals.length >= 5) return true;
  } else if (recentSignals.length >= 5) {
    return true; // Never reflected before and have 5+ signals
  }

  return false;
}
