/* NorthStar backend — memory module (slice 3a)
 *
 * Phase 1b/slice 3a: replaces the empty stub with real Postgres-backed
 * loading + a faithful port of buildMemoryContext / computeCapacityProfile
 * from frontend/electron/memory.ts.
 *
 * What this enables: cloud AI handlers (daily-tasks, recovery, planning, ...)
 * now consume the user's actual signals/snoozes/timings written by the
 * slice 2 routes. Captured behavior shapes generated plans.
 *
 * What's still deferred to slice 3b:
 *   - runReflection (the AI call that turns signals into LongTermFacts)
 *   - generateNudges, shouldAutoReflect, behavior profile editing
 *
 * For now: facts/preferences in the cloud are read-only and only get
 * populated when the local Electron reflection writes through to Postgres.
 * Until that wires up, the cloud sees facts=[] preferences=[] but still
 * uses signals/snoozes/timings — which is enough for capacity profile +
 * behavioral pattern detection.
 *
 * Types and function signatures intentionally MIRROR
 * frontend/electron/memory.ts so handlers that import from here typecheck
 * unchanged.
 */

import { query } from "./db/pool";

// ── Types ────────────────────────────────────────────────
export type FactCategory =
  | "schedule"
  | "preference"
  | "capacity"
  | "motivation"
  | "pattern"
  | "constraint"
  | "strength"
  | "struggle";

export interface LongTermFact {
  id: string;
  category: FactCategory;
  key: string;
  value: string;
  confidence: number;
  evidence: string[];
  createdAt: string;
  updatedAt: string;
  source: "reflection" | "explicit" | "behavioral";
}

export interface SemanticPreference {
  id: string;
  text: string;
  tags: string[];
  weight: number;
  frequency: number;
  examples: string[];
  createdAt: string;
  updatedAt: string;
}

export type SignalType =
  | "task_completed"
  | "task_snoozed"
  | "task_skipped"
  | "task_completed_early"
  | "task_completed_late"
  | "recovery_triggered"
  | "blocker_reported"
  | "schedule_override"
  | "positive_feedback"
  | "negative_feedback"
  | "session_time"
  | "high_energy_window"
  | "low_energy_window"
  | "chat_insight";

export interface BehavioralSignal {
  id: string;
  type: SignalType;
  context: string;
  value: string;
  timestamp: string;
}

export interface SnoozeRecord {
  taskTitle: string;
  taskCategory: string;
  snoozeCount: number;
  originalDate: string;
  lastSnoozed: string;
}

export interface TaskTimingRecord {
  taskCategory: string;
  taskKeywords: string[];
  estimatedMinutes: number;
  actualMinutes: number;
  date: string;
}

export interface MemoryStore {
  facts: LongTermFact[];
  preferences: SemanticPreference[];
  signals: BehavioralSignal[];
  snoozeRecords: SnoozeRecord[];
  taskTimings: TaskTimingRecord[];
  lastReflectionAt: string | null;
  reflectionCount: number;
  version: number;
}

const EMPTY_MEMORY: MemoryStore = {
  facts: [],
  preferences: [],
  signals: [],
  snoozeRecords: [],
  taskTimings: [],
  lastReflectionAt: null,
  reflectionCount: 0,
  version: 1,
};

// ── Loader ───────────────────────────────────────────────
/**
 * Load the user's MemoryStore from Postgres. Async — must be awaited.
 *
 * Reads all 5 memory_* tables in parallel and assembles them into the
 * shape the prompt builders expect. Errors return EMPTY_MEMORY rather
 * than throwing so a transient DB blip doesn't crash an AI request.
 */
