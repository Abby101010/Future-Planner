/* ──────────────────────────────────────────────────────────
   NorthStar — Calendar integration

   Server-side schedule builder. The macOS device-calendar
   integration (osascript shell-out) was removed in phase 2a
   because it cannot run on Linux Fly. Only in-app events
   feed the schedule here.
   ────────────────────────────────────────────────────────── */

// ── Shared interfaces ───────────────────────────────────

export interface DaySchedule {
  date: string;
  events: Array<{
    title: string;
    startDate: string;
    endDate: string;
    isAllDay: boolean;
    durationMinutes: number;
    source: string;
  }>;
  busyMinutes: number;
  freeMinutes: number;
  isVacation: boolean;
  isWeekend: boolean;
}

export interface ScheduleContext {
  days: DaySchedule[];
  vacationPeriods: Array<{ start: string; end: string; label: string }>;
  averageFreeMinutesWeekday: number;
  averageFreeMinutesWeekend: number;
}

const WAKING_HOURS_MINUTES = 960; // 16 hours

const VACATION_KEYWORDS = [
  "vacation", "holiday", "pto", "off", "leave", "trip", "travel",
  "假期", "休假", "旅行", "出差",
];

// ── Schedule builder (in-app events only) ───────────────

interface InAppEvent {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  isAllDay: boolean;
  durationMinutes: number;
  isVacation: boolean;
  source: string;
}

/**
 * Build a schedule context for the AI.
 *
 * @param startDate  YYYY-MM-DD
 * @param endDate    YYYY-MM-DD
 * @param inAppEvents  Events from the NorthStar in-app calendar
 * @param _deviceIntegrations  Reserved: device integration was removed server-side in phase 2a
 */
export async function getScheduleContext(
  startDate: string,
  endDate: string,
  inAppEvents?: InAppEvent[],
  _deviceIntegrations?: { calendar?: { enabled: boolean; selectedCalendars: string[] } }
): Promise<ScheduleContext> {
  // Merge events from all sources
  const allEvents: Array<{
    title: string;
    startDate: string;
    endDate: string;
    isAllDay: boolean;
    durationMinutes: number;
    isVacation: boolean;
    source: string;
  }> = [];

  // 1. In-app events
  if (inAppEvents) {
    for (const e of inAppEvents) {
      const eStart = e.startDate.split("T")[0];
      if (eStart >= startDate && eStart <= endDate) {
        allEvents.push({
          title: e.title,
          startDate: e.startDate,
          endDate: e.endDate,
          isAllDay: e.isAllDay,
          durationMinutes: e.durationMinutes,
          isVacation: e.isVacation,
          source: "northstar",
        });
      }
    }
  }

  // Build day-by-day schedule
  const start = new Date(startDate);
  const end = new Date(endDate);
  const days: DaySchedule[] = [];

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split("T")[0];
    const dayOfWeek = d.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    const dayEvents = allEvents.filter((e) => {
      const eventDate = new Date(e.startDate).toISOString().split("T")[0];
      return eventDate === dateStr;
    });

    const busyMinutes = dayEvents.reduce((sum, e) => sum + e.durationMinutes, 0);
    const freeMinutes = Math.max(0, WAKING_HOURS_MINUTES - busyMinutes);

    const isVacation = dayEvents.some((e) => e.isVacation) ||
      dayEvents.some(
        (e) => e.isAllDay && VACATION_KEYWORDS.some((kw) => e.title.toLowerCase().includes(kw))
      );

    days.push({
      date: dateStr,
      events: dayEvents.map((e) => ({
        title: e.title,
        startDate: e.startDate,
        endDate: e.endDate,
        isAllDay: e.isAllDay,
        durationMinutes: e.durationMinutes,
        source: e.source,
      })),
      busyMinutes,
      freeMinutes,
      isVacation,
      isWeekend,
    });
  }

  // Detect contiguous vacation periods
  const vacationPeriods: Array<{ start: string; end: string; label: string }> = [];
  let vacStart: string | null = null;
  let vacLabel = "";

  for (const day of days) {
    if (day.isVacation) {
      if (!vacStart) {
        vacStart = day.date;
        vacLabel = day.events.find((e) =>
          e.isAllDay && VACATION_KEYWORDS.some((kw) => e.title.toLowerCase().includes(kw))
        )?.title || "Time off";
      }
    } else if (vacStart) {
      const prevDay = days[days.indexOf(day) - 1];
      vacationPeriods.push({ start: vacStart, end: prevDay.date, label: vacLabel });
      vacStart = null;
    }
  }
  if (vacStart) {
    vacationPeriods.push({ start: vacStart, end: days[days.length - 1].date, label: vacLabel });
  }

  // Averages
  const weekdays = days.filter((d) => !d.isWeekend && !d.isVacation);
  const weekends = days.filter((d) => d.isWeekend && !d.isVacation);
  const avgWeekday = weekdays.length > 0
    ? Math.round(weekdays.reduce((s, d) => s + d.freeMinutes, 0) / weekdays.length)
    : WAKING_HOURS_MINUTES;
  const avgWeekend = weekends.length > 0
    ? Math.round(weekends.reduce((s, d) => s + d.freeMinutes, 0) / weekends.length)
    : WAKING_HOURS_MINUTES;

  return { days, vacationPeriods, averageFreeMinutesWeekday: avgWeekday, averageFreeMinutesWeekend: avgWeekend };
}

// ── AI text summary ─────────────────────────────────────

export function summarizeScheduleForAI(ctx: ScheduleContext): string {
  const lines: string[] = [
    `SCHEDULE CONTEXT (next ${ctx.days.length} days):`,
    `Average free time: ${ctx.averageFreeMinutesWeekday} min/weekday, ${ctx.averageFreeMinutesWeekend} min/weekend`,
  ];

  if (ctx.vacationPeriods.length > 0) {
    lines.push(`\nUPCOMING TIME OFF:`);
    for (const vp of ctx.vacationPeriods) {
      lines.push(`  - ${vp.label}: ${vp.start} to ${vp.end}`);
    }
  }

  const busyDays = ctx.days.filter((d) => d.busyMinutes > 360 && !d.isVacation);
  if (busyDays.length > 0) {
    lines.push(`\nHEAVY DAYS (>6h committed):`);
    for (const d of busyDays.slice(0, 10)) {
      lines.push(`  - ${d.date} (${d.isWeekend ? "weekend" : "weekday"}): ${d.busyMinutes}min busy, ${d.freeMinutes}min free`);
    }
  }

  lines.push(`\nDAILY FREE TIME (next 14 days):`);
  for (const d of ctx.days.slice(0, 14)) {
    const tags = [];
    if (d.isWeekend) tags.push("weekend");
    if (d.isVacation) tags.push("VACATION");
    const eventCount = d.events.length;
    lines.push(`  ${d.date}: ${d.freeMinutes}min free${tags.length ? ` [${tags.join(", ")}]` : ""}${eventCount > 0 ? ` (${eventCount} events)` : ""}`);
  }

  return lines.join("\n");
}
