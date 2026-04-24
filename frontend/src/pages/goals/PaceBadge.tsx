/* PaceBadge — Pill variant showing goal pace (on-track/ahead/behind/paused).
 *
 * When a `regenerate-goal-plan` job is in flight for the goal, the card
 * calls this component with `inFlight` and we render a "Planning…" pill
 * instead of the pace label. This avoids showing "0% · On track" for a
 * goal whose plan doesn't exist yet. */

import Pill, { type PillTone } from "../../components/primitives/Pill";
import type { IconName } from "../../components/primitives/Icon";
import type { PlanningInFlightDescriptor } from "./planningTypes";

export type Pace = "on-track" | "ahead" | "behind" | "paused";

const PACE_META: Record<Pace, { tone: PillTone; label: string; icon: IconName }> = {
  "on-track": { tone: "success", label: "On track", icon: "check" },
  ahead: { tone: "info", label: "Ahead", icon: "bolt" },
  behind: { tone: "warn", label: "Behind", icon: "alert" },
  paused: { tone: "base", label: "Paused", icon: "pause" },
};

export default function PaceBadge({
  pace,
  delta,
  inFlight,
}: {
  pace: Pace;
  delta?: string;
  /** When present, overrides the pace label with a "Planning…" pill. */
  inFlight?: PlanningInFlightDescriptor | null;
}) {
  if (inFlight) {
    return (
      <Pill tone="info" icon="sparkle">
        {inFlight.status === "pending" ? "Queued" : "Planning…"}
      </Pill>
    );
  }
  const meta = PACE_META[pace];
  return (
    <Pill tone={meta.tone} icon={meta.icon}>
      {meta.label}
      {delta ? ` · ${delta}` : ""}
    </Pill>
  );
}
