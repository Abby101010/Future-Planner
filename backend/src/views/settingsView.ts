/* Starward server — settings view resolver
 *
 * SettingsPage renders user profile (name, settings), behavior-profile,
 * a memory summary, and model-config state. Time map (weeklyAvailability)
 * was removed from the product — no longer returned here.
 */

import * as repos from "../repositories";
import type { UserProfile, UserSettings } from "@starward/core";
import type { BehaviorProfileEntry } from "../repositories/behaviorProfileRepo";

export interface SettingsView {
  user: UserProfile | null;
  settings: UserSettings | null;
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
    behaviorProfile,
  };
}