export async function loadMemory(userId: string): Promise<MemoryStore> {
  try {
    const [facts, prefs, signals, snoozes, timings, meta] = await Promise.all([
      query<{
        id: string;
        category: FactCategory;
        key: string;
        value: string;
        confidence: number;
        evidence: unknown;
        source: LongTermFact["source"];
        created_at: string;
        updated_at: string;
      }>(
        `select id, category, key, value, confidence, evidence, source,
                created_at, updated_at
           from memory_facts
          where user_id = $1`,
        [userId],
      ),
      query<{
        id: string;
        text: string;
        tags: unknown;
        weight: number;
        frequency: number;
        examples: unknown;
        created_at: string;
        updated_at: string;
      }>(
        `select id, text, tags, weight, frequency, examples, created_at, updated_at
           from memory_preferences
          where user_id = $1`,
        [userId],
      ),
      query<{
        id: string;
        type: SignalType;
        context: string;
        value: string;
        timestamp: string;
      }>(
        `select id, type, context, value, timestamp
           from memory_signals
          where user_id = $1
          order by timestamp asc`,
        [userId],
      ),
      query<{
        task_title: string;
        task_category: string;
        snooze_count: number;
        original_date: string;
        last_snoozed: string;
      }>(
        `select task_title, task_category, snooze_count, original_date, last_snoozed
           from memory_snooze_records
          where user_id = $1`,
        [userId],
      ),
      query<{
        task_category: string;
        task_keywords: unknown;
        estimated_minutes: number;
        actual_minutes: number;
        date: string;
      }>(
        `select task_category, task_keywords, estimated_minutes, actual_minutes, date
           from memory_task_timings
          where user_id = $1
          order by date asc`,
        [userId],
      ),
      query<{
        last_reflection_at: string | null;
        reflection_count: number;
        version: number;
      }>(
        `select last_reflection_at, reflection_count, version
           from memory_meta
          where user_id = $1`,
        [userId],
      ),
    ]);

    const toIso = (v: unknown): string =>
      typeof v === "string" ? v : new Date(v as string | number).toISOString();
    const toArr = <T>(v: unknown): T[] =>
      Array.isArray(v) ? (v as T[]) : typeof v === "string" ? (JSON.parse(v) as T[]) : [];

    return {
      facts: facts.map((f) => ({
        id: f.id,
        category: f.category,
        key: f.key,
        value: f.value,
        confidence: f.confidence,
        evidence: toArr<string>(f.evidence),
        source: f.source,
        createdAt: toIso(f.created_at),
        updatedAt: toIso(f.updated_at),
      })),
      preferences: prefs.map((p) => ({
        id: p.id,
        text: p.text,
        tags: toArr<string>(p.tags),
        weight: p.weight,
        frequency: p.frequency,
        examples: toArr<string>(p.examples),
        createdAt: toIso(p.created_at),
        updatedAt: toIso(p.updated_at),
      })),
      signals: signals.map((s) => ({
        id: s.id,
        type: s.type,
        context: s.context,
        value: s.value,
        timestamp: toIso(s.timestamp),
      })),
      snoozeRecords: snoozes.map((r) => ({
        taskTitle: r.task_title,
        taskCategory: r.task_category,
        snoozeCount: r.snooze_count,
        originalDate: r.original_date,
        lastSnoozed: toIso(r.last_snoozed),
      })),
      taskTimings: timings.map((t) => ({
        taskCategory: t.task_category,
        taskKeywords: toArr<string>(t.task_keywords),
        estimatedMinutes: t.estimated_minutes,
        actualMinutes: t.actual_minutes,
        date: t.date,
      })),
      lastReflectionAt: meta[0]?.last_reflection_at ?? null,
      reflectionCount: meta[0]?.reflection_count ?? 0,
      version: meta[0]?.version ?? 1,
    };
  } catch (err) {
    console.warn("[memory] loadMemory failed, using empty:", err);
    return EMPTY_MEMORY;
  }
}

// ── Capacity profile ─────────────────────────────────────
export interface CapacityProfile {
  capacityBudget: number;
  recentCompletionRate: number;
  avgTasksCompletedPerDay: number;
  avgTasksAssignedPerDay: number;
  dayOfWeekModifier: number;
  overwhelmDays: number;
  trend: "improving" | "declining" | "stable";
  isNewUser: boolean;
  chronicSnoozePatterns: string[];
  monthlyContextApplied?: boolean;
  maxDailyTasks?: number;
}

/**
 * Compute the user's capacity profile from logs + signals. Ported from
 * frontend/electron/memory.ts (computeCapacityProfile). Same logic, but
 * pulls signals from the passed-in MemoryStore instead of a global
 * MemoryManager.
 */
