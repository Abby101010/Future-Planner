/* CognitiveLoadPill — warm-voice indicator of a task's cognitive load.
 *
 * Renders a small colored pill with a short descriptor next to the
 * task title. Three variants:
 *   high   → "Deep focus"    (best with fresh mind, accent color)
 *   medium → "Steady focus"  (neutral)
 *   low    → "Light task"    (fine when tired, faint)
 *
 * Voice rules (per the architecture plan):
 *   - Warm and human, never clinical. Never "System 2 cognitive task".
 *   - Friend-like phrasing: "best with a fresh mind", "fine when tired".
 *   - Tooltip explains in one line; the pill text itself is short.
 *
 * Reads `task.cognitiveLoad` (UITask.cognitiveLoad). Renders nothing
 * when the field is missing — keeps existing un-classified rows
 * looking the same as before.
 *
 * The visual cue + descriptor combo is intentional. Visual alone
 * (color) is insufficient (accessibility); descriptor alone is
 * insufficient (scanning at-a-glance). Both together let the user
 * see "today's morning has two deep-focus tasks; my evening has
 * light tasks. That makes sense." */

import Icon from "../../components/primitives/Icon";
import type { UITask } from "./tasksTypes";

export interface CognitiveLoadPillProps {
  /** Accepts undefined (UITask shape) or null (BE DailyTask shape) —
   *  both render nothing. */
  load: UITask["cognitiveLoad"] | null;
}

interface PillSpec {
  text: string;
  tooltip: string;
  color: string;
  border: string;
  bg: string;
  iconName: "brain" | "circle" | "dot";
}

const SPECS: Record<NonNullable<UITask["cognitiveLoad"]>, PillSpec> = {
  high: {
    text: "Deep focus",
    tooltip: "Best with a fresh mind — schedule in your peak window.",
    color: "var(--accent)",
    border: "var(--accent)",
    bg: "color-mix(in oklab, var(--accent) 8%, transparent)",
    iconName: "brain",
  },
  medium: {
    text: "Steady focus",
    tooltip: "Familiar work — moderate effort.",
    color: "var(--fg-mute)",
    border: "var(--border)",
    bg: "transparent",
    iconName: "circle",
  },
  low: {
    text: "Light task",
    tooltip: "Fine when tired — fits late-day or fragmented gaps.",
    color: "var(--fg-faint)",
    border: "var(--border-soft)",
    bg: "transparent",
    iconName: "dot",
  },
};

export default function CognitiveLoadPill({ load }: CognitiveLoadPillProps) {
  if (!load) return null;
  const spec = SPECS[load];
  return (
    <span
      data-testid={`cognitive-load-pill-${load}`}
      title={spec.tooltip}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: "var(--t-2xs)",
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        fontWeight: 600,
        color: spec.color,
        border: `1px solid ${spec.border}`,
        background: spec.bg,
        borderRadius: 4,
        padding: "1px 6px",
        flexShrink: 0,
      }}
    >
      <Icon name={spec.iconName} size={9} />
      <span>{spec.text}</span>
    </span>
  );
}
