/* NorthStar server — calendar routes
 *
 * HTTP mirror of electron/ipc/calendar.ts. Handles in-app calendar events
 * stored in the calendar_events Postgres table, scoped by req.userId.
 *
 * DEVICE CALENDAR: device:list-calendars and device:import-calendar-events
 * are NOT exposed here — they stay in the Electron shell because they rely
 * on macOS osascript to talk to Calendar.app, which cannot run on a Linux
 * server. The renderer keeps calling those channels via IPC.
 *
 * calendar:schedule is simplified compared to the Electron version: it
 * reads in-app events from Postgres and calls getScheduleContext with no
 * device integration, since the server has no device calendar access.
 */

import { Router } from "express";
import { query } from "../db/pool";
import { asyncHandler } from "../middleware/errorHandler";
import { getScheduleContext, summarizeScheduleForAI } from "../calendar";

export const calendarRouter = Router();

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

function rowToEvent(r: CalendarEventRow) {
  return {
    id: r.id,
    title: r.title,
    startDate: r.start_date,
    endDate: r.end_date,
    isAllDay: r.is_all_day,
    durationMinutes: r.duration_minutes,
    category: r.category,
    isVacation: r.is_vacation,
    source: r.source,
    sourceCalendar: r.source_calendar ?? undefined,
    color: r.color ?? undefined,
    notes: r.notes ?? undefined,
    recurringFreq: r.recurring_freq ?? undefined,
    recurringUntil: r.recurring_until ?? undefined,
  };
}

// POST /calendar/list-events — all events, or by date range
calendarRouter.post(
  "/list-events",
  asyncHandler(async (req, res) => {
    const p = (req.body ?? {}) as { startDate?: string; endDate?: string };
    let rows: CalendarEventRow[];
    if (p.startDate && p.endDate) {
      rows = await query<CalendarEventRow>(
        `select * from calendar_events
          where user_id = $1
            and start_date >= $2
            and start_date <= $3
          order by start_date asc`,
        [req.userId, p.startDate, p.endDate],
      );
    } else {
      rows = await query<CalendarEventRow>(
        `select * from calendar_events where user_id = $1 order by start_date asc`,
        [req.userId],
      );
    }
    res.json({ ok: true, events: rows.map(rowToEvent) });
  }),
);

// POST /calendar/upsert-event
calendarRouter.post(
  "/upsert-event",
  asyncHandler(async (req, res) => {
    const e = (req.body ?? {}) as Record<string, unknown>;
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
        String(e.id),
        req.userId,
        String(e.title ?? ""),
        String(e.startDate ?? ""),
        String(e.endDate ?? ""),
        Boolean(e.isAllDay),
        typeof e.durationMinutes === "number" ? e.durationMinutes : 60,
        String(e.category ?? "personal"),
        Boolean(e.isVacation),
        String(e.source ?? "manual"),
        e.sourceCalendar ?? null,
        e.color ?? null,
        e.notes ?? null,
        e.recurringFreq ?? null,
        e.recurringUntil ?? null,
      ],
    );
    res.json({ ok: true });
  }),
);

// POST /calendar/delete-event
calendarRouter.post(
  "/delete-event",
  asyncHandler(async (req, res) => {
    const p = (req.body ?? {}) as { id?: string };
    if (!p.id) {
      res.status(400).json({ ok: false, error: "missing id" });
      return;
    }
    await query(
      "delete from calendar_events where user_id = $1 and id = $2",
      [req.userId, p.id],
    );
    res.json({ ok: true });
  }),
);

// POST /calendar/schedule — build schedule context for a date range.
// Device-calendar branch is disabled server-side (stays in Electron).
calendarRouter.post(
  "/schedule",
  asyncHandler(async (req, res) => {
    const p = (req.body ?? {}) as {
      startDate: string;
      endDate: string;
      inAppEvents?: unknown[];
    };
    // Prefer DB events over payload events for consistency
    const rows = await query<CalendarEventRow>(
      `select * from calendar_events
        where user_id = $1 and start_date >= $2 and start_date <= $3`,
      [req.userId, p.startDate, p.endDate],
    );
    const inAppEvents = rows.map((r) => ({
      id: r.id,
      title: r.title,
      startDate: r.start_date,
      endDate: r.end_date,
      isAllDay: r.is_all_day,
      durationMinutes: r.duration_minutes,
      isVacation: r.is_vacation,
      source: r.source,
    }));
    const scheduleCtx = await getScheduleContext(
      p.startDate,
      p.endDate,
      inAppEvents,
      undefined, // no device integration on server
    );
    res.json({
      ok: true,
      data: scheduleCtx,
      summary: summarizeScheduleForAI(scheduleCtx),
    });
  }),
);
