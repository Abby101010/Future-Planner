/* NorthStar — calendar_events table */

import { getDB } from "./connection";

export interface DBCalendarEvent {
  id: string;
  title: string;
  start_date: string;
  end_date: string;
  is_all_day: boolean | number;
  duration_minutes: number;
  category: string;
  is_vacation: boolean | number;
  source: string;
  source_calendar: string | null;
  color: string | null;
  notes: string | null;
  recurring_freq: string | null;
  recurring_until: string | null;
}

function normalizeEvent(row: DBCalendarEvent): DBCalendarEvent {
  return {
    ...row,
    is_all_day: !!row.is_all_day,
    is_vacation: !!row.is_vacation,
  };
}

export async function getAllCalendarEvents(): Promise<DBCalendarEvent[]> {
  const d = getDB();
  const rows = d
    .prepare("SELECT * FROM calendar_events ORDER BY start_date")
    .all() as DBCalendarEvent[];
  return rows.map(normalizeEvent);
}

export async function getCalendarEventsByRange(
  startDate: string,
  endDate: string,
): Promise<DBCalendarEvent[]> {
  const d = getDB();
  const rows = d
    .prepare(
      "SELECT * FROM calendar_events WHERE start_date >= ? AND start_date <= ? ORDER BY start_date",
    )
    .all(startDate, endDate) as DBCalendarEvent[];
  return rows.map(normalizeEvent);
}

export async function upsertCalendarEvent(event: {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  isAllDay: boolean;
  durationMinutes: number;
  category: string;
  isVacation: boolean;
  source: string;
  sourceCalendar?: string;
  color?: string;
  notes?: string;
  recurringFreq?: string;
  recurringUntil?: string;
}): Promise<void> {
  const d = getDB();
  d.prepare(
    `INSERT INTO calendar_events
       (id, title, start_date, end_date, is_all_day, duration_minutes,
        category, is_vacation, source, source_calendar, color, notes,
        recurring_freq, recurring_until)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT (id) DO UPDATE SET
       title=excluded.title, start_date=excluded.start_date,
       end_date=excluded.end_date, is_all_day=excluded.is_all_day,
       duration_minutes=excluded.duration_minutes,
       category=excluded.category, is_vacation=excluded.is_vacation,
       source=excluded.source, source_calendar=excluded.source_calendar,
       color=excluded.color, notes=excluded.notes,
       recurring_freq=excluded.recurring_freq,
       recurring_until=excluded.recurring_until,
       updated_at=datetime('now')`,
  ).run(
    event.id,
    event.title,
    event.startDate,
    event.endDate,
    event.isAllDay ? 1 : 0,
    event.durationMinutes,
    event.category,
    event.isVacation ? 1 : 0,
    event.source,
    event.sourceCalendar || null,
    event.color || null,
    event.notes || null,
    event.recurringFreq || null,
    event.recurringUntil || null,
  );
}

export async function deleteCalendarEvent(id: string): Promise<void> {
  const d = getDB();
  d.prepare("DELETE FROM calendar_events WHERE id = ?").run(id);
}