export function computeCapacityProfile(
  memory: MemoryStore,
  dailyLogs: Array<{
    date: string;
    tasks: Array<{ completed: boolean; skipped?: boolean }>;
  }>,
  todayDayOfWeek: number,
  monthlyContext?: { capacityMultiplier: number; maxDailyTasks: number } | null,
): CapacityProfile {
  const DEFAULT_BUDGET = 10;

  const newUser = (): CapacityProfile => {
    const profile: CapacityProfile = {
      capacityBudget: DEFAULT_BUDGET,
      recentCompletionRate: -1,
      avgTasksCompletedPerDay: 0,
      avgTasksAssignedPerDay: 0,
      dayOfWeekModifier: 0,
      overwhelmDays: 0,
      trend: "stable",
      isNewUser: true,
      chronicSnoozePatterns: [],
    };
    if (monthlyContext) {
      profile.capacityBudget = Math.max(
        4,
        Math.min(12, Math.round(profile.capacityBudget * monthlyContext.capacityMultiplier)),
      );
      profile.maxDailyTasks = monthlyContext.maxDailyTasks;
      profile.monthlyContextApplied = true;
    }
    return profile;
  };

  if (!dailyLogs || dailyLogs.length === 0) return newUser();

  const recentLogs = dailyLogs
    .filter((l) => Date.now() - new Date(l.date).getTime() <= 14 * 24 * 60 * 60 * 1000)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (recentLogs.length === 0) return newUser();

  let totalAssigned = 0;
  let totalCompleted = 0;
  let overwhelmDays = 0;
  for (const log of recentLogs) {
    const assigned = log.tasks.length;
    const completed = log.tasks.filter((t) => t.completed).length;
    const skipped = log.tasks.filter((t) => t.skipped || !t.completed).length;
    totalAssigned += assigned;
    totalCompleted += completed;
    if (skipped >= 3) overwhelmDays++;
  }
  const recentCompletionRate =
    totalAssigned > 0 ? Math.round((totalCompleted / totalAssigned) * 100) : -1;
  const avgAssigned = totalAssigned / recentLogs.length;
  const avgCompleted = totalCompleted / recentLogs.length;

  // Trend
  let trend: "improving" | "declining" | "stable" = "stable";
  if (recentLogs.length >= 4) {
    const mid = Math.floor(recentLogs.length / 2);
    const first = recentLogs.slice(0, mid);
    const second = recentLogs.slice(mid);
    const rate = (logs: typeof recentLogs) =>
      logs.reduce((s, l) => {
        const c = l.tasks.filter((t) => t.completed).length;
        return s + (l.tasks.length > 0 ? c / l.tasks.length : 0);
      }, 0) / logs.length;
    const firstRate = rate(first);
    const secondRate = rate(second);
    if (secondRate - firstRate > 0.1) trend = "improving";
    else if (firstRate - secondRate > 0.1) trend = "declining";
  }

  // Day-of-week modifier from signals
  let dayCompleted = 0;
  let dayTotal = 0;
  for (const s of memory.signals) {
    if (
      !["task_completed", "task_completed_early", "task_skipped", "task_snoozed"].includes(
        s.type,
      )
    )
      continue;
    if (new Date(s.timestamp).getDay() !== todayDayOfWeek) continue;
    dayTotal++;
    if (s.type === "task_completed" || s.type === "task_completed_early") dayCompleted++;
  }
  let dayOfWeekModifier = 0;
  if (dayTotal >= 5) {
    const r = dayCompleted / dayTotal;
    if (r >= 0.85) dayOfWeekModifier = 1;
    else if (r <= 0.4) dayOfWeekModifier = -2;
    else if (r <= 0.55) dayOfWeekModifier = -1;
  }

  // Capacity budget (6-12)
  let budget = DEFAULT_BUDGET;
  if (recentCompletionRate >= 0) {
    if (recentCompletionRate < 40) budget = 6;
    else if (recentCompletionRate < 60) budget = 8;
    else if (recentCompletionRate < 75) budget = 9;
    else if (recentCompletionRate < 85) budget = 10;
    else if (recentCompletionRate < 95) budget = 11;
    else budget = 12;
  }
  if (overwhelmDays >= 3) budget = Math.max(6, budget - 2);
  else if (overwhelmDays >= 1) budget = Math.max(6, budget - 1);
  if (trend === "declining") budget = Math.max(6, budget - 1);
  else if (trend === "improving" && budget < 12) budget = Math.min(12, budget + 1);
  budget = Math.max(6, Math.min(12, budget + dayOfWeekModifier));

  // Chronic snooze patterns from signals (last 14 days)
  const chronicSnoozePatterns: string[] = [];
  const snoozeCounts = new Map<string, number>();
  for (const s of memory.signals) {
    if (s.type !== "task_snoozed") continue;
    if (Date.now() - new Date(s.timestamp).getTime() > 14 * 24 * 60 * 60 * 1000) continue;
    const key = s.context || s.value || "unknown";
    snoozeCounts.set(key, (snoozeCounts.get(key) || 0) + 1);
  }
  for (const [key, count] of snoozeCounts) {
    if (count >= 3) chronicSnoozePatterns.push(key);
  }

  let monthlyContextApplied = false;
  let maxDailyTasks: number | undefined;
  if (monthlyContext) {
    budget = Math.max(4, Math.min(12, Math.round(budget * monthlyContext.capacityMultiplier)));
    maxDailyTasks = monthlyContext.maxDailyTasks;
    monthlyContextApplied = true;
  }

  return {
    capacityBudget: budget,
    recentCompletionRate,
    avgTasksCompletedPerDay: Math.round(avgCompleted * 10) / 10,
    avgTasksAssignedPerDay: Math.round(avgAssigned * 10) / 10,
    dayOfWeekModifier,
    overwhelmDays,
    trend,
    isNewUser: false,
    chronicSnoozePatterns,
    monthlyContextApplied,
    maxDailyTasks,
  };
}

// ── Memory context builder ───────────────────────────────
const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function isWithinDays(dateStr: string, days: number): boolean {
  return Date.now() - new Date(dateStr).getTime() <= days * 24 * 60 * 60 * 1000;
}

function getAllHighConfidenceFacts(memory: MemoryStore): LongTermFact[] {
  return memory.facts
    .filter((f) => f.confidence >= 0.4)
    .sort((a, b) => b.confidence - a.confidence);
}

