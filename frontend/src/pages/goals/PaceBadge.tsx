/* PaceBadge — Pill variant showing goal pace (on-track/ahead/behind/paused). */

import Pill, { type PillTone } from "../../components/primitives/Pill";
import type { IconName } from "../../components/primitives/Icon";

export type Pace = "on-track" | "ahead" | "behind" | "paused";

const PACE_META: Record<Pace, { tone: PillTone; label: string; icon: IconName }> = {
  "on-track": { tone: "success", label: "On track", icon: "check" },
  ahead: { tone: "info", label: "Ahead", icon: "bolt" },
  behind: { tone: "warn", label: "Behind", icon: "alert" },
  paused: { tone: "base", label: "Paused", icon: "pause" },
};

export default function PaceBadge({ pace, delta }: { pace: Pace; delta?: string }) {
  const meta = PACE_META[pace];
  return (
    <Pill tone={meta.tone} icon={meta.icon}>
      {meta.label}
      {delta ? ` · ${delta}` : ""}
    </Pill>
  );
}
