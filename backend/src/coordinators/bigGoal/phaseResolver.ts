/* phaseResolver — deterministic helper that maps a goal's deadline distance
 * onto a methodology-aware lifecycle phase.
 *
 * The methodology doc lists job-search phases (Prep → Apply → Interview →
 * Decide) with approximate durations (2-4w / 4-8w / 3-6w / 1-2w). We
 * back-solve the current phase from the deadline, so the planner prompt
 * can pick phase-appropriate actions (e.g. weight skill-building tasks
 * in Prep, flip to targeted-prep in Interview).
 *
 * The return is intentionally a string (not a union enum) because
 * different archetypes use different phase vocabularies. For a generic
 * goal we fall back to "early"/"mid"/"late"/"wrap". Callers who only
 * care about one archetype can branch on the result string.
 */

export interface PhaseResolveInput {
  /** Goal start date (ISO). Usually goal.createdAt's date. */
  startDate: string;
  /** Goal target date (ISO). Empty string for habits. */
  targetDate: string;
  /** Optional archetype hint. "job-search" returns the Prep/Apply/
   *  Interview/Decide vocabulary. Anything else gets generic phases. */
  archetype?: string;
  /** Today (ISO), overridable for tests. */
  today?: string;
}

/** Resolve the goal's current phase. Returns `undefined` for habits
 *  (no targetDate) or when inputs are unparseable — planners should
 *  treat undefined as "no phase guidance" and not inject the block. */
export function resolvePhase(input: PhaseResolveInput): string | undefined {
  if (!input.targetDate) return undefined;
  const start = new Date(input.startDate);
  const target = new Date(input.targetDate);
  const today = new Date(input.today ?? new Date().toISOString());
  if (isNaN(start.getTime()) || isNaN(target.getTime())) return undefined;
  const total = target.getTime() - start.getTime();
  if (total <= 0) return undefined;

  const elapsed = Math.max(0, today.getTime() - start.getTime());
  const pct = Math.min(1, elapsed / total);

  if (input.archetype === "job-search") {
    // Methodology split: prep ~20%, apply ~40%, interview ~30%, decide ~10%.
    if (pct < 0.2) return "prep";
    if (pct < 0.6) return "apply";
    if (pct < 0.9) return "interview";
    return "decide";
  }

  // Generic archetype fallback. Kept deliberately coarse so the planner
  // prompt can still phrase advice like "you're in the mid phase of this
  // goal" without pretending to know a specific domain's rhythm.
  if (pct < 0.25) return "early";
  if (pct < 0.65) return "mid";
  if (pct < 0.9) return "late";
  return "wrap";
}
