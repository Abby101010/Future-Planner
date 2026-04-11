/* NorthStar server — onboarding view resolver
 *
 * OnboardingPage (and WelcomePage before it) both read the same small
 * slice of state: the current user profile (to decide which step to
 * open on) and — during onboarding itself — the weekly availability
 * grid from the in-progress user object. We return both fields
 * shape-ready for the client to render without computing anything.
 *
 * TODO(phase6): once user is its own table, drop the app_store fallback.
 */

import { query } from "../db/pool";
import { requireUserId } from "../repositories/_context";
import type { TimeBlock, UserProfile } from "@northstar/core";

export interface OnboardingView {
  user: UserProfile | null;
  onboardingComplete: boolean;
  weeklyAvailability: TimeBlock[];
  /** Empty string when no user yet. Convenience so the client doesn't
   *  have to guard against null when binding the intent textarea. */
  goalRaw: string;
}

async function readAppStoreKey<T>(key: string): Promise<T | null> {
  const userId = requireUserId();
  const rows = await query<{ value: T }>(
    `select value from app_store where user_id = $1 and key = $2`,
    [userId, key],
  );
  return rows.length > 0 ? (rows[0].value as T) : null;
}

export async function resolveOnboardingView(): Promise<OnboardingView> {
  // TODO(phase6): user + settings come out of app_store in phase 6.
  const user = await readAppStoreKey<UserProfile>("user");
  return {
    user,
    onboardingComplete: Boolean(user?.onboardingComplete),
    weeklyAvailability: user?.weeklyAvailability ?? [],
    goalRaw: user?.goalRaw ?? "",
  };
}