/**
 * Build a feedback timeline of recent micro-adjustments. Mirrors
 * buildFeedbackTimeline in electron/memory.ts (without the indexed
 * signal lookups — we just iterate, n is small).
 */
function buildFeedbackTimeline(memory: MemoryStore, contextType: string, maxEntries = 12): string[] {
  const entries: Array<{ date: string; text: string; priority: number }> = [];

  // 1. Recent facts
  const recentFacts = memory.facts
    .filter((f) => f.confidence >= 0.3)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 15);
  for (const f of recentFacts) {
    const date = f.updatedAt.split("T")[0];
    const isRecent = isWithinDays(f.updatedAt, 14);
    if (!isRecent && entries.length >= 6) continue;
    let priority = f.confidence;
    if (isRecent) priority += 0.5;
    if (contextType === "daily" && ["schedule", "pattern", "preference"].includes(f.category))
      priority += 0.3;
    if (
      contextType === "recovery" &&
      ["struggle", "motivation", "constraint"].includes(f.category)
    )
      priority += 0.3;
    if (contextType === "planning" && ["capacity", "schedule", "constraint"].includes(f.category))
      priority += 0.3;
    entries.push({ date, text: `Feedback Update (${date}): ${f.value}`, priority });
  }

  // 2. Recent feedback signals
  const feedbackSignals = memory.signals
    .filter((s) => s.type === "positive_feedback" || s.type === "negative_feedback")
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, 8);
  for (const s of feedbackSignals) {
    const date = s.timestamp.split("T")[0];
    const sentiment = s.type === "positive_feedback" ? "User liked" : "User disliked";
    entries.push({
      date,
      text: `Feedback Update (${date}): ${sentiment}: ${s.value} (context: ${s.context})`,
      priority: 1.5,
    });
  }

  // 3. Recent blocker reports
  const blockerSignals = memory.signals
    .filter((s) => s.type === "blocker_reported")
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, 5);
  for (const s of blockerSignals) {
    const date = s.timestamp.split("T")[0];
    entries.push({
      date,
      text: `Feedback Update (${date}): User reported blocker — "${s.context}": ${s.value}`,
      priority: contextType === "recovery" ? 2.0 : 1.0,
    });
  }

  // 4. Recent preference changes
  const recentPrefs = memory.preferences
    .filter((p) => isWithinDays(p.updatedAt, 14) && p.frequency >= 2)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 5);
  for (const p of recentPrefs) {
    const date = p.updatedAt.split("T")[0];
    const direction = p.weight > 0.3 ? "prefers" : p.weight < -0.3 ? "avoids" : "is neutral on";
    entries.push({
      date,
      text: `Feedback Update (${date}): User ${direction}: ${p.text}`,
      priority: 0.8 + Math.abs(p.weight),
    });
  }

  // 5. Snooze patterns
  const recentSnoozes = memory.snoozeRecords
    .filter((s) => isWithinDays(s.lastSnoozed, 7) && s.snoozeCount >= 2)
    .sort((a, b) => b.snoozeCount - a.snoozeCount)
    .slice(0, 3);
  for (const s of recentSnoozes) {
    const date = s.lastSnoozed.split("T")[0];
    entries.push({
      date,
      text: `Feedback Update (${date}): User has snoozed "${s.taskTitle}" ${s.snoozeCount}x — likely wrong timing or scope`,
      priority: 0.9 + s.snoozeCount * 0.1,
    });
  }

  const sorted = entries.sort((a, b) => b.priority - a.priority).slice(0, maxEntries);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of sorted) {
    const key = e.text.slice(0, 60).toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(e.text);
    }
  }
  return out;
}

/** Hour stats aggregated from signals — replaces MemoryManager.getHourlyStats. */
function aggregateHourlyStats(
  memory: MemoryStore,
): Map<number, { completed: number; skipped: number }> {
  const map = new Map<number, { completed: number; skipped: number }>();
  for (const s of memory.signals) {
    const hour = new Date(s.timestamp).getHours();
    if (!map.has(hour)) map.set(hour, { completed: 0, skipped: 0 });
    const stats = map.get(hour)!;
    if (s.type === "task_completed" || s.type === "task_completed_early") stats.completed++;
    else if (s.type === "task_skipped" || s.type === "task_snoozed") stats.skipped++;
  }
  return map;
}

