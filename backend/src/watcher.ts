/* NorthStar server — task watcher background worker
 *
 * Periodically scans every user's active goal/task state and raises
 * task_notifications rows when deterministic risk rules fire. Opt-in via
 * ENABLE_TASK_WATCHER=true so staging can run it without affecting prod.
 *
 * Design notes:
 *   - Deterministic rules first (cheap, no API spend). A future AI layer
 *     can be layered on top by reading these notifications and calling
 *     Claude only for the ones that look genuinely ambiguous.
 *   - Dedup is enforced at the DB level via unique(user_id, kind, context):
 *     re-raising the same notification is a no-op.
 *   - Every DB call is scoped by user_id — no cross-tenant reads.
 */

import { randomUUID } from "node:crypto";
import { query } from "./db/pool";

const DEFAULT_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

interface DailyTaskSnapshot {
  id?: string;
  title?: string;
  priority?: string;
  completed?: boolean;
  skipped?: boolean;
  snoozedCount?: number;
  durationMinutes?: number;
  category?: string;
}

interface TodayLogSnapshot {
  date?: string;
  tasks?: DailyTaskSnapshot[];
}

interface PendingNotification {
  kind: string;
  context: string;
  title: string;
  body: string;
  priority: number;
}

/**
 * Insert a notification row idempotently. Duplicates (same user+kind+context)
 * are silently skipped so the watcher can re-run every 10 minutes without
 * stuttering the client UI.
 */
async function raiseNotification(
  userId: string,
  n: PendingNotification,
): Promise<void> {
  await query(
    `insert into task_notifications
        (id, user_id, kind, context, title, body, priority)
      values ($1, $2, $3, $4, $5, $6, $7)
      on conflict (user_id, kind, context) do nothing`,
    [
      `notif-${randomUUID()}`,
      userId,
      n.kind,
      n.context,
      n.title,
      n.body,
      n.priority,
    ],
  );
}

/**
 * Pull the todayLog snapshot out of app_store (key = 'dailyLogs' holds an
 * array; key = 'todayLog' holds the live one). We accept either shape so
 * it keeps working whether the renderer writes the summary key or the full
 * array.
 */
async function loadTodayLogForUser(
  userId: string,
): Promise<TodayLogSnapshot | null> {
  const rows = await query<{ key: string; value: unknown }>(
    `select key, value from app_store
      where user_id = $1 and key in ('todayLog', 'dailyLogs')`,
    [userId],
  );

  for (const r of rows) {
    if (r.key === "todayLog" && r.value && typeof r.value === "object") {
      return r.value as TodayLogSnapshot;
    }
  }

  const logsRow = rows.find((r) => r.key === "dailyLogs");
  if (logsRow && Array.isArray(logsRow.value)) {
    const logs = logsRow.value as TodayLogSnapshot[];
    const today = new Date().toISOString().split("T")[0];
    return logs.find((l) => l.date === today) ?? null;
  }
  return null;
}

/**
 * Evaluate deterministic risk rules for one user's today-log.
 *
 * Rules (mirror a subset of the 7-rule nudge engine, but decoupled so the
 * watcher can run without today's tasks changing in memory):
 *   1. stalled_must_do — it's past 8pm local-equivalent and ≥1 must-do task
 *      is still incomplete and not skipped.
 *   2. overwhelm — ≥3 tasks skipped or snoozed today.
 *   3. chronic_snooze — a single task snoozed ≥3 times today.
 */
function evaluateToday(log: TodayLogSnapshot): PendingNotification[] {
  const out: PendingNotification[] = [];
  const tasks = log.tasks ?? [];
  const today = log.date ?? new Date().toISOString().split("T")[0];

  const hour = new Date().getHours();
  const stalledMustDos = tasks.filter(
    (t) => t.priority === "must-do" && !t.completed && !t.skipped,
  );
  if (hour >= 20 && stalledMustDos.length > 0) {
    out.push({
      kind: "stalled_must_do",
      context: today,
      title: `${stalledMustDos.length} must-do task${stalledMustDos.length > 1 ? "s" : ""} still open`,
      body: stalledMustDos
        .map((t) => t.title)
        .filter(Boolean)
        .join(", "),
      priority: 3,
    });
  }

  const frictionCount =
    tasks.filter((t) => t.skipped).length +
    tasks.filter((t) => (t.snoozedCount ?? 0) > 0).length;
  if (frictionCount >= 3 && tasks.length > 0) {
    out.push({
      kind: "overwhelm",
      context: today,
      title: "Today's load looks heavy",
      body: `${frictionCount} tasks snoozed or skipped — consider lightening tomorrow.`,
      priority: 2,
    });
  }

  for (const t of tasks) {
    if ((t.snoozedCount ?? 0) >= 3 && t.title) {
      out.push({
        kind: "chronic_snooze",
        context: `${today}:${t.title}`,
        title: `"${t.title}" snoozed ${t.snoozedCount}×`,
        body: "The timing or size may need to change.",
        priority: 2,
      });
    }
  }

  return out;
}

/**
 * Run one tick: enumerate users who have any app_store row and evaluate
 * their today-log. A user without app_store rows is invisible to us and
 * skipped. Errors on a single user are logged but don't abort the tick.
 */
export async function runWatcherTick(): Promise<{
  usersScanned: number;
  notificationsRaised: number;
}> {
  const users = await query<{ user_id: string }>(
    "select distinct user_id from app_store",
  );

  let raised = 0;
  for (const u of users) {
    try {
      const log = await loadTodayLogForUser(u.user_id);
      if (!log) continue;
      const notifs = evaluateToday(log);
      for (const n of notifs) {
        await raiseNotification(u.user_id, n);
        raised++;
      }
    } catch (err) {
      console.error(`[watcher] user ${u.user_id} failed:`, err);
    }
  }

  return { usersScanned: users.length, notificationsRaised: raised };
}

/**
 * Start the polling loop. Returns a stop() function for graceful shutdown.
 * First tick fires ~30s after startup so migrations / hot reload can settle.
 */
export function startWatcher(
  intervalMs: number = DEFAULT_INTERVAL_MS,
): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const tick = async () => {
    if (stopped) return;
    try {
      const result = await runWatcherTick();
      console.log(
        `[watcher] tick ok — users=${result.usersScanned} raised=${result.notificationsRaised}`,
      );
    } catch (err) {
      console.error("[watcher] tick failed:", err);
    }
    if (!stopped) {
      timer = setTimeout(tick, intervalMs);
    }
  };

  timer = setTimeout(tick, 30_000);
  console.log(`[watcher] started — interval=${intervalMs}ms`);

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

// Exported only for use by feed handlers that want to re-evaluate on demand
// (e.g. after a task_completed mutation). Not currently wired up.
export { evaluateToday };
export type { TodayLogSnapshot, DailyTaskSnapshot, PendingNotification };
