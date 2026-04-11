/* NorthStar server — settings view resolver
 *
 * SettingsPage renders user profile (name, settings, weeklyAvailability),
 * the behavior-profile table, a memory summary, and model-config state.
 * The first three now live in the `users` table (migration 0004).
 * Model-config + memory summary are out of scope for the view contract
 * (they have their own routes still).
 */

import * as repos from "../repositories";
import type { UserProfile, UserSettings, TimeBlock } from "@northstar/core";
import type { BehaviorProfileEntry } from "../repositories/behaviorProfileRepo";

export interface SettingsView {
  user: UserProfile | null;
  settings: UserSettings | null;
  weeklyAvailability: TimeBlock[];
  behaviorProfile: BehaviorProfileEntry[];
}

export async function resolveSettingsView(): Promise<SettingsView> {
  const [user, behaviorProfile] = await Promise.all([
    repos.users.get(),
    repos.behaviorProfile.listByCategory(),
  ]);

  return {
    user,
    settings: user?.settings ?? null,
    weeklyAvailability: user?.weeklyAvailability ?? [],
    behaviorProfile,
  };
}