function buildBehavioralInsights(memory: MemoryStore): string[] {
  const insights: string[] = [];
  if (memory.signals.length < 5) return insights;

  const hourly = aggregateHourlyStats(memory);
  const hourScores: Array<{ hour: number; score: number }> = [];
  for (const [h, s] of hourly) {
    if (s.completed > 0 || s.skipped > 0) {
      hourScores.push({ hour: h, score: s.completed - s.skipped });
    }
  }
  const fmtHour = (h: number) => {
    const label = h < 12 ? "AM" : "PM";
    const display = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${display}${label}`;
  };
  const best = hourScores.filter((h) => h.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);
  if (best.length > 0) {
    insights.push(`User prefers deep work around: ${best.map((h) => fmtHour(h.hour)).join(", ")}`);
  }
  const worst = hourScores.filter((h) => h.score < -1).sort((a, b) => a.score - b.score).slice(0, 2);
  if (worst.length > 0) {
    insights.push(
      `User tends to skip/snooze tasks around: ${worst.map((h) => fmtHour(h.hour)).join(", ")}`,
    );
  }

  // Recovery frequency
  const recoveries = memory.signals.filter((s) => s.type === "recovery_triggered");
  if (recoveries.length >= 3) {
    const blockerCounts = new Map<string, number>();
    for (const r of recoveries) blockerCounts.set(r.value, (blockerCounts.get(r.value) || 0) + 1);
    let top: [string, number] | null = null;
    for (const e of blockerCounts) {
      if (!top || e[1] > top[1]) top = e;
    }
    if (top) insights.push(`Most common blocker: "${top[0]}" (${top[1]} occurrences)`);
  }

  // Session time patterns
  const sessions = memory.signals.filter((s) => s.type === "session_time");
  if (sessions.length >= 5) {
    const hours = sessions.map((s) => new Date(s.timestamp).getHours());
    const avg = Math.round(hours.reduce((a, b) => a + b, 0) / hours.length);
    insights.push(`Usually opens app around ${fmtHour(avg)}`);
  }

  // Recent completion rate
  const completed = memory.signals.filter((s) => s.type === "task_completed").slice(-30);
  const skipped = memory.signals
    .filter((s) => s.type === "task_skipped" || s.type === "task_snoozed")
    .slice(-30);
  if (completed.length + skipped.length > 10) {
    const rate = Math.round((completed.length / (completed.length + skipped.length)) * 100);
    if (rate >= 85)
      insights.push(`Strong recent momentum: ${rate}% completion rate (last 30 signals)`);
    else if (rate <= 40)
      insights.push(
        `⚠️ Low completion rate recently: ${rate}% (last 30 signals) — consider reducing task load`,
      );
    else insights.push(`Recent completion rate: ${rate}% (last 30 signals)`);
  }

  // Overwhelm detection
  const skipsByDate = new Map<string, number>();
  for (const s of memory.signals) {
    if (s.type !== "task_skipped" && s.type !== "task_snoozed") continue;
    const date = s.timestamp.split("T")[0];
    skipsByDate.set(date, (skipsByDate.get(date) || 0) + 1);
  }
  let overwhelm = 0;
  for (const c of skipsByDate.values()) if (c >= 3) overwhelm++;
  if (overwhelm >= 2) {
    insights.push(
      `User felt overwhelmed on ${overwhelm} recent days (3+ skips in a day) — avoid overloading`,
    );
  }

  // Category-level completion rates — helps the AI know which types of
  // tasks the user follows through on vs. avoids.
  const catCompleted = new Map<string, number>();
  const catTotal = new Map<string, number>();
  for (const s of memory.signals) {
    if (!["task_completed", "task_completed_early", "task_skipped", "task_snoozed"].includes(s.type))
      continue;
    const catMatch = s.value?.match(/category:\s*(\w+)/i) ?? s.context?.match(/category:\s*(\w+)/i);
    if (!catMatch) continue;
    const cat = catMatch[1];
    catTotal.set(cat, (catTotal.get(cat) || 0) + 1);
    if (s.type === "task_completed" || s.type === "task_completed_early") {
      catCompleted.set(cat, (catCompleted.get(cat) || 0) + 1);
    }
  }
  for (const [cat, total] of catTotal) {
    if (total < 5) continue;
    const rate = Math.round(((catCompleted.get(cat) || 0) / total) * 100);
    if (rate >= 80)
      insights.push(`"${cat}" tasks: ${rate}% completion rate — user's strongest category`);
    else if (rate <= 40)
      insights.push(`"${cat}" tasks: only ${rate}% completion rate — consider restructuring or reducing these`);
  }

  return insights;
}

