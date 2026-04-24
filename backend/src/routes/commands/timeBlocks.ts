/* Starward server — time-block / project-tag / duration-estimate commands
 *
 * Phase A additive surface. Three new commands:
 *   - command:estimate-task-durations → batch AI duration estimates
 *   - command:set-task-time-block     → dual-write ISO + legacy HH:MM
 *   - command:set-task-project-tag    → straight column write
 */

import type { QueryKind } from "@starward/core";
import { repos } from "./_helpers";
import { estimateDurations } from "../../agents/durationEstimator";
import { timezoneStore } from "../../dateUtils";

function decomposeIsoInTz(iso: string, tz: string): { date: string; timeOfDay: string } {
  const d = new Date(iso);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = fmt.formatToParts(d).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== "literal") acc[p.type] = p.value;
    return acc;
  }, {});
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    timeOfDay: `${hour}:${parts.minute}`,
  };
}

// ── command:estimate-task-durations ──────────────────────────

export async function cmdEstimateTaskDurations(
  body: Record<string, unknown>,
): Promise<{ updated: number; _invalidateExtra?: QueryKind[] }> {
  const taskIds = Array.isArray(body.taskIds)
    ? (body.taskIds as unknown[]).filter((s): s is string => typeof s === "string")
    : [];
  const contextHint = typeof body.contextHint === "string" ? body.contextHint : undefined;

  if (taskIds.length === 0) return { updated: 0 };

  const records = await Promise.all(taskIds.map((id) => repos.dailyTasks.get(id)));
  const present = records
    .map((r, i) => ({ id: taskIds[i], rec: r }))
    .filter((x): x is { id: string; rec: NonNullable<typeof records[number]> } => x.rec !== null);

  if (present.length === 0) return { updated: 0 };

  const { estimates } = await estimateDurations({
    tasks: present.map((p) => ({
      id: p.id,
      title: p.rec.title,
      description: (p.rec.payload.description as string | undefined) ?? undefined,
      category: (p.rec.payload.category as string | undefined) ?? undefined,
    })),
    contextHint,
  });

  let updated = 0;
  for (const p of present) {
    const est = estimates[p.id];
    if (!est) continue;
    await repos.dailyTasks.update(p.id, {
      estimatedDurationMinutes: est.minutes,
    });
    updated += 1;
  }

  return { updated };
}

// ── command:set-task-time-block ──────────────────────────────

export async function cmdSetTaskTimeBlock(
  body: Record<string, unknown>,
): Promise<{ ok: true }> {
  const taskId = typeof body.taskId === "string" ? body.taskId : null;
  const scheduledStartIso = typeof body.scheduledStartIso === "string" ? body.scheduledStartIso : null;
  const scheduledEndIso = typeof body.scheduledEndIso === "string" ? body.scheduledEndIso : null;
  const timeBlockStatus = typeof body.timeBlockStatus === "string" ? body.timeBlockStatus : undefined;

  if (!taskId || !scheduledStartIso || !scheduledEndIso) {
    throw new Error("taskId, scheduledStartIso, and scheduledEndIso are required");
  }

  const existing = await repos.dailyTasks.get(taskId);
  if (!existing) throw new Error(`Task ${taskId} not found`);

  const tz = timezoneStore.getStore() || "UTC";
  const startLocal = decomposeIsoInTz(scheduledStartIso, tz);
  const endLocal = decomposeIsoInTz(scheduledEndIso, tz);

  // Dual-write: ISO columns + legacy payload HH:MM fields.
  await repos.dailyTasks.update(taskId, {
    scheduledStartIso,
    scheduledEndIso,
    timeBlockStatus: timeBlockStatus ?? existing.timeBlockStatus,
    // If the start date changed, move the row.
    date: startLocal.date,
    payload: {
      scheduledTime: startLocal.timeOfDay,
      scheduledEndTime: endLocal.timeOfDay,
    },
  });

  return { ok: true };
}

// ── command:set-task-project-tag ─────────────────────────────

export async function cmdSetTaskProjectTag(
  body: Record<string, unknown>,
): Promise<{ ok: true }> {
  const taskId = typeof body.taskId === "string" ? body.taskId : null;
  const projectTag = body.projectTag === null || typeof body.projectTag === "string"
    ? (body.projectTag as string | null)
    : undefined;

  if (!taskId) throw new Error("taskId is required");
  if (projectTag === undefined) throw new Error("projectTag must be a string or null");

  const existing = await repos.dailyTasks.get(taskId);
  if (!existing) throw new Error(`Task ${taskId} not found`);

  await repos.dailyTasks.update(taskId, { projectTag });

  return { ok: true };
}
