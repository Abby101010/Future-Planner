/* NorthStar — reminders table */

import { getDB } from "./connection";

export interface DBReminder {
  id: string;
  title: string;
  description: string;
  reminder_time: string;
  date: string;
  acknowledged: number;
  acknowledged_at: string | null;
  repeat: string | null;
  source: string;
  created_at: string;
}

export async function getAllReminders(): Promise<DBReminder[]> {
  const d = getDB();
  return d
    .prepare("SELECT * FROM reminders ORDER BY reminder_time")
    .all() as DBReminder[];
}

export async function getRemindersByDate(date: string): Promise<DBReminder[]> {
  const d = getDB();
  return d
    .prepare("SELECT * FROM reminders WHERE date = ? ORDER BY reminder_time")
    .all(date) as DBReminder[];
}

export async function upsertReminder(r: {
  id: string;
  title: string;
  description: string;
  reminderTime: string;
  date: string;
  acknowledged: boolean;
  repeat: string | null;
  source: string;
}): Promise<void> {
  const d = getDB();
  d.prepare(
    `INSERT INTO reminders (id, title, description, reminder_time, date, acknowledged, repeat, source)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT (id) DO UPDATE SET
       title=excluded.title, description=excluded.description,
       reminder_time=excluded.reminder_time, date=excluded.date,
       acknowledged=excluded.acknowledged, repeat=excluded.repeat,
       source=excluded.source`,
  ).run(
    r.id,
    r.title,
    r.description,
    r.reminderTime,
    r.date,
    r.acknowledged ? 1 : 0,
    r.repeat,
    r.source,
  );
}

export async function acknowledgeReminder(id: string): Promise<void> {
  const d = getDB();
  d.prepare(
    "UPDATE reminders SET acknowledged = 1, acknowledged_at = datetime('now') WHERE id = ?",
  ).run(id);
}

export async function deleteReminder(id: string): Promise<void> {
  const d = getDB();
  d.prepare("DELETE FROM reminders WHERE id = ?").run(id);
}
