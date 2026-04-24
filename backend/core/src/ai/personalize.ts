/* ──────────────────────────────────────────────────────────
   Starward — Memory-aware system prompt wrapper

   Injects the user's long-term memory context into a base
   system prompt. The memory block is placed AFTER the base
   instructions so Claude treats it as grounding context,
   not as something to override.

   Format ("micro-adjustment injection"):
     Base System Prompt
     + Current User Preferences (from long-term memory)
     + Feedback Updates (timestamped recent learnings)
     + Behavioral Patterns (day/hour analysis)
     + Active Constraints (snooze alerts, calibrations)
     + Context-Specific Directive (what to do with this info)
   ────────────────────────────────────────────────────────── */

export function personalizeSystem(
  baseSystem: string,
  memoryContext: string,
): string {
  if (!memoryContext) return baseSystem;
  return `${baseSystem}\n\n${memoryContext}`;
}
