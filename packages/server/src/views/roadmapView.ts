/* NorthStar server — roadmap view resolver
 *
 * RoadmapPage is a thin wrapper over a single `Roadmap` object that
 * currently lives inside the legacy app_store row under key "roadmap".
 * The new entity tables don't model Roadmap yet (the big-goal plan is
 * now stored as goal_plan_nodes per-goal instead), so the view falls
 * back to app_store.
 *
 * TODO(phase6): once RoadmapPage is rewritten to derive its data from
 * the goals + goal_plan_nodes tables, delete this fallback.
 */

import type { Roadmap } from "@northstar/core";
import { query } from "../db/pool";
import { requireUserId } from "../repositories/_context";

export interface RoadmapView {
  roadmap: Roadmap | null;
}

async function readAppStoreKey<T>(key: string): Promise<T | null> {
  const userId = requireUserId();
  const rows = await query<{ value: T }>(
    `select value from app_store where user_id = $1 and key = $2`,
    [userId, key],
  );
  return rows.length > 0 ? (rows[0].value as T) : null;
}

export async function resolveRoadmapView(): Promise<RoadmapView> {
  // TODO(phase6): move to derived view over goals + goal_plan_nodes.
  const roadmap = await readAppStoreKey<Roadmap>("roadmap");
  return { roadmap };
}
