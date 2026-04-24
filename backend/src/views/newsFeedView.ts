/* Starward server — news feed view resolver
 *
 * NewsFeedPage renders two things: the list of goals (to build the
 * briefing query) and the user's settings.enableNewsFeed flag (to
 * decide whether to fetch at all). Everything else (the briefing
 * payload itself) is fetched by a separate AI endpoint and is not
 * part of this view.
 */

import * as repos from "../repositories";
import type { Goal } from "@starward/core";

export interface NewsFeedView {
  goals: Goal[];
  enableNewsFeed: boolean;
}

export async function resolveNewsFeedView(): Promise<NewsFeedView> {
  const [goals, user] = await Promise.all([
    repos.goals.list(),
    repos.users.get(),
  ]);
  return {
    goals,
    enableNewsFeed: Boolean(user?.settings?.enableNewsFeed),
  };
}
