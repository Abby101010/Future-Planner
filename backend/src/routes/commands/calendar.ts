/**
 * Reminder command handlers.
 *
 * All reminder commands are pure DB operations — no AI involvement.
 * cmdUpsertReminder follows the contract documented in
 * API_CONTRACT.md (`{id?, title, date, ...}` — flat, id optional).
 * If `id` is missing, the server generates a UUID. Other reminder
 * commands (acknowledge / delete / delete-batch) use flat scalar
 * args; this one matches that convention.
 */

import { randomUUID } from "node:crypto";
import type { Reminder } from "@starward/core";
import { repos } from "./_helpers";

export async function cmdUpsertReminder(
  body: Record<string, unknown>,
): Promise<unknown> {
  // Tolerate the legacy `{ reminder: {...} }` wrapper for any older
  // caller that still sends it. New callers use the flat shape per
  // the API contract.
  const flat: Record<string, unknown> =
    body.reminder && typeof body.reminder === "object"
      ? (body.reminder as Record<string, unknown>)
      : body;

  const id =
    typeof flat.id === "string" && flat.id ? (flat.id as string) : randomUUID();
  const title = typeof flat.title === "string" ? (flat.title as string) : "";
  const date =
    typeof flat.date === "string" && flat.date
      ? (flat.date as string)
      : new Date().toISOString().slice(0, 10);

  if (!title.trim()) {
    throw new Error("command:upsert-reminder requires a non-empty `title`");
  }

  // Fill the rest of the Reminder shape from caller-provided fields,
  // falling back to safe defaults so a minimal `{title, date}` body
  // produces a valid row. The repo upsert reads every field on the
  // type — see backend/core/src/types/index.ts:918 (`Reminder`).
  const reminder: Reminder = {
    id,
    title: title.trim(),
    description: typeof flat.description === "string" ? (flat.description as string) : "",
    reminderTime:
      typeof flat.reminderTime === "string" && flat.reminderTime
        ? (flat.reminderTime as string)
        : new Date(`${date}T09:00:00`).toISOString(),
    date,
    acknowledged: Boolean(flat.acknowledged),
    acknowledgedAt:
      typeof flat.acknowledgedAt === "string"
        ? (flat.acknowledgedAt as string)
        : undefined,
    repeat:
      flat.repeat === "daily" || flat.repeat === "weekly" || flat.repeat === "monthly"
        ? (flat.repeat as "daily" | "weekly" | "monthly")
        : null,
    source: flat.source === "chat" ? "chat" : "manual",
    createdAt:
      typeof flat.createdAt === "string" && flat.createdAt
        ? (flat.createdAt as string)
        : new Date().toISOString(),
  };

  await repos.reminders.upsert(reminder);
  return { ok: true, reminderId: id };
}

/**
 * Pick a single reminder id from the body. Canonical key is `id` per
 * API_CONTRACT.md (line 340–341). `reminderId` is accepted as a legacy
 * fallback so any caller still on the off-spec shape during a deploy
 * window doesn't 500. New code should send `id`.
 */
function pickReminderId(body: Record<string, unknown>): string | undefined {
  const id = body.id;
  if (typeof id === "string" && id) return id;
  const legacy = body.reminderId;
  if (typeof legacy === "string" && legacy) return legacy;
  return undefined;
}

/** Same accept-either rule for batch ops: `ids` is canonical, `reminderIds`
 *  is the legacy fallback. */
function pickReminderIds(body: Record<string, unknown>): string[] | undefined {
  const ids = body.ids;
  if (Array.isArray(ids)) return ids as string[];
  const legacy = body.reminderIds;
  if (Array.isArray(legacy)) return legacy as string[];
  return undefined;
}

export async function cmdAcknowledgeReminder(
  body: Record<string, unknown>,
): Promise<unknown> {
  const reminderId = pickReminderId(body);
  if (!reminderId) {
    throw new Error("command:acknowledge-reminder requires args.id");
  }
  await repos.reminders.acknowledge(reminderId);
  return { ok: true, reminderId };
}

export async function cmdDeleteReminder(
  body: Record<string, unknown>,
): Promise<unknown> {
  const reminderId = pickReminderId(body);
  if (!reminderId) {
    throw new Error("command:delete-reminder requires args.id");
  }
  await repos.reminders.remove(reminderId);
  return { ok: true, reminderId };
}

export async function cmdDeleteRemindersBatch(
  body: Record<string, unknown>,
): Promise<unknown> {
  const ids = pickReminderIds(body);
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new Error(
      "command:delete-reminders-batch requires args.ids (non-empty array)",
    );
  }
  let deletedCount = 0;
  for (const id of ids) {
    if (typeof id === "string" && id) {
      await repos.reminders.remove(id);
      deletedCount++;
    }
  }
  return { ok: true, deletedCount };
}
