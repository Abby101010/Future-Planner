/* NorthStar server — settings view resolver
 *
 * SettingsPage renders user profile (name, settings, weeklyAvailability),
 * the behavior-profile table, a memory summary, and model-config state.
 * The first three live in legacy app_store + the behavior_profile_entries
 * table; model-config + memory summary are out of scope for the view
 * contract (they have their own routes still).
 *
 * TODO(phase6): migrate `user` + `user.settings` out of app_store into
 * a dedicated users/settings table; then delete the fallback reads here.
 */

import * as repos from "../repositories";
import { query } from "../db/pool";
import { requireUserId } from "../repositories/_context";
import type { UserProfile, UserSettings, TimeBlock } from "@northstar/core";
import type { BehaviorProfileEntry } from "../repositories/behaviorProfileRepo";

export interface SettingsView {
  user: UserProfile | null;
  settings: UserSettings | null;
  weeklyAvailability: TimeBlock[];
  behaviorProfile: BehaviorProfileEntry[];
}

async function readAppStoreKey<T>(key: string): Promise<T | null> {
  const userId = requireUserId();
  const rows = await query<{ value: T }>(
    `select value from app_store where user_id = $1 and key = $2`,
    [userId, key],
  );
  return rows.length > 0 ? (rows[0].value as T) : null;
}

export async function resolveSettingsView(): Promise<SettingsView> {
  // TODO(phase6): move user + settings to a dedicated users table.
  const user = await readAppStoreKey<UserProfile>("user");
  const settings = user?.settings ?? null;
  const weeklyAvailability = user?.weeklyAvailability ?? [];

  const behaviorProfile = await repos.behaviorProfile.listByCategory();

  return {
    user,
    settings,
    weeklyAvailability,
    behaviorProfile,
  };
}
