/* NorthStar backend — memory:* routes (thin port, slice 2)
 *
 * Mirrors the simple write/read channels from frontend/electron/ipc/memory.ts.
 * Reflection/nudges/behavior-profile stay local — slice 3.
 *
 * Strategy: skip the in-memory MemoryStore + MemoryManager indirection
 * entirely. Each handler does direct INSERTs into memory_signals /
 * memory_snooze_records / memory_task_timings, scoped by req.userId.
 * memory:load reads those rows back into the MemoryStore shape the
 * renderer expects (with empty facts/preferences arrays — those are
 * reflection-derived and live in slice 3).
 *
 * Side-effect logic (which signals get emitted for each event) mirrors
 * frontend/electron/reflection.ts byte-for-byte so behavior is identical
 * across local and cloud installs.
 */

import { Router } from "express";
import { randomUUID } from "node:crypto";
import { query } from "../db/pool";
import { asyncHandler } from "../middleware/errorHandler";
import { getClient } from "../ai/client";
import { loadMemory, getBehaviorProfile, saveBehaviorProfile } from "../memory";
import {
  runReflection,
  shouldAutoReflect,
  generateNudges,
  type NudgeTask,
} from "../reflection";

export const memoryRouter = Router();

// ── Types (mirror electron/memory.ts) ────────────────────
type SignalType =
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

interface BehavioralSignal {
  id: string;
  type: SignalType;
  context: string;
  value: string;
  timestamp: string;
}
interface SnoozeRecord {
  taskTitle: string;
  taskCategory: string;
  snoozeCount: number;
  originalDate: string;
  lastSnoozed: string;
}
interface TaskTimingRecord {
  taskCategory: string;
  taskKeywords: string[];
  estimatedMinutes: number;
  actualMinutes: number;
  date: string;
}
interface MemoryStore {
  facts: unknown[];
  preferences: unknown[];
  signals: BehavioralSignal[];
  snoozeRecords: SnoozeRecord[];
  taskTimings: TaskTimingRecord[];
  lastReflectionAt: string | null;
  reflectionCount: number;
  version: number;
}

// ── Low-level inserts (the only place SQL lives) ─────────
async function insertSignal(
  userId: string,
  type: SignalType,
  context: string,
  value: string,
): Promise<void> {
  await query(
    `insert into memory_signals (id, user_id, type, context, value, timestamp)
          values ($1, $2, $3, $4, $5, now())`,
    [randomUUID(), userId, type, context, value],
  );
}

async function upsertSnooze(
  userId: string,
  taskTitle: string,
  taskCategory: string,
  originalDate: string,
): Promise<void> {
  // Mirrors recordSnooze: bumps snooze_count if (user_id, task_title,
  // original_date) already exists; otherwise creates a fresh row.
  await query(
    `insert into memory_snooze_records
       (user_id, task_title, task_category, snooze_count, original_date, last_snoozed)
     values ($1, $2, $3, 1, $4, now())
     on conflict (user_id, task_title, original_date) do update set
       snooze_count = memory_snooze_records.snooze_count + 1,
       last_snoozed = now()`,
    [userId, taskTitle, taskCategory, originalDate],
  );
}

async function insertTaskTiming(
  userId: string,
  taskCategory: string,
  taskKeywords: string[],
  estimatedMinutes: number,
  actualMinutes: number,
): Promise<void> {
  const date = new Date().toISOString().split("T")[0];
  await query(
    `insert into memory_task_timings
       (user_id, task_category, task_keywords, estimated_minutes, actual_minutes, date)
     values ($1, $2, $3::jsonb, $4, $5, $6)`,
    [
      userId,
      taskCategory,
      JSON.stringify(taskKeywords),
      estimatedMinutes,
      actualMinutes,
      date,
    ],
  );
}

// ── Time helpers (mirror reflection.ts) ──────────────────
function dayName(d = new Date()): string {
  return [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ][d.getDay()];
}
function timeSlot(d = new Date()): "morning" | "afternoon" | "evening" {
  const h = d.getHours();
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
}

// ── memory:load ──────────────────────────────────────────
// Delegates to backend/src/memory.ts loadMemory which queries all 6
// memory_* tables (including facts/preferences populated by slice 3b
// reflection). Slice 2 used to inline a query that hardcoded empty
// facts/prefs — switching to the shared loader is what makes
// reflection results visible to the renderer.
memoryRouter.post(
  "/load",
  asyncHandler(async (req, res) => {
    const data = await loadMemory(req.userId);
    res.json({ ok: true, data });
  }),
);

