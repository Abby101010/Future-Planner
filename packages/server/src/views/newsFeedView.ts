/* NorthStar server — news feed view resolver
 *
 * NewsFeedPage renders two things off the store: the list of goals
 * (to build the briefing query) and the user's settings.enableNewsFeed
 * flag (to decide whether to fetch at all). Everything else (the
 * briefing payload itself) is fetched by a separate AI endpoint and is
 * not part of this view.
 *
 * TODO(phase6): read settings.enableNewsFeed from a dedicated settings
 * table once Phase 6 moves it out of app_store.
 */

import * as repos from "../repositories";
import { query } from "../db/pool";
import { requireUserId } from "../repositories/_context";
import type { Goal, UserProfile } from "@northstar/core";

export interface NewsFeedView {
  goals: Goal[];
  enableNewsFeed: boolean;
}

async function readAppStoreKey<T>(key: string): Promise<T | null> {
  const userId = requireUserId();
  const rows = await query<{ value: T }>(
    `select value from app_store where user_id = $1 and key = $2`,
    [userId, key],
  );
  return rows.length > 0 ? (rows[0].value as T) : null;
}

export async function resolveNewsFeedView(): Promise<NewsFeedView> {
  const goals = await repos.goals.list();
  // TODO(phase6): settings live on app_store.user today.
  const user = await readAppStoreKey<UserProfile>("user");
  const enableNewsFeed = Boolean(user?.settings?.enableNewsFeed);
  return { goals, enableNewsFeed };
}