function buildDayOfWeekInsights(memory: MemoryStore): string[] {
  const insights: string[] = [];
  if (memory.signals.length < 10) return insights;

  const completedByDay: Record<number, number> = {};
  const skippedByDay: Record<number, number> = {};
  const totalByDay: Record<number, number> = {};
  const dayTimeSkips: Record<string, number> = {};
  const dayTimeTotals: Record<string, number> = {};
  const catByDay: Record<string, { completed: number; total: number }> = {};

  for (const s of memory.signals) {
    if (
      !["task_completed", "task_completed_early", "task_skipped", "task_snoozed"].includes(
        s.type,
      )
    )
      continue;
    const dt = new Date(s.timestamp);
    const day = dt.getDay();
    const hour = dt.getHours();
    const slot = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
    totalByDay[day] = (totalByDay[day] || 0) + 1;
    const isCompletion = s.type === "task_completed" || s.type === "task_completed_early";
    if (isCompletion) completedByDay[day] = (completedByDay[day] || 0) + 1;
    else skippedByDay[day] = (skippedByDay[day] || 0) + 1;

    const dtKey = `${day}-${slot}`;
    dayTimeTotals[dtKey] = (dayTimeTotals[dtKey] || 0) + 1;
    if (!isCompletion) dayTimeSkips[dtKey] = (dayTimeSkips[dtKey] || 0) + 1;

    const catMatch = s.value.match(/category:\s*(\w+)/i);
    if (catMatch) {
      const ck = `${catMatch[1]}-${DAY_NAMES[day]}`;
      if (!catByDay[ck]) catByDay[ck] = { completed: 0, total: 0 };
      catByDay[ck].total++;
      if (isCompletion) catByDay[ck].completed++;
    }
  }

  for (let d = 0; d < 7; d++) {
    const total = totalByDay[d] || 0;
    if (total < 3) continue;
    const completionRate = (completedByDay[d] || 0) / total;
    const skipRate = (skippedByDay[d] || 0) / total;
    if (completionRate >= 0.8 && total >= 4)
      insights.push(
        `${DAY_NAMES[d]}s are a strong productivity day (${Math.round(completionRate * 100)}% completion rate)`,
      );
    else if (skipRate >= 0.5 && total >= 4)
      insights.push(
        `${DAY_NAMES[d]}s tend to be low-energy — user skips/snoozes ${Math.round(skipRate * 100)}% of tasks`,
      );
  }
  for (const [key, total] of Object.entries(dayTimeTotals)) {
    if (total < 3) continue;
    const skipRate = (dayTimeSkips[key] || 0) / total;
    if (skipRate >= 0.6) {
      const [dayStr, slot] = key.split("-");
      insights.push(
        `User tends to lack energy on ${DAY_NAMES[parseInt(dayStr)]} ${slot}s — ${Math.round(skipRate * 100)}% skip rate (${total} data points)`,
      );
    }
  }
  for (const [key, data] of Object.entries(catByDay)) {
    if (data.total < 3) continue;
    const rate = data.completed / data.total;
    const [cat, dayName] = key.split("-");
    if (rate >= 0.85) insights.push(`User is more likely to complete "${cat}" tasks on ${dayName}s`);
    else if (rate <= 0.3)
      insights.push(`User rarely completes "${cat}" tasks on ${dayName}s — consider rescheduling`);
  }
  return insights;
}

function buildTimingInsights(memory: MemoryStore): string[] {
  const insights: string[] = [];
  if (memory.taskTimings.length < 3) return insights;
  const byCategory: Record<string, { estimated: number[]; actual: number[] }> = {};
  for (const t of memory.taskTimings) {
    if (!byCategory[t.taskCategory]) byCategory[t.taskCategory] = { estimated: [], actual: [] };
    byCategory[t.taskCategory].estimated.push(t.estimatedMinutes);
    byCategory[t.taskCategory].actual.push(t.actualMinutes);
  }
  for (const [cat, data] of Object.entries(byCategory)) {
    if (data.actual.length < 2) continue;
    const avgEst = Math.round(data.estimated.reduce((a, b) => a + b, 0) / data.estimated.length);
    const avgAct = Math.round(data.actual.reduce((a, b) => a + b, 0) / data.actual.length);
    const diff = avgAct - avgEst;
    if (Math.abs(diff) >= 5) {
      insights.push(
        `"${cat}" tasks: estimated ${avgEst}min, actually take ${avgAct}min (${Math.abs(diff)}min ${diff > 0 ? "longer" : "shorter"})`,
      );
    }
  }
  return insights;
}

function getContextDirective(contextType: string, today: string): string {
  switch (contextType) {
    case "daily":
      return `Task: Plan today's schedule (${today}) keeping ALL of the above constraints in mind.
  - Respect the user's energy patterns by time-of-day and day-of-week
  - Apply duration calibrations — if tasks historically take longer, allocate more time
  - Avoid scheduling tasks at times/days where the user has high skip rates
  - If any Feedback Updates mention recent blockers, account for emotional recovery
  - If a task has been snoozed 3+ times, restructure it (break down, change timing, or flag it)`;
    case "planning":
      return `Task: Create a plan that respects ALL of the above learned constraints.
  - Use capacity insights to set realistic daily/weekly targets
  - Factor in day-of-week patterns when distributing work across the week
  - Apply duration calibrations to time estimates
  - Account for constraints and schedule preferences
  - If the user has shown patterns of overwhelm, build in more buffer`;
    case "recovery":
      return `Task: Help the user recover from missed tasks, keeping the above context in mind.
  - Look at the Feedback Updates to understand what's been going wrong
  - Reference their known strengths when reframing the situation
  - Avoid rescheduling to times/days where they historically struggle
  - If there's a pattern of the same blocker recurring, address the root cause
  - Be especially gentle if recent signals show multiple consecutive misses`;
    default:
      return `Task: Respond to the user keeping ALL of the above personalization in mind.
  - Reference their known preferences and patterns naturally
  - Apply any recent feedback updates to your recommendations`;
  }
}