// ── memory:summary ───────────────────────────────────────
// Phase 1b stub: facts/preferences are reflection-derived (slice 3),
// so the summary returns counts based on what we currently have. The
// shape matches getMemorySummary in electron/memory.ts so the renderer
// renders without surprise.
memoryRouter.post(
  "/summary",
  asyncHandler(async (req, res) => {
    const [
      [{ count: signalCount }],
      [{ count: factCount }],
      [{ count: prefCount }],
      highFacts,
      topPrefs,
      meta,
    ] = await Promise.all([
      query<{ count: string }>(
        `select count(*)::text as count from memory_signals where user_id = $1`,
        [req.userId],
      ),
      query<{ count: string }>(
        `select count(*)::text as count from memory_facts where user_id = $1`,
        [req.userId],
      ),
      query<{ count: string }>(
        `select count(*)::text as count from memory_preferences where user_id = $1`,
        [req.userId],
      ),
      query<{ fact: string; confidence: number; source: string }>(
        `select fact, confidence, source from memory_facts
         where user_id = $1 and confidence >= 0.7
         order by confidence desc limit 10`,
        [req.userId],
      ),
      query<{ preference: string; weight: number }>(
        `select preference, weight from memory_preferences
         where user_id = $1
         order by weight desc limit 10`,
        [req.userId],
      ),
      query<{
        last_reflection_at: string | null;
        reflection_count: number;
      }>(
        `select last_reflection_at, reflection_count
           from memory_meta where user_id = $1`,
        [req.userId],
      ),
    ]);
    res.json({
      ok: true,
      data: {
        totalFacts: Number(factCount) || 0,
        totalPreferences: Number(prefCount) || 0,
        totalSignals: Number(signalCount) || 0,
        highConfidenceFacts: highFacts.map((f) => ({
          fact: f.fact,
          confidence: f.confidence,
          source: f.source,
        })),
        topPreferences: topPrefs.map((p) => ({
          preference: p.preference,
          weight: p.weight,
        })),
        lastReflection: meta[0]?.last_reflection_at ?? null,
        reflectionCount: meta[0]?.reflection_count ?? 0,
      },
    });
  }),
);

// ── memory:clear ─────────────────────────────────────────
memoryRouter.post(
  "/clear",
  asyncHandler(async (req, res) => {
    await Promise.all([
      query(`delete from memory_signals where user_id = $1`, [req.userId]),
      query(`delete from memory_snooze_records where user_id = $1`, [req.userId]),
      query(`delete from memory_task_timings where user_id = $1`, [req.userId]),
      query(`delete from memory_facts where user_id = $1`, [req.userId]),
      query(`delete from memory_preferences where user_id = $1`, [req.userId]),
      query(`delete from memory_meta where user_id = $1`, [req.userId]),
    ]);
    res.json({ ok: true });
  }),
);

// ── memory:signal ────────────────────────────────────────
memoryRouter.post(
  "/signal",
  asyncHandler(async (req, res) => {
    const p = (req.body ?? {}) as {
      type: SignalType;
      context: string;
      value: string;
    };
    await insertSignal(
      req.userId,
      p.type,
      String(p.context ?? ""),
      String(p.value ?? ""),
    );
    res.json({ ok: true });
  }),
);

// ── memory:task-completed ────────────────────────────────
// Mirrors quickReflect("task_completed", ...) — emits one base signal,
// optional energy-window signal, and optional task-timing record.
memoryRouter.post(
  "/task-completed",
  asyncHandler(async (req, res) => {
    const p = (req.body ?? {}) as {
      taskTitle?: string;
      taskCategory?: string;
      actualMinutes?: number;
      estimatedMinutes?: number;
    };
    const now = new Date();
    const hour = now.getHours();
    const day = dayName(now);
    const slot = timeSlot(now);
    const timeLabel = `${hour}:00`;
    const title = p.taskTitle || "unknown";
    const cat = p.taskCategory || "unknown";

    await insertSignal(
      req.userId,
      "task_completed",
      title,
      `Completed at ${timeLabel} on ${day} ${slot}, category: ${cat}`,
    );

    if (hour >= 6 && hour <= 10) {
      await insertSignal(
        req.userId,
        "high_energy_window",
        "morning",
        `Completed "${title}" on ${day} morning`,
      );
    } else if (hour >= 14 && hour <= 16) {
      await insertSignal(
        req.userId,
        "high_energy_window",
        "afternoon",
        `Completed "${title}" on ${day} afternoon`,
      );
    } else if (hour >= 22 || hour <= 5) {
      await insertSignal(
        req.userId,
        "high_energy_window",
        "night",
        `Completed "${title}" on ${day} late at night`,
      );
    }

    if (
      typeof p.actualMinutes === "number" &&
      typeof p.estimatedMinutes === "number"
    ) {
      const keywords = (p.taskTitle || "")
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 3)
        .slice(0, 5);
      await insertTaskTiming(
        req.userId,
        p.taskCategory || "other",
        keywords,
        p.estimatedMinutes,
        p.actualMinutes,
      );
      // captureTaskTiming also emits a late/early signal when |diff| >= 10
      const diff = p.actualMinutes - p.estimatedMinutes;
      if (Math.abs(diff) >= 10) {
        await insertSignal(
          req.userId,
          diff > 0 ? "task_completed_late" : "task_completed_early",
          title,
          `Est: ${p.estimatedMinutes}min, Actual: ${p.actualMinutes}min (${diff > 0 ? "+" : ""}${diff}min)`,
        );
      }
    }
    res.json({ ok: true });
  }),
);

