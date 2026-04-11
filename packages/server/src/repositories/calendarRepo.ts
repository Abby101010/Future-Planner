/* NorthStar server — calendar events repository
 *
 * Thin wrapper around the legacy `calendar_events` table. SQL is lifted
 * from packages/server/src/routes/calendar.ts. NOTE: the legacy row shape
 * stores `recurring_freq` / `recurring_until` as flat columns while the
 * @northstar/core CalendarEvent type nests them under `recurring`. We
 * reassemble the nested shape in `rowToEvent`.
 */

import type { CalendarEvent } from "@northstar/core";
import { query } from "../db/pool";
import { requireUserId } from "./_context";

interface CalendarEventRow {
  id: string;
  title: string;
  start_date: string;
  end_date: string;
  is_all_day: boolean;
  duration_minutes: number;
  category: string;
  is_vacation: boolean;
  source: string;
  source_calendar: string | null;
  color: string | null;
  notes: string | null;
  recurring_freq: string | null;
  recurring_until: string | null;
  created_at: string;
  updated_at: string;
}

function rowToEvent(r: CalendarEventRow): CalendarEvent {
  const event: CalendarEvent = {
    id: r.id,
    title: r.title,
    startDate: r.start_date,
    endDate: r.end_date,
    isAllDay: r.is_all_day,
    durationMinutes: r.duration_minutes,
    category: r.category as CalendarEvent["category"],
    isVacation: r.is_vacation,
    source: r.source as CalendarEvent["source"],
    sourceCalendar: r.source_calendar ?? undefined,
    color: r.color ?? undefined,
    notes: r.notes ?? undefined,
  };
  if (r.recurring_freq) {
    event.recurring = {
      frequency: r.recurring_freq as "daily" | "weekly" | "monthly",
      until: r.recurring_until ?? undefined,
    };
  }
  return event;
}

export async function listForRange(
  startDate: string,
  endDate: string,
): Promise<CalendarEvent[]> {
  const userId = requireUserId();
  const rows = await query<CalendarEventRow>(
    `select * from calendar_events
      where user_id = $1 and start_date >= $2 and start_date <= $3
      order by start_date asc`,
    [userId, startDate, endDate],
  );
  return rows.map(rowToEvent);
}

export async function list(): Promise<CalendarEvent[]> {
  const userId = requireUserId();
  const rows = await query<CalendarEventRow>(
    `select * from calendar_events where user_id = $1 order by start_date asc`,
    [userId],
  );
  return rows.map(rowToEvent);
}

export async function get(id: string): Promise<CalendarEvent | null> {
  const userId = requireUserId();
  const rows = await query<CalendarEventRow>(
    `select * from calendar_events where user_id = $1 and id = $2`,
    [userId, id],
  );
  return rows.length > 0 ? rowToEvent(rows[0]) : null;
}

export async function upsert(event: CalendarEvent): Promise<void> {
  const userId = requireUserId();
  await query(
    `insert into calendar_events (
       id, user_id, title, start_date, end_date, is_all_day, duration_minutes,
       category, is_vacation, source, source_calendar, color, notes,
       recurring_freq, recurring_until, updated_at
     ) values (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, now()
     )
     on conflict (user_id, id) do update set
       title = excluded.title,
       start_date = excluded.start_date,
       end_date = excluded.end_date,
       is_all_day = excluded.is_all_day,
       duration_minutes = excluded.duration_minutes,
       category = excluded.category,
       is_vacation = excluded.is_vacation,
       source = excluded.source,
       source_calendar = excluded.source_calendar,
       color = excluded.color,
       notes = excluded.notes,
       recurring_freq = excluded.recurring_freq,
       recurring_until = excluded.recurring_until,
       updated_at = now()`,
    [
      event.id,
      userId,
      event.title,
      event.startDate,
      event.endDate,
      event.isAllDay,
      event.durationMinutes,
      event.category,
      event.isVacation,
      event.source,
      event.sourceCalendar ?? null,
      event.color ?? null,
      event.notes ?? null,
      event.recurring?.frequency ?? null,
      event.recurring?.until ?? null,
    ],
  );
}

export async function remove(id: string): Promise<void> {
  const userId = requireUserId();
  await query(`delete from calendar_events where user_id = $1 and id = $2`, [
    userId,
    id,
  ]);
}

export { remove as delete_ };