/**
 * Build the personalization memory context block injected into AI prompts.
 * Faithful port of frontend/electron/memory.ts buildMemoryContext, with the
 * MemoryManager indirection removed (we operate on a plain MemoryStore).
 */
export function buildMemoryContext(
  memory: MemoryStore,
  contextType: "planning" | "daily" | "recovery" | "general",
  contextTags: string[] = [],
): string {
  const lines: string[] = [];
  const today = new Date().toISOString().split("T")[0];

  // Section 1: high-confidence facts grouped by category
  const facts = getAllHighConfidenceFacts(memory);
  if (facts.length > 0) {
    lines.push("Current User Preferences retrieved from memory:");
    lines.push("");
    const grouped = new Map<string, LongTermFact[]>();
    for (const f of facts.slice(0, 20)) {
      const arr = grouped.get(f.category);
      if (arr) arr.push(f);
      else grouped.set(f.category, [f]);
    }
    const order: Record<string, string[]> = {
      daily: ["schedule", "preference", "pattern", "capacity", "constraint", "motivation", "strength", "struggle"],
      planning: ["capacity", "schedule", "constraint", "preference", "pattern", "motivation", "strength", "struggle"],
      recovery: ["struggle", "motivation", "pattern", "constraint", "strength", "preference", "capacity", "schedule"],
      general: ["preference", "schedule", "pattern", "capacity", "motivation", "constraint", "strength", "struggle"],
    };
    const cats = order[contextType] || order.general;
    for (const cat of cats) {
      const catFacts = grouped.get(cat);
      if (!catFacts || catFacts.length === 0) continue;
      for (const f of catFacts) {
        const conf = f.confidence >= 0.8 ? "🟢" : f.confidence >= 0.5 ? "🟡" : "⚪";
        lines.push(`  ${conf} ${f.value}`);
      }
    }
    lines.push("");
  }

  // Section 2: feedback timeline
  const recentUpdates = buildFeedbackTimeline(memory, contextType);
  if (recentUpdates.length > 0) {
    for (const u of recentUpdates) lines.push(u);
    lines.push("");
  }

  // Section 3: behavioral patterns
  const patterns = [...buildBehavioralInsights(memory), ...buildDayOfWeekInsights(memory)];
  if (patterns.length > 0) {
    lines.push("Behavioral Patterns (observed over time):");
    lines.push("");
    for (const p of patterns) lines.push(`  • ${p}`);
    lines.push("");
  }

  // Section 4: chronic snoozes (only for daily/recovery)
  const chronic = memory.snoozeRecords.filter((s) => s.snoozeCount >= 3);
  if (chronic.length > 0 && (contextType === "daily" || contextType === "recovery")) {
    lines.push("⚠️ Chronically Snoozed Tasks (user keeps pushing these — consider restructuring):");
    lines.push("");
    for (const s of chronic.slice(0, 5)) {
      lines.push(`  "${s.taskTitle}" — snoozed ${s.snoozeCount}x (category: ${s.taskCategory})`);
    }
    lines.push(
      "  → Consider: Is timing wrong? Is the task too big? Should it be broken down or rescheduled?",
    );
    lines.push("");
  }

  // Duration calibration
  const timing = buildTimingInsights(memory);
  if (timing.length > 0 && (contextType === "planning" || contextType === "daily")) {
    lines.push("Duration Calibration (actual vs estimated from past tasks):");
    lines.push("");
    for (const t of timing) lines.push(`  ${t}`);
    lines.push("");
  }

  // Semantic preferences (filtered by tag overlap with contextTags + contextType)
  const relevantTags = new Set(
    [
      ...contextTags,
      contextType,
      ...(contextType === "daily"
        ? ["morning", "evening", "energy", "timing", "duration", "focus", "deep_work"]
        : []),
      ...(contextType === "recovery"
        ? ["blocker", "motivation", "struggle", "energy", "overwhelm", "burnout"]
        : []),
      ...(contextType === "planning"
        ? ["schedule", "capacity", "preference", "intensity", "pace", "deadline"]
        : []),
    ].map((t) => t.toLowerCase()),
  );
  const scoredPrefs = memory.preferences
    .map((p) => ({
      pref: p,
      score: p.tags.filter((t) => relevantTags.has(t.toLowerCase())).length,
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.pref.frequency - a.pref.frequency)
    .slice(0, 8)
    .map((x) => x.pref);
  if (scoredPrefs.length > 0) {
    lines.push("Learned Preferences (softer patterns from behavior):");
    lines.push("");
    for (const p of scoredPrefs) {
      const sentiment = p.weight > 0.3 ? "👍" : p.weight < -0.3 ? "👎" : "↔️";
      lines.push(`  ${sentiment} ${p.text} (observed ${p.frequency}x)`);
    }
    lines.push("");
  }

  // Directive
  lines.push(getContextDirective(contextType, today));

  if (lines.length <= 1) return ""; // only directive — fresh user
  return [
    "═══ PERSONALIZATION MEMORY (Micro-Adjustments from Reflection Loop) ═══",
    "",
    ...lines,
    "═══ END MEMORY ═══",
    "",
  ].join("\n");
}

// ── Behavior Profile (slice 4) ───────────────────────────
// Human-readable, editable view of everything memory knows about the user.
// Ported from frontend/electron/memory.ts getBehaviorProfile / saveBehaviorProfile.

export interface BehaviorProfileEntry {
  id: string;
  category: string;
  text: string;
  source: "observed" | "user-edited";
}

const PROFILE_CATEGORY_LABELS: Record<string, string> = {
  schedule: "Schedule",
  preference: "Preferences",
  capacity: "Work capacity",
  motivation: "Motivation",
  pattern: "Patterns",
  constraint: "Constraints",
  strength: "Strengths",
  struggle: "Struggles",
};

const PROFILE_LABEL_TO_CATEGORY: Record<string, FactCategory> = {
  Schedule: "schedule",
  Preferences: "preference",
  "Work capacity": "capacity",
  Motivation: "motivation",
  Patterns: "pattern",
  Constraints: "constraint",
  Strengths: "strength",
  Struggles: "struggle",
};

/**
 * Build the user-facing behavior profile from their memory store.
 * Mirrors frontend/electron/memory.ts getBehaviorProfile: high-confidence
 * facts + behavioral/day/timing insights + top semantic preferences,
 * deduped by lowercase text.
 */
export async function getBehaviorProfile(
  userId: string,
): Promise<BehaviorProfileEntry[]> {
  const memory = await loadMemory(userId);
  const entries: BehaviorProfileEntry[] = [];

  // 1. High-confidence facts → readable sentences
  for (const f of getAllHighConfidenceFacts(memory)) {
    entries.push({
      id: `fact-${f.id}`,
      category: PROFILE_CATEGORY_LABELS[f.category] || f.category,
      text: f.value,
      source: f.source === "explicit" ? "user-edited" : "observed",
    });
  }

  // 2. Behavioral / day-of-week / timing insights
  const allInsights = [
    ...buildBehavioralInsights(memory),
    ...buildDayOfWeekInsights(memory),
    ...buildTimingInsights(memory),
  ];
  for (let i = 0; i < allInsights.length; i++) {
    const text = allInsights[i].replace(/^[⚠️🟢🟡⚪👍👎↔️•\s]+/, "").trim();
    entries.push({
      id: `insight-${i}`,
      category: "Patterns",
      text,
      source: "observed",
    });
  }

  // 3. Top semantic preferences (most frequent first)
  const prefs = [...memory.preferences]
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 15);
  for (const p of prefs) {
    const prefix =
      p.weight > 0.3 ? "Likes" : p.weight < -0.3 ? "Dislikes" : "Neutral about";
    entries.push({
      id: `pref-${p.id}`,
      category: "Preferences",
      text: `${prefix}: ${p.text}`,
      source: "observed",
    });
  }

  // Dedupe by lowercase text
  const seen = new Set<string>();
  const unique: BehaviorProfileEntry[] = [];
  for (const e of entries) {
    const key = e.text.toLowerCase().trim();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(e);
    }
  }
  return unique;
}

