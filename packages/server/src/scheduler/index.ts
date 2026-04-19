/* NorthStar server — Scheduled background tasks (Phase 4, additive)
 *
 * Runs cron-scheduled jobs alongside the existing server. Opt-in via the
 * ENABLE_SCHEDULER env var — when absent or "0", this module is a no-op
 * and server boot is byte-identical to pre-Phase-4 behaviour.
 *
 * Timing model:
 *   A single cron fires at the top of every UTC hour. On each tick we
 *   iterate users, read each user's IANA timezone from users.payload,
 *   compute their current local hour, and run the matching job when the
 *   local hour equals the configured target. Net effect: each user's
 *   nightly reflection and morning nudge fire once per day at THEIR local
 *   time, not at a hardcoded UTC time.
 *
 *   Target local hours:
 *     - NIGHTLY_REFLECTION_HOUR   (default 23 — 11 PM local)
 *     - MORNING_NUDGE_HOUR        (default  7 —  7 AM local)
 *
 *   Both are overridable via env var if we ever expose them per-user.
 *
 * Dedup: a per-user in-memory Map tracks the last date each job ran for
 * each user. Prevents double-firing across DST fall-back (when the same
 * local hour happens twice) or stray hourly drift.
 *
 * Additive guarantee: nothing in this module mutates existing schemas or
 * invokes existing commands in a way that wasn't already available. It is
 * purely a scheduled invocation of already-shipped functions.
 */

import * as cron from "node-cron";
import { runWithUserId } from "../middleware/requestContext";
import { query } from "../db/pool";
import { getClient } from "../ai/client";
import { runReflection, shouldAutoReflect, generateNudges } from "../reflection";
import * as repos from "../repositories";

type ScheduledTask = ReturnType<typeof cron.schedule>;
const tasks: ScheduledTask[] = [];

/** Hourly cron runs in UTC; per-user logic handles the timezone math. */
const CRON_TZ = "UTC";

const NIGHTLY_REFLECTION_HOUR = Number(
  process.env.NIGHTLY_REFLECTION_HOUR ?? 23,
);
const MORNING_NUDGE_HOUR = Number(process.env.MORNING_NUDGE_HOUR ?? 7);

interface SchedulableUser {
  userId: string;
  tz: string;
}

/** "reflection" | "nudge" -> userId -> last-fired YYYY-MM-DD (in that user's tz). */
const lastRan = new Map<"reflection" | "nudge", Map<string, string>>();
lastRan.set("reflection", new Map());
lastRan.set("nudge", new Map());

async function listSchedulableUsers(): Promise<SchedulableUser[]> {
  try {
    const rows = await query<{ user_id: string; payload: unknown }>(
      "SELECT user_id, payload FROM users WHERE user_id IS NOT NULL",
    );
    return rows.map((r) => {
      let tz = "UTC";
      const p =
        typeof r.payload === "string"
          ? safeJson(r.payload)
          : ((r.payload ?? {}) as Record<string, unknown>);
      const candidate = p?.timezone;
      if (typeof candidate === "string" && candidate.trim()) {
        tz = candidate.trim();
      }
      return { userId: r.user_id, tz };
    });
  } catch (err) {
    console.error("[scheduler] listSchedulableUsers failed:", err);
    return [];
  }
}

function safeJson(s: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(s);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Returns the user's current hour (0-23) and local YYYY-MM-DD date. */
function localHourAndDate(tz: string): { hour: number; date: string } {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(new Date());
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const hour = Number(get("hour"));
    const date = `${get("year")}-${get("month")}-${get("day")}`;
    return { hour: Number.isFinite(hour) ? hour : 0, date };
  } catch {
    const now = new Date();
    return {
      hour: now.getUTCHours(),
      date: now.toISOString().split("T")[0]!,
    };
  }
}

async function fireNightlyReflection(userId: string): Promise<boolean> {
  const client = getClient();
  if (!client) {
    console.warn("[scheduler] reflection skipped (no ANTHROPIC_API_KEY)");
    return false;
  }
  return runWithUserId(userId, async () => {
    const should = await shouldAutoReflect(userId);
    if (!should) return false;
    await runReflection(client, userId, "nightly-scheduled");
    return true;
  });
}

async function fireMorningNudge(userId: string): Promise<boolean> {
  return runWithUserId(userId, async () => {
    const today = new Date().toISOString().split("T")[0]!;
    const todayTasks = await repos.dailyTasks.listForDate(today);
    if (todayTasks.length === 0) return false;
    const nudgeTasks = todayTasks.map((t) => {
      const pl = (t.payload ?? {}) as Record<string, unknown>;
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
    await generateNudges(userId, nudgeTasks);
    return true;
  });
}

async function hourlyTick(): Promise<void> {
  const users = await listSchedulableUsers();
  if (users.length === 0) return;

  const reflMap = lastRan.get("reflection")!;
  const nudgeMap = lastRan.get("nudge")!;

  let reflected = 0;
  let nudged = 0;

  for (const { userId, tz } of users) {
    const { hour, date } = localHourAndDate(tz);

    if (hour === NIGHTLY_REFLECTION_HOUR && reflMap.get(userId) !== date) {
      reflMap.set(userId, date);
      try {
        const ran = await fireNightlyReflection(userId);
        if (ran) reflected++;
      } catch (err) {
        console.error(`[scheduler] reflection for ${userId} failed:`, err);
      }
    }

    if (hour === MORNING_NUDGE_HOUR && nudgeMap.get(userId) !== date) {
      nudgeMap.set(userId, date);
      try {
        const ran = await fireMorningNudge(userId);
        if (ran) nudged++;
      } catch (err) {
        console.error(`[scheduler] nudge for ${userId} failed:`, err);
      }
    }
  }

  if (reflected > 0 || nudged > 0) {
    console.log(
      `[scheduler] hourlyTick — reflected=${reflected} nudged=${nudged} users=${users.length}`,
    );
  }
}

/**
 * Start cron schedules. Idempotent — repeated calls return without
 * registering duplicates. No-op unless ENABLE_SCHEDULER is "1"/"true".
 */
export function startScheduler(): void {
  const flag = (process.env.ENABLE_SCHEDULER ?? "").toLowerCase();
  if (flag !== "1" && flag !== "true") {
    console.log("[scheduler] disabled (ENABLE_SCHEDULER not set)");
    return;
  }
  if (tasks.length > 0) return;

  tasks.push(
    cron.schedule(
      "0 * * * *",
      () => {
        void hourlyTick();
      },
      { timezone: CRON_TZ },
    ),
  );

  console.log(
    `[scheduler] started — hourly tick (UTC); per-user targets: reflection @ ${NIGHTLY_REFLECTION_HOUR}:00 local, nudges @ ${MORNING_NUDGE_HOUR}:00 local`,
  );
}

/** Stop all registered schedules. Safe to call at shutdown. */
export function stopScheduler(): void {
  for (const t of tasks) {
    try {
      t.stop();
    } catch {
      // ignore
    }
  }
  tasks.length = 0;
}

/** Exposed for ad-hoc / test runs. */
export const _internal = {
  hourlyTick,
  listSchedulableUsers,
  localHourAndDate,
};
