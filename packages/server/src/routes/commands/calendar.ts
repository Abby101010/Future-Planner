/**
 * Calendar event and reminder command handlers.
 */

import { repos } from "./_helpers";

export async function cmdUpsertCalendarEvent(
  body: Record<string, unknown>,
): Promise<unknown> {
  const event = body.event as Parameters<typeof repos.calendar.upsert>[0];
  if (!event || typeof event !== "object" || !(event as { id?: string }).id) {
    throw new Error(
      "command:upsert-calendar-event requires args.event with an id",
    );
  }
  await repos.calendar.upsert(event);
  return { ok: true, eventId: event.id };
}

export async function cmdDeleteCalendarEvent(
  body: Record<string, unknown>,
): Promise<unknown> {
  const eventId = body.eventId as string | undefined;
  if (!eventId) {
    throw new Error("command:delete-calendar-event requires args.eventId");
  }
  await repos.calendar.remove(eventId);
  return { ok: true, eventId };
}

export async function cmdUpsertReminder(
  body: Record<string, unknown>,
): Promise<unknown> {
  const reminder = body.reminder as Parameters<
    typeof repos.reminders.upsert
  >[0];
  if (
    !reminder ||
    typeof reminder !== "object" ||
    !(reminder as { id?: string }).id
  ) {
    throw new Error("command:upsert-reminder requires args.reminder with an id");
  }
  await repos.reminders.upsert(reminder);
  return { ok: true, reminderId: reminder.id };
}

export async function cmdAcknowledgeReminder(
  body: Record<string, unknown>,
): Promise<unknown> {
  const reminderId = body.reminderId as string | undefined;
  if (!reminderId) {
    throw new Error("command:acknowledge-reminder requires args.reminderId");
  }
  await repos.reminders.acknowledge(reminderId);
  return { ok: true, reminderId };
}

export async function cmdDeleteReminder(
  body: Record<string, unknown>,
): Promise<unknown> {
  const reminderId = body.reminderId as string | undefined;
  if (!reminderId) {
    throw new Error("command:delete-reminder requires args.reminderId");
  }
  await repos.reminders.remove(reminderId);
  return { ok: true, reminderId };
}

export async function cmdDeleteRemindersBatch(
  body: Record<string, unknown>,
): Promise<unknown> {
  const ids = body.reminderIds as string[] | undefined;
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new Error(
      "command:delete-reminders-batch requires args.reminderIds (non-empty array)",
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