/**
 * Replace the user's explicit-source facts with the user-edited entries
 * from the settings UI. Mirrors saveBehaviorProfile: wipe old explicit
 * facts, then INSERT each edit as a fresh `source = 'explicit'` fact at
 * confidence 1.0 so it always shows up in the prompt.
 *
 * Observed facts (source = 'reflection' or 'behavioral') are untouched
 * — only user-edited rows get replaced.
 */
export async function saveBehaviorProfile(
  userId: string,
  entries: Array<{ category: string; text: string }>,
): Promise<void> {
  await query(
    `delete from memory_facts where user_id = $1 and source = 'explicit'`,
    [userId],
  );
  if (entries.length === 0) return;

  // Build a single multi-row INSERT for atomicity. Confidence is pinned
  // to 1.0 so user edits dominate over observed reflection facts.
  const values: string[] = [];
  const params: unknown[] = [];
  let p = 1;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const category: FactCategory =
      PROFILE_LABEL_TO_CATEGORY[e.category] || "preference";
    const id = `fact-${userId}-explicit-${i}-${Date.now()}`;
    values.push(
      `($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, 1.0, $${p++}::jsonb, 'explicit', now(), now())`,
    );
    params.push(
      id,
      userId,
      category,
      `user_profile_${i}`,
      e.text,
      JSON.stringify(["User edited in settings"]),
    );
  }
  await query(
    `insert into memory_facts
        (id, user_id, category, key, value, confidence, evidence, source, created_at, updated_at)
      values ${values.join(", ")}`,
    params,
  );
}
