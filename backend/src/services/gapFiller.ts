/* ──────────────────────────────────────────────────────────
   Starward — Gap Filler (Initiative B Phase 4)

   Detects ≥15-minute gaps between today's booked ranges (calendar
   events + already-time-blocked tasks), picks a short task from the
   user's active goal plans, and writes it to `pending_tasks` with
   `status="ready"` and `payload.analysis.proposedSlot` so the
   existing `command:accept-task-proposal` path can promote it into
   a real daily_task.

   Proposals are pure ranking + filter — no AI call. Candidates come
   from each non-paused big goal's `plan.years[].months[].weeks[].days[].tasks`.
   ────────────────────────────────────────────────────────── */

import type { Goal } from "@starward/core";
import { detectGaps, MIN_GAP_MINUTES, type CalendarGap } from "@starward/core";
import * as repos from "../repositories";

/** Hard cap on quick-win task duration (matches the "≤15 min" rule in the plan). */
export const MAX_GAP_TASK_DURATION = 15;

/** Fallback working hours when the user has no weeklyAvailability. */
const DEFAULT_WORKING_HOURS = { startHour: 9, endHour: 18 };

export interface GapFillerProposal {
  proposalId: string;
  gap: CalendarGap;
  task: {
    title: string;
    description: string;
    durationMinutes: number;
    goalId: string;
    goalTitle: string;
    planNodeId: string;
    priority: string;
    category: string;
  };
}

export interface ProposeGapFillersResult {
  proposals: GapFillerProposal[];
  gaps: CalendarGap[];
  skipped: boolean;
  reason?: string;
}

interface PlanTaskCandidate {
  goalId: string;
  goalTitle: string;
  planNodeId: string;
  title: string;
  description: string;
  durationMinutes: number;
  priority: string;
  category: string;
}

function jsDayToTimeBlockDay(jsDay: number): number {
  return jsDay === 0 ? 6 : jsDay - 1;
}

/** Narrow the full-week availability grid to today's [startHour, endHour]
 *  envelope. Returns default hours when the user has no availability. */
function workingHoursForDate(
  weeklyAvailability: { day: number; hour: number }[] | undefined,
  dateIso: string,
): { startHour: number; endHour: number } {
  const [y, m, d] = dateIso.split("-").map((s) => parseInt(s, 10));
  if (!y || !m || !d) return DEFAULT_WORKING_HOURS;
  const jsDay = new Date(y, m - 1, d).getDay();
  const tbDay = jsDayToTimeBlockDay(jsDay);
  const slots = (weeklyAvailability ?? []).filter((tb) => tb.day === tbDay);
  if (slots.length === 0) return DEFAULT_WORKING_HOURS;
  let min = 24;
  let max = 0;
  for (const s of slots) {
    if (s.hour < min) min = s.hour;
    if (s.hour + 1 > max) max = s.hour + 1;
  }
  if (min >= max) return DEFAULT_WORKING_HOURS;
  return { startHour: min, endHour: max };
}

/** Walk each non-paused big goal's nested plan tree and return today's
 *  short task nodes. Mirrors the traversal in dailyTaskGeneration's
 *  buildGoalPlanSummaries but simpler — no week/day label matching;
 *  we return every task under today's day node(s) and let the gap
 *  matcher pick one per gap. */
function collectShortPlanTasks(
  goals: Goal[],
  dateIso: string,
  maxDuration: number,
): PlanTaskCandidate[] {
  const d = new Date(dateIso + "T00:00:00");
  const weekdayLong = d
    .toLocaleDateString("en-US", { weekday: "long" })
    .toLowerCase();
  const weekdayShort = d
    .toLocaleDateString("en-US", { weekday: "short" })
    .toLowerCase();
  const monthDay = d
    .toLocaleDateString("en-US", { month: "short", day: "numeric" })
    .toLowerCase();

  const dayMatchesToday = (label: string): boolean => {
    const l = (label ?? "").toLowerCase().trim();
    if (!l) return false;
    if (l === dateIso || l.includes(dateIso)) return true;
    if (l === monthDay || l.includes(monthDay)) return true;
    if (l === weekdayLong || l === weekdayShort || l.startsWith(`${weekdayShort} `)) return true;
    return false;
  };

  const out: PlanTaskCandidate[] = [];
  for (const g of goals) {
    if (g.status === "paused") continue;
    if (g.goalType !== "big" && g.scope !== "big") continue;
    if (!g.plan || !Array.isArray(g.plan.years)) continue;
    for (const year of g.plan.years) {
      for (const month of year.months) {
        for (const week of month.weeks) {
          if (week.locked) continue;
          for (const day of week.days) {
            if (!dayMatchesToday(day.label)) continue;
            for (const t of day.tasks) {
              if (t.completed) continue;
              if (t.durationMinutes > maxDuration) continue;
              out.push({
                goalId: g.id,
                goalTitle: g.title,
                planNodeId: t.id,
                title: t.title,
                description: t.description,
                durationMinutes: t.durationMinutes,
                priority: t.priority,
                category: t.category,
              });
            }
          }
        }
      }
    }
  }
  return out;
}

