/* NorthStar backend — reflection engine (slice 3b)
 *
 * Postgres-backed port of frontend/electron/reflection.ts:
 *   - runReflection: Haiku call → upsert facts/preferences for one user
 *   - shouldAutoReflect: signal-accumulation heuristic, async
 *   - generateNudges: 7-rule contextual probe engine over today's tasks
 *
 * Differences from the Electron original:
 *   - Everything is async + per-user (takes userId, queries Postgres directly)
 *   - upsertFact/upsertPreference INSERT or UPDATE memory_facts /
 *     memory_preferences scoped by user_id; no global MemoryManager
 *   - No quickReflect / captureSignal here — those already live in
 *     routes/memory.ts as the slice-2 thin port
 *
 * The REFLECTION_SYSTEM prompt and the 7 nudge rules are byte-identical
 * to the Electron source so cloud + local installs produce the same
 * insights for the same signals.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { query } from "./db/pool";
import { getModelForTask } from "@northstar/core";
import {
  loadMemory,
  type FactCategory,
  type LongTermFact,
  type SemanticPreference,
  type MemoryStore,
} from "./memory";

export type { MemoryStore };

// ── Reflection System Prompt ────────────────────────────
// Verbatim copy of frontend/electron/reflection.ts REFLECTION_SYSTEM.

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
- tags should include day names, time-of-day words, and category names when relevant

SYSTEM HEALTH SIGNALS:
You may also receive system-level signals (not direct user actions). Analyze them the same way:
- agent_fallback: An AI sub-agent failed and we used default values. Multiple occurrences → generate a fact with category "constraint" about AI reliability issues and suggest simpler task structures.
- ai_parse_error: AI response couldn't be parsed. → generate a calibration noting prompt/model mismatch for that handler.
- overload_detected: Daily cognitive load exceeded the budget. Frequent occurrences → generate a fact with category "capacity" suggesting the user's max daily tasks or weight setting may be too high.
- estimation_error: Task duration deviated >50% from estimate. → generate a calibration for that task's category to improve future estimates.`;

// ── Upsert helpers ──────────────────────────────────────

/**
 * Insert or bump a LongTermFact for this user.
 *
 * Mirrors frontend/electron/memory.ts upsertFact: if a fact with the same
 * (category, key) already exists, bump confidence by 0.15 (cap 1), refresh
 * value, append new evidence (capped at 10 items, deduped), and update
 * updated_at. Otherwise INSERT a fresh row at confidence 0.3.
 *
 * Mutates `existingFacts` in place so subsequent upserts in the same
 * reflection see the updated state without re-querying Postgres.
 */