// ── memory:task-snoozed ──────────────────────────────────
// Mirrors captureSnooze: upsert snooze record + emit task_snoozed signal
// + emit a low_energy_window signal with day+time context (matches
// quickReflect("task_snoozed", ...)).
memoryRouter.post(
  "/task-snoozed",
  asyncHandler(async (req, res) => {
    const p = (req.body ?? {}) as {
      taskTitle?: string;
      taskCategory?: string;
      date?: string;
    };
    const now = new Date();
    const day = dayName(now);
    const slot = timeSlot(now);
    const timeLabel = `${now.getHours()}:00`;
    const title = p.taskTitle || "unknown";
    const cat = p.taskCategory || "other";
    const date = p.date || now.toISOString().split("T")[0];

    await upsertSnooze(req.userId, title, cat, date);
    await insertSignal(
      req.userId,
      "task_snoozed",
      title,
      `Snoozed on ${date}`,
    );
    await insertSignal(
      req.userId,
      "low_energy_window",
      `${day}_${slot}`,
      `Snoozed "${title}" on ${day} ${slot} at ${timeLabel}`,
    );
    res.json({ ok: true });
  }),
);

// ── memory:task-skipped ──────────────────────────────────
memoryRouter.post(
  "/task-skipped",
  asyncHandler(async (req, res) => {
    const p = (req.body ?? {}) as {
      taskTitle?: string;
      taskCategory?: string;
      date?: string;
    };
    const now = new Date();
    const day = dayName(now);
    const slot = timeSlot(now);
    const timeLabel = `${now.getHours()}:00`;
    const date = p.date || now.toISOString().split("T")[0];
    await insertSignal(
      req.userId,
      "task_skipped",
      p.taskTitle || "unknown",
      `Skipped on ${day} ${date}, ${slot} at ${timeLabel}, category: ${p.taskCategory || "unknown"}`,
    );
    res.json({ ok: true });
  }),
);

// ── memory:feedback ──────────────────────────────────────
// Mirrors captureExplicitFeedback. We only emit the base
// positive/negative signal. The local handler additionally writes a
// fact, but facts are reflection-derived and arrive in slice 3.
memoryRouter.post(
  "/feedback",
  asyncHandler(async (req, res) => {
    const p = (req.body ?? {}) as {
      context: string;
      feedback: string;
      isPositive: boolean;
    };
    await insertSignal(
      req.userId,
      p.isPositive ? "positive_feedback" : "negative_feedback",
      String(p.context ?? ""),
      String(p.feedback ?? ""),
    );
    res.json({ ok: true });
  }),
);

