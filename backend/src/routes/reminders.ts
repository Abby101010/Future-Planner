/* NorthStar server — reminder routes
 *
 * HTTP mirror of electron/ipc/reminder.ts. Scoped by req.userId.
 */

import { Router } from "express";
import { query } from "../db/pool";
import { asyncHandler } from "../middleware/errorHandler";

export const remindersRouter = Router();

interface ReminderRow {
  id: string;
  title: string;
  description: string;
  reminder_time: string;
  date: string;
  acknowledged: boolean;
  acknowledged_at: string | null;
  repeat: string | null;
  source: string;
  created_at: string;
}

// POST /reminder/list — all reminders, or by date
remindersRouter.post(
  "/list",
  asyncHandler(async (req, res) => {
    const p = (req.body ?? {}) as { date?: string };
    let rows: ReminderRow[];
    if (p.date) {
      rows = await query<ReminderRow>(
        `select * from reminders
          where user_id = $1 and date = $2
          order by reminder_time`,
        [req.userId, p.date],
      );
    } else {
      rows = await query<ReminderRow>(
        `select * from reminders where user_id = $1 order by reminder_time`,
        [req.userId],
      );
    }
    res.json({ ok: true, data: rows });
  }),
);

// POST /reminder/upsert
remindersRouter.post(
  "/upsert",
  asyncHandler(async (req, res) => {
    const r = (req.body ?? {}) as Record<string, unknown>;
    await query(
      `insert into reminders (
         id, user_id, title, description, reminder_time, date,
         acknowledged, repeat, source
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (user_id, id) do update set
         title = excluded.title,
         description = excluded.description,
         reminder_time = excluded.reminder_time,
         date = excluded.date,
         acknowledged = excluded.acknowledged,
         repeat = excluded.repeat,
         source = excluded.source`,
      [
        String(r.id),
        req.userId,
        String(r.title ?? ""),
        String(r.description ?? ""),
        String(r.reminderTime ?? ""),
        String(r.date ?? ""),
        Boolean(r.acknowledged),
        r.repeat ?? null,
        String(r.source ?? "chat"),
      ],
    );
    res.json({ ok: true });
  }),
);

// POST /reminder/acknowledge
remindersRouter.post(
  "/acknowledge",
  asyncHandler(async (req, res) => {
    const p = (req.body ?? {}) as { id?: string };
    if (!p.id) {
      res.status(400).json({ ok: false, error: "missing id" });
      return;
    }
    await query(
      `update reminders
          set acknowledged = true, acknowledged_at = now()
        where user_id = $1 and id = $2`,
      [req.userId, p.id],
    );
    res.json({ ok: true });
  }),
);

// POST /reminder/delete
remindersRouter.post(
  "/delete",
  asyncHandler(async (req, res) => {
    const p = (req.body ?? {}) as { id?: string };
    if (!p.id) {
      res.status(400).json({ ok: false, error: "missing id" });
      return;
    }
    await query(
      "delete from reminders where user_id = $1 and id = $2",
      [req.userId, p.id],
    );
    res.json({ ok: true });
  }),
);
