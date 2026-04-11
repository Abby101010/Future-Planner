/* NorthStar server — onboarding view resolver
 *
 * OnboardingPage (and WelcomePage before it) both read the same small
 * slice of state: the current user profile (to decide which step to
 * open on) and the weekly availability grid from the in-progress user
 * object. Backed by the `users` table.
 */

import * as repos from "../repositories";
import type { TimeBlock, UserProfile } from "@northstar/core";

export interface OnboardingView {
  user: UserProfile | null;
  onboardingComplete: boolean;
  weeklyAvailability: TimeBlock[];
  /** Empty string when no user yet. Convenience so the client doesn't
   *  have to guard against null when binding the intent textarea. */
  goalRaw: string;
}

export async function resolveOnboardingView(): Promise<OnboardingView> {
  const user = await repos.users.get();
  return {
    user,
    onboardingComplete: Boolean(user?.onboardingComplete),
    weeklyAvailability: user?.weeklyAvailability ?? [],
    goalRaw: user?.goalRaw ?? "",
  };
}