// ── memory:chat-insight ──────────────────────────────────
// Mirrors captureChatInsight pattern matching exactly. Pure regex →
// signal inserts, no AI call.
memoryRouter.post(
  "/chat-insight",
  asyncHandler(async (req, res) => {
    const p = (req.body ?? {}) as { userMessage: string; aiReply: string };
    const userMessage = String(p.userMessage ?? "");
    const lower = userMessage.toLowerCase();
    const now = new Date();
    const day = dayName(now);
    const slot = timeSlot(now);

    const tired =
      /\b(tired|exhausted|burnt? out|drained|low energy|sleepy|fatigued|no energy)\b/;
    const energized =
      /\b(energized|motivated|pumped|ready|feeling good|productive|focused|on fire)\b/;
    const overwhelm =
      /\b(overwhelm|too much|can't cope|stressed|anxious|behind|falling behind|drowning|swamped)\b/;
    const schedule =
      /\b(cancel|free today|free tomorrow|day off|sick|no class|plans changed|schedule changed|going out|traveling|travel)\b/;
    const prefer =
      /\b(i prefer|i like|i hate|i don't like|i want|rather|instead of|too many|too few|too hard|too easy)\b/;
    const goal =
      /\b(give up|quit|pivot|change goal|new goal|not sure|rethink|reconsider|excited about|making progress|stuck on)\b/;

    if (tired.test(lower)) {
      await insertSignal(
        req.userId,
        "chat_insight",
        "energy_low",
        `Reported low energy on ${day} ${slot}`,
      );
      await insertSignal(
        req.userId,
        "low_energy_window",
        `${day}_${slot}`,
        `User said: "${userMessage.slice(0, 80)}"`,
      );
    }
    if (energized.test(lower)) {
      await insertSignal(
        req.userId,
        "chat_insight",
        "energy_high",
        `Reported high energy on ${day} ${slot}`,
      );
      await insertSignal(
        req.userId,
        "high_energy_window",
        `${day}_${slot}`,
        `User said: "${userMessage.slice(0, 80)}"`,
      );
    }
    if (overwhelm.test(lower)) {
      await insertSignal(
        req.userId,
        "chat_insight",
        "overwhelm",
        `Expressed overwhelm on ${day} ${slot}: "${userMessage.slice(0, 80)}"`,
      );
    }
    if (schedule.test(lower)) {
      await insertSignal(
        req.userId,
        "chat_insight",
        "schedule_change",
        `Schedule shift on ${day}: "${userMessage.slice(0, 80)}"`,
      );
    }
    if (prefer.test(lower)) {
      await insertSignal(
        req.userId,
        "chat_insight",
        "preference",
        `Preference expressed: "${userMessage.slice(0, 100)}"`,
      );
    }
    if (goal.test(lower)) {
      await insertSignal(
        req.userId,
        "chat_insight",
        "goal_sentiment",
        `Goal reflection on ${day}: "${userMessage.slice(0, 100)}"`,
      );
    }
    res.json({ ok: true });
  }),
);

// ── memory:should-reflect (slice 3b) ─────────────────────
// Cheap heuristic — no AI call. Returns whether enough new signals
// have piled up to justify firing a reflection.
memoryRouter.post(
  "/should-reflect",
  asyncHandler(async (req, res) => {
    const should = await shouldAutoReflect(req.userId);
    res.json({ ok: true, shouldReflect: should });
  }),
);

// ── memory:reflect (slice 3b) ────────────────────────────
// Run the full reflection loop: load signals, send to Haiku, upsert
// facts/preferences. Returns the same envelope as the Electron version.
memoryRouter.post(
  "/reflect",
  asyncHandler(async (req, res) => {
    const trigger = (req.body?.trigger as string) || "manual";
    const client = getClient();
    if (!client) {
      res.status(500).json({
        ok: false,
        error: "ANTHROPIC_API_KEY not configured on server",
      });
      return;
    }
    const result = await runReflection(client, req.userId, trigger);
    res.json({ ok: true, ...result });
  }),
);

// ── memory:nudges (slice 3b) ─────────────────────────────
// Compute contextual nudges from today's tasks + accumulated signals.
// No AI call — pure rule engine.
memoryRouter.post(
  "/nudges",
  asyncHandler(async (req, res) => {
    const p = (req.body ?? {}) as {
      todayTasks?: NudgeTask[];
      proactiveQuestion?: string | null;
    };
    const nudges = await generateNudges(
      req.userId,
      p.todayTasks ?? [],
      p.proactiveQuestion ?? null,
    );
    res.json({ ok: true, nudges });
  }),
);

// ── memory:behavior-profile (slice 4) ────────────────────
// Build the human-readable, editable profile shown in Settings.
memoryRouter.post(
  "/behavior-profile",
  asyncHandler(async (req, res) => {
    const data = await getBehaviorProfile(req.userId);
    res.json({ ok: true, data });
  }),
);

// ── memory:save-behavior-profile (slice 4) ───────────────
// Replace the user's explicit-source facts with the edited entries from
// the Settings UI. Observed (reflection) facts are untouched.
memoryRouter.post(
  "/save-behavior-profile",
  asyncHandler(async (req, res) => {
    const entries = (req.body?.entries ?? []) as Array<{
      category: string;
      text: string;
    }>;
    await saveBehaviorProfile(req.userId, entries);
    res.json({ ok: true });
  }),
);

// ── memory:task-timing ───────────────────────────────────
memoryRouter.post(
  "/task-timing",
  asyncHandler(async (req, res) => {
    const p = (req.body ?? {}) as {
      taskCategory?: string;
      taskTitle?: string;
      estimatedMinutes: number;
      actualMinutes: number;
    };
    const keywords = (p.taskTitle || "")
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 5);
    await insertTaskTiming(
      req.userId,
      p.taskCategory || "other",
      keywords,
      Number(p.estimatedMinutes) || 0,
      Number(p.actualMinutes) || 0,
    );
    const diff = (Number(p.actualMinutes) || 0) - (Number(p.estimatedMinutes) || 0);
    if (Math.abs(diff) >= 10) {
      await insertSignal(
        req.userId,
        diff > 0 ? "task_completed_late" : "task_completed_early",
        p.taskTitle || "unknown",
        `Est: ${p.estimatedMinutes}min, Actual: ${p.actualMinutes}min (${diff > 0 ? "+" : ""}${diff}min)`,
      );
    }
    res.json({ ok: true });
  }),
);
