/* Starward server — roadmap view resolver
 *
 * RoadmapPage is a thin wrapper over a single `Roadmap` object that now
 * lives in the `roadmap` table (migration 0004). The new entity tables
 * don't replace Roadmap yet — the big-goal plan is stored as
 * goal_plan_nodes per-goal, but the Roadmap is a separate legacy shape
 * the RoadmapPage still renders.
 */

import type { Roadmap } from "@starward/core";
import * as repos from "../repositories";

export interface RoadmapView {
  roadmap: Roadmap | null;
}

export async function resolveRoadmapView(): Promise<RoadmapView> {
  const roadmap = await repos.roadmap.get();
  return { roadmap };
}