async function upsertFact(
  userId: string,
  existingFacts: LongTermFact[],
  category: FactCategory,
  key: string,
  value: string,
  evidence: string,
  source: LongTermFact["source"],
): Promise<void> {
  const now = new Date().toISOString();
  const existing = existingFacts.find(
    (f) => f.category === category && f.key === key,
  );

  if (existing) {
    const newConfidence = Math.min(1, existing.confidence + 0.15);
    const newEvidence = Array.from(
      new Set([...existing.evidence, evidence]),
    ).slice(-10);
    await query(
      `update memory_facts
          set value = $1,
              confidence = $2,
              evidence = $3::jsonb,
              updated_at = now()
        where user_id = $4 and category = $5 and key = $6`,
      [value, newConfidence, JSON.stringify(newEvidence), userId, category, key],
    );
    existing.value = value;
    existing.confidence = newConfidence;
    existing.evidence = newEvidence;
    existing.updatedAt = now;
    return;
  }

  const id = `fact-${randomUUID()}`;
  await query(
    `insert into memory_facts
        (id, user_id, category, key, value, confidence, evidence, source, created_at, updated_at)
      values
        ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, now(), now())`,
    [
      id,
      userId,
      category,
      key,
      value,
      0.3,
      JSON.stringify([evidence]),
      source,
    ],
  );
  existingFacts.push({
    id,
    category,
    key,
    value,
    confidence: 0.3,
    evidence: [evidence],
    source,
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * Insert or merge a SemanticPreference for this user.
 *
 * Mirrors frontend/electron/memory.ts upsertPreference: looks for an
 * existing pref whose tag overlap with the new pref's tags is at least
 * min(2, |tags|). On match, blend weights with EMA (0.7 old + 0.3 new),
 * bump frequency, append example (cap 8). Otherwise INSERT fresh.
 *
 * Mutates `existingPrefs` in place for the same in-reflection consistency
 * reason as upsertFact.
 */
async function upsertPreference(
  userId: string,
  existingPrefs: SemanticPreference[],
  text: string,
  tags: string[],
  weight: number,
  example: string,
): Promise<void> {
  const now = new Date().toISOString();
  const overlapThreshold = Math.min(2, tags.length);

  let best: SemanticPreference | null = null;
  let bestOverlap = 0;
  for (const p of existingPrefs) {
    const overlap = p.tags.filter((t) => tags.includes(t)).length;
    if (overlap >= overlapThreshold && overlap > bestOverlap) {
      best = p;
      bestOverlap = overlap;
    }
  }

  if (best) {
    const newWeight = best.weight * 0.7 + weight * 0.3;
    const newExamples = example
      ? [...best.examples, example].slice(-8)
      : best.examples;
    const mergedTags = Array.from(new Set([...best.tags, ...tags]));
    await query(
      `update memory_preferences
          set text = $1,
              tags = $2::jsonb,
              weight = $3,
              frequency = frequency + 1,
              examples = $4::jsonb,
              updated_at = now()
        where user_id = $5 and id = $6`,
      [
        text,
        JSON.stringify(mergedTags),
        newWeight,
        JSON.stringify(newExamples),
        userId,
        best.id,
      ],
    );
    best.text = text;
    best.tags = mergedTags;
    best.weight = newWeight;
    best.frequency += 1;
    best.examples = newExamples;
    best.updatedAt = now;
    return;
  }

  const id = `pref-${randomUUID()}`;
  const examples = example ? [example] : [];
  await query(
    `insert into memory_preferences
        (id, user_id, text, tags, weight, frequency, examples, created_at, updated_at)
      values
        ($1, $2, $3, $4::jsonb, $5, $6, $7::jsonb, now(), now())`,
    [
      id,
      userId,
      text,
      JSON.stringify(tags),
      weight,
      1,
      JSON.stringify(examples),
    ],
  );
  existingPrefs.push({
    id,
    text,
    tags,
    weight,
    frequency: 1,
    examples,
    createdAt: now,
    updatedAt: now,
  });
}

/** Bump memory_meta.last_reflection_at + reflection_count for this user. */
async function bumpReflectionMeta(userId: string): Promise<void> {
  await query(
    `insert into memory_meta (user_id, last_reflection_at, reflection_count, version)
       values ($1, now(), 1, 1)
     on conflict (user_id) do update
        set last_reflection_at = now(),
            reflection_count = memory_meta.reflection_count + 1`,
    [userId],
  );
}

// ── runReflection ───────────────────────────────────────

/**
 * Run the full reflection loop for a user.
 *
 * Loads their memory, filters signals since the last reflection (or all
 * time on first run), bails if fewer than 3 new signals, otherwise sends
 * them to Haiku with the REFLECTION_SYSTEM prompt and upserts the
 * extracted facts + preferences.
 *
 * Async port of frontend/electron/reflection.ts runReflection — same
 * data shape, same prompt construction, same return envelope.
 */
export async function runReflection(
  client: Anthropic,
  userId: string,
  triggerContext: string,
): Promise<{
  success: boolean;
  newInsights: number;
  proactiveQuestion: string | null;
}> {
  const memory = await loadMemory(userId);

  const sinceDate = memory.lastReflectionAt || "2020-01-01";
  const recentSignals = memory.signals.filter((s) => s.timestamp > sinceDate);

  if (recentSignals.length < 3) {
    return { success: true, newInsights: 0, proactiveQuestion: null };
  }

  const snoozeData = memory.snoozeRecords.filter(
    (s) => s.lastSnoozed > sinceDate,
  );
  const timingData = memory.taskTimings.filter(
    (t) => t.date > sinceDate.split("T")[0],
  );

  const dayNames = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  const dayBreakdown: Record<
    string,
    { completed: number; skipped: number; snoozed: number }
  > = {};
  for (const s of recentSignals) {
    const day = dayNames[new Date(s.timestamp).getDay()];
    if (!dayBreakdown[day])
      dayBreakdown[day] = { completed: 0, skipped: 0, snoozed: 0 };
    if (s.type === "task_completed" || s.type === "task_completed_early")
      dayBreakdown[day].completed++;
    if (s.type === "task_skipped") dayBreakdown[day].skipped++;
    if (s.type === "task_snoozed") dayBreakdown[day].snoozed++;
  }

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
  memory.facts.map((f) => ({
    category: f.category,
    key: f.key,
    value: f.value,
    confidence: f.confidence,
  })),
  null,
  2,
)}

EXISTING PREFERENCES (for reference):
${JSON.stringify(
  memory.preferences.map((p) => ({
    text: p.text,
    weight: p.weight,
    frequency: p.frequency,
    tags: p.tags,
  })),
  null,
  2,
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
      model: getModelForTask("reflection"),
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
    // Haiku occasionally appends commentary after the JSON object — slice
    // to the matching closing brace before parsing.
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    const jsonText =
      firstBrace >= 0 && lastBrace > firstBrace
        ? cleaned.slice(firstBrace, lastBrace + 1)
        : cleaned;
    const result = JSON.parse(jsonText);

    let insightCount = 0;

    if (Array.isArray(result.facts)) {
      for (const fact of result.facts) {
        await upsertFact(
          userId,
          memory.facts,
          fact.category as FactCategory,
          fact.key,
          fact.value,
          fact.evidence,
          "reflection",
        );
        insightCount++;
      }
    }

    if (Array.isArray(result.preferences)) {
      for (const pref of result.preferences) {
        await upsertPreference(
          userId,
          memory.preferences,
          pref.text,
          pref.tags || [],
          pref.weight || 0,
          pref.example || "",
        );
        insightCount++;
      }
    }

    await bumpReflectionMeta(userId);

    return {
      success: true,
      newInsights: insightCount,
      proactiveQuestion: result.proactive_question || null,
    };
  } catch (err) {
    console.error("[reflection] runReflection failed:", err);
    return { success: false, newInsights: 0, proactiveQuestion: null };
  }
}

// ── shouldAutoReflect ───────────────────────────────────

/**
 * Decide whether enough new signals have piled up to justify firing a
 * reflection. Async port of frontend/electron/reflection.ts shouldAutoReflect.
 *
 * Triggers if any of:
 *   1. ≥10 new signals since last reflection
 *   2. ≥3 recovery_triggered + blocker_reported signals (urgent pattern)
 *   3. >7 days since last reflection AND ≥5 signals
 *   4. Never reflected before AND ≥5 signals
 */
export async function shouldAutoReflect(userId: string): Promise<boolean> {
  const memory = await loadMemory(userId);
  const since = memory.lastReflectionAt || "2020-01-01";
  const recentSignals = memory.signals.filter((s) => s.timestamp > since);

  if (recentSignals.length >= 10) return true;

  const urgentCount = recentSignals.filter(
    (s) => s.type === "recovery_triggered" || s.type === "blocker_reported",
  ).length;
  if (urgentCount >= 3) return true;

  if (memory.lastReflectionAt) {
    const daysSince =
      (Date.now() - new Date(memory.lastReflectionAt).getTime()) /
      (1000 * 60 * 60 * 24);
    if (daysSince >= 7 && recentSignals.length >= 5) return true;
  } else if (recentSignals.length >= 5) {
    return true;
  }

  return false;
}

// ── generateNudges ──────────────────────────────────────

export interface NudgeResult {
  id: string;
  type:
    | "early_finish"
    | "snooze_probe"
    | "missed_deadline"
    | "dead_zone"
    | "overwhelm"
    | "streak"
    | "proactive";
  message: string;
  actions?: Array<{
    label: string;
    feedbackValue: string;
    isPositive: boolean;
  }>;
  priority: number;
  context: string;
}

export interface NudgeTask {
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
}

/**
 * Generate contextual nudges for a user based on today's task state +
 * their accumulated signals. 7-rule engine ported verbatim from
 * frontend/electron/reflection.ts generateNudges.
 *
 * Async because it needs to loadMemory(userId) — there is no global
 * MemoryManager on the server.
 */
export async function generateNudges(
  userId: string,
  todayTasks: NudgeTask[],
  proactiveQuestion: string | null = null,
): Promise<NudgeResult[]> {
  const nudges: NudgeResult[] = [];
  const memory = await loadMemory(userId);
  const now = new Date();
  const hour = now.getHours();

  // ── 1. EARLY FINISH ──
  for (const task of todayTasks) {
    if (task.completed && task.actualMinutes && task.durationMinutes) {
      const savedMinutes = task.durationMinutes - task.actualMinutes;
      if (savedMinutes >= 10) {
        nudges.push({
          id: `nudge-early-${task.id}`,
          type: "early_finish",
          message: `You finished "${task.title}" ${savedMinutes} minutes early! Should I schedule more challenging work during this window next time?`,
          actions: [
            {
              label: "Yes, give me more",
              feedbackValue: `Schedule more intense ${task.category} tasks — I can handle more than ${task.durationMinutes}min`,
              isPositive: true,
            },
            {
              label: "No, keep it as is",
              feedbackValue: `Keep ${task.category} task durations at current levels — the buffer is nice`,
              isPositive: false,
            },
          ],
          priority: 0.8,
          context: `early_finish:${task.category}`,
        });
      }
    }
  }

  // ── 2. SNOOZE PROBE ──
  for (const task of todayTasks) {
    if (task.snoozedCount && task.snoozedCount >= 3) {
      nudges.push({
        id: `nudge-snooze-${task.id}`,
        type: "snooze_probe",
        message: `I noticed we keep pushing "${task.title}" (snoozed ${task.snoozedCount}x). Is the timing wrong, or is the task too big?`,
        actions: [
          {
            label: "Wrong time of day",
            feedbackValue: `"${task.title}" is scheduled at the wrong time — I need it at a different slot`,
            isPositive: false,
          },
          {
            label: "Task is too big",
            feedbackValue: `"${task.title}" needs to be broken into smaller subtasks — it feels overwhelming at ${task.durationMinutes}min`,
            isPositive: false,
          },
          {
            label: "Just been busy",
            feedbackValue: `"${task.title}" snoozes were situational, not a pattern — keep scheduling as-is`,
            isPositive: true,
          },
        ],
        priority: 1.5,
        context: `snooze_probe:${task.title}`,
      });
    }
  }

  const chronicSnoozes = memory.snoozeRecords.filter((s) => s.snoozeCount >= 3);
  for (const s of chronicSnoozes.slice(0, 2)) {
    const alreadyCovered = nudges.some((n) => n.context.includes(s.taskTitle));
    if (!alreadyCovered) {
      nudges.push({
        id: `nudge-snooze-chronic-${s.taskTitle.replace(/\s+/g, "-").slice(0, 20)}`,
        type: "snooze_probe",
        message: `"${s.taskTitle}" has been snoozed ${s.snoozeCount} times over multiple days. Should I restructure it?`,
        actions: [
          {
            label: "Break it down",
            feedbackValue: `Break "${s.taskTitle}" into smaller 15-20min subtasks`,
            isPositive: true,
          },
          {
            label: "Move to a different day",
            feedbackValue: `"${s.taskTitle}" should be on a day when I have more energy`,
            isPositive: true,
          },
          {
            label: "Remove it",
            feedbackValue: `Drop "${s.taskTitle}" — it's not realistic right now`,
            isPositive: false,
          },
        ],
        priority: 1.8,
        context: `chronic_snooze:${s.taskTitle}`,
      });
    }
  }

  // ── 3. MISSED DEADLINE ──
  const missedMustDos = todayTasks.filter(
    (t) => !t.completed && !t.skipped && t.priority === "must-do",
  );
  if (missedMustDos.length > 0 && hour >= 20) {
    const taskNames = missedMustDos.map((t) => `"${t.title}"`).join(", ");
    nudges.push({
      id: `nudge-missed-${now.toISOString().split("T")[0]}`,
      type: "missed_deadline",
      message: `We missed ${missedMustDos.length} must-do task${missedMustDos.length > 1 ? "s" : ""} today: ${taskNames}. Was the plan too ambitious, or did something unexpected come up?`,
      actions: [
        {
          label: "Too ambitious",
          feedbackValue:
            "Today's task load was too heavy — reduce number of must-do tasks",
          isPositive: false,
        },
        {
          label: "Something came up",
          feedbackValue:
            "Missed tasks were due to unexpected interruption, not bad planning",
          isPositive: true,
        },
        {
          label: "Timing was off",
          feedbackValue:
            "Tasks were scheduled at bad times — need better time slot allocation",
          isPositive: false,
        },
      ],
      priority: 1.2,
      context: "missed_must_do_tasks",
    });
  }

  // ── 4. DEAD ZONE ──
  // Compute hourly stats inline from signals (no MemoryManager on the server).
  let skipsAtCurrentHour = 0;
  let completionsAtCurrentHour = 0;
  for (const sig of memory.signals) {
    const sigHour = new Date(sig.timestamp).getHours();
    if (sigHour !== hour) continue;
    if (sig.type === "task_skipped") skipsAtCurrentHour++;
    else if (
      sig.type === "task_completed" ||
      sig.type === "task_completed_early" ||
      sig.type === "task_completed_late"
    )
      completionsAtCurrentHour++;
  }

  if (
    skipsAtCurrentHour >= 3 &&
    skipsAtCurrentHour > completionsAtCurrentHour * 2
  ) {
    const label = hour < 12 ? "AM" : "PM";
    const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    nudges.push({
      id: `nudge-deadzone-${hour}`,
      type: "dead_zone",
      message: `I've noticed you tend to skip tasks around ${displayHour}${label}. Should I avoid scheduling important work at this time?`,
      actions: [
        {
          label: "Yes, it's a dead zone",
          feedbackValue: `${displayHour}${label} is a dead zone — avoid scheduling tasks here`,
          isPositive: true,
        },
        {
          label: "No, it's fine",
          feedbackValue: `${displayHour}${label} is not consistently bad — keep scheduling normally`,
          isPositive: false,
        },
      ],
      priority: 0.9,
      context: `dead_zone:${hour}`,
    });
  }

  // ── 5. OVERWHELM ──
  const skippedToday = todayTasks.filter((t) => t.skipped).length;
  const snoozedToday = todayTasks.filter((t) => (t.snoozedCount || 0) > 0)
    .length;
  const frictionCount = skippedToday + snoozedToday;

  if (frictionCount >= 3 && todayTasks.length > 0) {
    nudges.push({
      id: `nudge-overwhelm-${now.toISOString().split("T")[0]}`,
      type: "overwhelm",
      message: `Looks like today's load might be too much — you've snoozed or skipped ${frictionCount} tasks. Want me to lighten tomorrow's schedule?`,
      actions: [
        {
          label: "Yes, lighten it",
          feedbackValue:
            "Reduce daily task count — I'm feeling overwhelmed at current levels",
          isPositive: true,
        },
        {
          label: "Just a bad day",
          feedbackValue: "Today was an outlier — keep the normal task load",
          isPositive: false,
        },
      ],
      priority: 1.6,
      context: "overwhelm_detected",
    });
  }

  // ── 6. STREAK ──
  const allCompleted =
    todayTasks.length > 0 &&
    todayTasks.every((t) => t.completed || t.skipped);
  if (allCompleted && todayTasks.filter((t) => t.completed).length >= 3) {
    const recentCompleted = memory.signals
      .filter((s) => s.type === "task_completed")
      .slice(-20);
    const recentDates = [
      ...new Set(recentCompleted.map((s) => s.timestamp.split("T")[0])),
    ];
    if (recentDates.length >= 3) {
      nudges.push({
        id: `nudge-streak-${now.toISOString().split("T")[0]}`,
        type: "streak",
        message: `🔥 You've been crushing it! ${recentDates.length} active days recently. Should I gradually increase the challenge?`,
        actions: [
          {
            label: "Yes, level up!",
            feedbackValue:
              "I'm ready for more challenging tasks and tighter schedules",
            isPositive: true,
          },
          {
            label: "Keep current pace",
            feedbackValue:
              "Current difficulty is perfect — don't increase the load",
            isPositive: false,
          },
        ],
        priority: 0.7,
        context: "streak_celebration",
      });
    }
  }

  // ── 7. PROACTIVE ──
  if (proactiveQuestion) {
    nudges.push({
      id: `nudge-proactive-${Date.now()}`,
      type: "proactive",
      message: proactiveQuestion,
      priority: 1.0,
      context: "reflection_proactive",
    });
  }

  return nudges.sort((a, b) => b.priority - a.priority);
}
