/* NorthStar server — task notification routes
 *
 * Read-side of the watcher pipeline. Renderer polls these to surface
 * banners / badges and can mark rows acknowledged so they stop showing.
 */

import { Router } from "express";
import { query } from "../db/pool";
import { asyncHandler } from "../middleware/errorHandler";

export const notificationsRouter = Router();

interface NotificationRow {
  id: string;
  kind: string;
  context: string;
  title: string;
  body: string;
  priority: number;
  acknowledged: boolean;
  created_at: string;
}

// POST /notifications/list — unacknowledged first, newest first
notificationsRouter.post(
  "/list",
  asyncHandler(async (req, res) => {
    const rows = await query<NotificationRow>(
      `select id, kind, context, title, body, priority, acknowledged, created_at
         from task_notifications
        where user_id = $1
        order by acknowledged asc, priority desc, created_at desc
        limit 100`,
      [req.userId],
    );
    res.json({ ok: true, data: rows });
  }),
);

// POST /notifications/acknowledge { id }
notificationsRouter.post(
  "/acknowledge",
  asyncHandler(async (req, res) => {
    const p = (req.body ?? {}) as { id?: string };
    if (!p.id) {
      res.status(400).json({ ok: false, error: "missing id" });
      return;
    }
    await query(
      `update task_notifications
          set acknowledged = true
        where user_id = $1 and id = $2`,
      [req.userId, p.id],
    );
    res.json({ ok: true });
  }),
);

// POST /notifications/clear — drop all acknowledged rows
notificationsRouter.post(
  "/clear",
  asyncHandler(async (_req, res) => {
    await query(
      `delete from task_notifications
        where user_id = $1 and acknowledged = true`,
      [_req.userId],
    );
    res.json({ ok: true });
  }),
);
