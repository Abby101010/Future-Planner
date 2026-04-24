/* Starward server — reminders repository
 *
 * Thin wrapper around the legacy `reminders` table. SQL patterns lifted
 * from packages/server/src/routes/reminders.ts.
 */

import type { Reminder } from "@starward/core";
import { query } from "../db/pool";
import { requireUserId } from "./_context";

interface ReminderRow {
  id: string;
  title: string;
  description: string;
  reminder_time: string;
  date: string;
  acknowledged: boolean;
  acknowledged_at: string | null;
  repeat: string | null;
  source: string;
  created_at: string;
}

function rowToReminder(r: ReminderRow): Reminder {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    reminderTime: r.reminder_time,
    date: r.date,
    acknowledged: r.acknowledged,
    acknowledgedAt: r.acknowledged_at ?? undefined,
    repeat: (r.repeat as Reminder["repeat"]) ?? null,
    source: r.source as Reminder["source"],
    createdAt: r.created_at,
  };
}

export async function list(date?: string): Promise<Reminder[]> {
  const userId = requireUserId();
  if (date) {
    const rows = await query<ReminderRow>(
      `select * from reminders
        where user_id = $1 and date = $2
        order by reminder_time`,
      [userId, date],
    );
    return rows.map(rowToReminder);
  }
  const rows = await query<ReminderRow>(
    `select * from reminders where user_id = $1 order by reminder_time`,
    [userId],
  );
  return rows.map(rowToReminder);
}

export async function listActive(): Promise<Reminder[]> {
  const userId = requireUserId();
  // For repeating reminders, treat them as active even if acknowledged
  // today — they reset each day. A repeating reminder is "active" if:
  //   (a) it was never acknowledged, OR
  //   (b) it has a repeat schedule (daily/weekly/monthly)
  // The view layer filters by day-of-week / day-of-month as needed.
  const rows = await query<ReminderRow>(
    `select * from reminders
      where user_id = $1
        and (acknowledged = false or repeat is not null)
      order by reminder_time`,
    [userId],
  );
  return rows.map(rowToReminder);
}

export async function get(id: string): Promise<Reminder | null> {
  const userId = requireUserId();
  const rows = await query<ReminderRow>(
    `select * from reminders where user_id = $1 and id = $2`,
    [userId, id],
  );
  return rows.length > 0 ? rowToReminder(rows[0]) : null;
}

export async function upsert(reminder: Reminder): Promise<void> {
  const userId = requireUserId();
  await query(
    `insert into reminders (
       id, user_id, title, description, reminder_time, date,
       acknowledged, repeat, source
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (user_id, id) do update set
       title = excluded.title,
       description = excluded.description,
       reminder_time = excluded.reminder_time,
       date = excluded.date,
       acknowledged = excluded.acknowledged,
       repeat = excluded.repeat,
       source = excluded.source`,
    [
      reminder.id,
      userId,
      reminder.title ?? "",
      reminder.description ?? "",
      reminder.reminderTime ?? "",
      reminder.date ?? "",
      Boolean(reminder.acknowledged),
      reminder.repeat ?? null,
      reminder.source ?? "chat",
    ],
  );
}

export async function acknowledge(id: string): Promise<void> {
  const userId = requireUserId();
  const result = await query<{ id: string }>(
    `update reminders
        set acknowledged = true, acknowledged_at = now()
      where user_id = $1 and id = $2
      returning id`,
    [userId, id],
  );
  if (result.length === 0) {
    console.warn("[remindersRepo] acknowledge: no row matched", { id, userId });
  } else {
    console.log("[remindersRepo] acknowledged reminder", id);
  }
}

export async function remove(id: string): Promise<void> {
  const userId = requireUserId();
  const result = await query<{ id: string }>(
    `delete from reminders where user_id = $1 and id = $2 returning id`,
    [userId, id],
  );
  if (result.length === 0) {
    console.warn("[remindersRepo] remove: no row matched", { id, userId });
  } else {
    console.log("[remindersRepo] deleted reminder", id);
  }
}

/** Delete one-time reminders that were acknowledged before `today`.
 *  They were kept in the DB for the day they were checked off (so they
 *  remain in short-term memory) but serve no purpose after that day. */
export async function cleanupPastAcknowledged(today: string): Promise<number> {
  const userId = requireUserId();
  const result = await query<{ id: string }>(
    `delete from reminders
      where user_id = $1
        and repeat is null
        and acknowledged = true
        and acknowledged_at::date < $2::date
      returning id`,
    [userId, today],
  );
  if (result.length > 0) {
    console.log(`[remindersRepo] cleaned up ${result.length} past-day acknowledged reminder(s)`);
  }
  return result.length;
}

export { remove as delete_ };
