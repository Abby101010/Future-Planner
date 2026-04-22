/* NorthStar server — calendar routes
 *
 * After the tasks/calendar unification, calendar events no longer exist
 * as a separate entity. The schedule endpoint now reads from daily_tasks.
 */

import { Router } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import { getScheduleContext, summarizeScheduleForAI } from "../calendar";

export const calendarRouter = Router();

// POST /calendar/schedule — build schedule context for a date range.
calendarRouter.post(
  "/schedule",
  asyncHandler(async (_req, res) => {
    const p = (_req.body ?? {}) as {
      startDate: string;
      endDate: string;
    };
    const scheduleCtx = await getScheduleContext(p.startDate, p.endDate);
    res.json({
      ok: true,
      data: scheduleCtx,
      summary: summarizeScheduleForAI(scheduleCtx),
    });
  }),
);
