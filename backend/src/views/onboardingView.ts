/* Starward server — onboarding view resolver
 *
 * Rebuilt to support the conversational 7-step onboarding flow (backend
 * complete; UI pending).
 *
 * The view returns everything the OnboardingPage needs to render whichever
 * step the user is currently on:
 *
 *   welcome        → first visit, no messages yet
 *   discovery      → open conversational intake (AI asks, user replies)
 *   goal-naming    → AI has proposed a goal; user confirms or edits
 *   clarification  → goalClarifier asks methodology-specific questions
 *   plan-reveal    → narrative plan presented; user edits before accepting
 *   first-task     → plan accepted; one concrete task for today committed
 *   complete       → onboardingComplete = true
 *
 * Onboarding conversation state is stored on users.payload.* (jsonb):
 *   - onboardingStep          : OnboardingStep
 *   - onboardingMessages      : OnboardingMessage[]
 *   - proposedGoal            : ProposedOnboardingGoal | undefined
 *   - onboardingGoalId        : string | undefined
 *   - onboardingFirstTaskId   : string | undefined
 */

import * as repos from "../repositories";
import type {
  OnboardingMessage,
  OnboardingStep,
  ProposedOnboardingGoal,
  UserProfile,
} from "@starward/core";
import { loadMemory } from "../memory";
import type { LongTermFact, SemanticPreference } from "../memory";
import { getCurrentUserId } from "../middleware/requestContext";

export interface OnboardingView {
  /** Finite onboarding step. Server-computed from payload fields so the FE
   *  can render a deterministic layer per step. */
  step: OnboardingStep;
  /** Conversation history captured in steps 3–5. Bounded — onboarding is
   *  designed to conclude in < 10 minutes, so this list stays small. */
  messages: OnboardingMessage[];
  /** AI-proposed goal awaiting user confirmation (step 4). Null until the
   *  summarizer agent has produced one or the user has already confirmed. */
  proposedGoal: ProposedOnboardingGoal | null;
  /** Goal id created after the user confirms the proposed goal. Null
   *  until step 5 begins. */
  currentGoalId: string | null;
  /** First task id seeded on plan acceptance. Null until step 7 completes. */
  firstTaskId: string | null;
  /** LongTermFacts captured during onboarding so far (from memory_facts). */
  memoryFacts: LongTermFact[];
  /** SemanticPreferences captured so far (from memory_preferences). */
  memoryPreferences: SemanticPreference[];
  /** True when the user has completed onboarding. */
  onboardingComplete: boolean;
  /** User's timezone (auto-detected at signup) if known. */
  timezone: string | null;
  /** Name to greet the user by. Empty string when not yet known. */
  greetingName: string;
  /** Original user-stated goal text captured at onboarding start, if any. */
  goalRaw: string;
}

interface OnboardingPayload {
  onboardingStep?: OnboardingStep;
  onboardingMessages?: OnboardingMessage[];
  proposedGoal?: ProposedOnboardingGoal;
  onboardingGoalId?: string;
  onboardingFirstTaskId?: string;
}

/** Read a user's onboarding payload keys. Kept local; repositories layer
 *  returns a flat UserProfile so the payload is already parsed. */
function readOnboardingPayload(user: UserProfile | null): OnboardingPayload {
  if (!user) return {};
  // Repositories expose a few payload extras as top-level profile fields;
  // the onboarding-specific ones aren't promoted, so they'd round-trip via
  // a separate helper once wired. For now the in-memory user object carries
  // them on `.onboardingPayload` when cmdSendOnboardingMessage etc. write
  // them via repos.users.updatePayload(); the view reads them the same way.
  const withPayload = user as unknown as {
    onboardingStep?: OnboardingStep;
    onboardingMessages?: OnboardingMessage[];
    proposedGoal?: ProposedOnboardingGoal;
    onboardingGoalId?: string;
    onboardingFirstTaskId?: string;
  };
  return {
    onboardingStep: withPayload.onboardingStep,
    onboardingMessages: withPayload.onboardingMessages,
    proposedGoal: withPayload.proposedGoal,
    onboardingGoalId: withPayload.onboardingGoalId,
    onboardingFirstTaskId: withPayload.onboardingFirstTaskId,
  };
}

/** Derive a step value when the persisted one is missing (legacy users). */
function deriveStep(
  user: UserProfile | null,
  payload: OnboardingPayload,
): OnboardingStep {
  if (user?.onboardingComplete) return "complete";
  if (payload.onboardingFirstTaskId) return "complete";
  if (payload.onboardingGoalId) return "plan-reveal";
  if (payload.proposedGoal) return "goal-naming";
  if ((payload.onboardingMessages ?? []).length > 0) return "discovery";
  return "welcome";
}

export async function resolveOnboardingView(): Promise<OnboardingView> {
  const user = await repos.users.get();
  const payload = readOnboardingPayload(user);

  // Load facts + preferences so the UI can show "here's what I remember
  // about you so far" during steps 3–5. Signals are not returned here
  // (they're noise-level and belong to the internal pipeline).
  let memoryFacts: LongTermFact[] = [];
  let memoryPreferences: SemanticPreference[] = [];
  try {
    const userId = getCurrentUserId();
    const memory = await loadMemory(userId);
    memoryFacts = memory.facts;
    memoryPreferences = memory.preferences;
  } catch {
    // New users may not have a memory row yet — treat as empty.
  }

  const step = payload.onboardingStep ?? deriveStep(user, payload);

  return {
    step,
    messages: payload.onboardingMessages ?? [],
    proposedGoal: payload.proposedGoal ?? null,
    currentGoalId: payload.onboardingGoalId ?? null,
    firstTaskId: payload.onboardingFirstTaskId ?? null,
    memoryFacts,
    memoryPreferences,
    onboardingComplete: Boolean(user?.onboardingComplete),
    timezone: user?.timezone ?? null,
    greetingName: user?.name ?? "",
    goalRaw: user?.goalRaw ?? "",
  };
}