function priorityRank(priority: string): number {
  if (priority === "must-do") return 0;
  if (priority === "should-do") return 1;
  return 2;
}

export async function proposeGapFillers(
  dateIso: string,
): Promise<ProposeGapFillersResult> {
  const user = await repos.users.get();
  const flag = user?.settings?.gapFillersEnabled === true;
  if (!flag) {
    return { proposals: [], gaps: [], skipped: true, reason: "flag_off" };
  }

  void user;
  const workingHours = workingHoursForDate(undefined, dateIso);

  // Build booked ranges from today's scheduled tasks. A task with a time
  // block has either ISO columns OR legacy payload HH:MM — handle both.
  const todaysTasks = await repos.dailyTasks.listForDate(dateIso);
  const booked: { startIso: string; endIso: string }[] = [];
  for (const t of todaysTasks) {
    if (t.scheduledStartIso && t.scheduledEndIso) {
      booked.push({ startIso: t.scheduledStartIso, endIso: t.scheduledEndIso });
      continue;
    }
    const pl = t.payload as Record<string, unknown>;
    const start = pl?.scheduledTime as string | undefined;
    const end = pl?.scheduledEndTime as string | undefined;
    if (typeof start === "string" && typeof end === "string") {
      booked.push({
        startIso: `${dateIso}T${start}:00`,
        endIso: `${dateIso}T${end}:00`,
      });
    }
  }

  const gaps = detectGaps({
    dateIso,
    booked,
    workingHours,
    minGapMinutes: MIN_GAP_MINUTES,
  });
  if (gaps.length === 0) {
    return { proposals: [], gaps: [], skipped: false };
  }

  // Collect candidates. Exclude plan-node IDs already materialized into
  // today's daily_tasks so we don't propose the same task twice.
  const alreadyScheduled = new Set(
    todaysTasks.map((t) => t.planNodeId).filter((x): x is string => !!x),
  );
  const goals = await repos.goals.list();
  const allCandidates = collectShortPlanTasks(
    goals,
    dateIso,
    MAX_GAP_TASK_DURATION,
  ).filter((c) => !alreadyScheduled.has(c.planNodeId));

  if (allCandidates.length === 0) {
    return { proposals: [], gaps, skipped: false };
  }

  // Rank: lower priorityRank first (must-do > should-do > bonus), then
  // longer duration (favor tasks that fill more of the gap).
  const ranked = allCandidates
    .slice()
    .sort(
      (a, b) =>
        priorityRank(a.priority) - priorityRank(b.priority) ||
        b.durationMinutes - a.durationMinutes,
    );

  const used = new Set<string>();
  const proposals: GapFillerProposal[] = [];

  for (const gap of gaps) {
    // Find the best unused candidate that fits this gap.
    const pick = ranked.find(
      (c) => !used.has(c.planNodeId) && c.durationMinutes <= gap.durationMinutes,
    );
    if (!pick) continue;
    used.add(pick.planNodeId);

    // Clip proposed slot to the task's duration within the gap (start-aligned).
    const startMinutes = parseInt(gap.startIso.slice(11, 13), 10) * 60 +
      parseInt(gap.startIso.slice(14, 16), 10);
    const endMinutes = startMinutes + pick.durationMinutes;
    const endHH = String(Math.floor(endMinutes / 60)).padStart(2, "0");
    const endMM = String(endMinutes % 60).padStart(2, "0");
    const proposedEndIso = `${dateIso}T${endHH}:${endMM}:00`;

    const proposalId = `gap:${dateIso}:${pick.planNodeId}`;
    await repos.pendingTasks.insert({
      id: proposalId,
      source: "gap-filler",
      title: pick.title,
      status: "ready",
      payload: {
        userInput: `Gap filler: ${pick.title}`,
        analysis: {
          title: pick.title,
          description: pick.description,
          durationMinutes: pick.durationMinutes,
          category: pick.category,
          priority: pick.priority,
          goalId: pick.goalId,
          planNodeId: pick.planNodeId,
          suggestedDate: dateIso,
          proposedSlot: {
            startIso: gap.startIso,
            endIso: proposedEndIso,
          },
          source: "gap-filler",
        },
      },
    });

    proposals.push({
      proposalId,
      gap,
      task: pick,
    });
  }

  return { proposals, gaps, skipped: false };
}
