/* ──────────────────────────────────────────────────────────
   NorthStar — Schedule context builder

   Reads scheduled tasks (those with a scheduledTime in payload)
   from the daily_tasks table and builds a day-by-day free/busy
   summary consumed by the AI handlers.
   ────────────────────────────────────────────────────────── */

import * as repos from "./repositories";

// ── Shared interfaces ───────────────────────────────────

export interface DaySchedule {
  date: string;
  events: Array<{
    title: string;
    startTime: string;
    endTime: string;
    isAllDay: boolean;
    durationMinutes: number;
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

// ── Schedule builder ────────────────────────────────────

/**
 * Build a schedule context for the AI by reading scheduled tasks from the DB.
 */
export async function getScheduleContext(
  startDate: string,
  endDate: string,
): Promise<ScheduleContext> {
  const taskRecords = await repos.dailyTasks.listForDateRange(startDate, endDate);

  // Build day-by-day schedule
  const start = new Date(startDate);
  const end = new Date(endDate);
  const days: DaySchedule[] = [];

  // Index tasks by date
  const tasksByDate = new Map<string, typeof taskRecords>();
  for (const t of taskRecords) {
    const arr = tasksByDate.get(t.date) ?? [];
    arr.push(t);
    tasksByDate.set(t.date, arr);
  }

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split("T")[0];
    const dayOfWeek = d.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    const dayTasks = tasksByDate.get(dateStr) ?? [];
    // Only count tasks with scheduledTime as "calendar blocks"
    const scheduledTasks = dayTasks.filter(
      (t) => (t.payload as Record<string, unknown>).scheduledTime,
    );

    const busyMinutes = scheduledTasks.reduce(
      (sum, t) => sum + ((t.payload as Record<string, unknown>).durationMinutes as number ?? 30),
      0,
    );
    const freeMinutes = Math.max(0, WAKING_HOURS_MINUTES - busyMinutes);

    const isVacation =
      dayTasks.some((t) => (t.payload as Record<string, unknown>).isVacation) ||
      dayTasks.some(
        (t) =>
          (t.payload as Record<string, unknown>).isAllDay &&
          VACATION_KEYWORDS.some((kw) => t.title.toLowerCase().includes(kw)),
      );

    days.push({
      date: dateStr,
      events: scheduledTasks.map((t) => {
        const p = t.payload as Record<string, unknown>;
        return {
          title: t.title,
          startTime: (p.scheduledTime as string) ?? "",
          endTime: (p.scheduledEndTime as string) ?? "",
          isAllDay: (p.isAllDay as boolean) ?? false,
          durationMinutes: (p.durationMinutes as number) ?? 30,
        };
      }),
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
        vacLabel =
          day.events.find((e) =>
            e.isAllDay && VACATION_KEYWORDS.some((kw) => e.title.toLowerCase().includes(kw)),
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
    lines.push(`  ${d.date}: ${d.freeMinutes}min free${tags.length ? ` [${tags.join(", ")}]` : ""}${eventCount > 0 ? ` (${eventCount} scheduled tasks)` : ""}`);
  }

  return lines.join("\n");
}
