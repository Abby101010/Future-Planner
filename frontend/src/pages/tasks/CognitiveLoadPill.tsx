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

import { useState } from "react";
import Icon from "../../components/primitives/Icon";
import { useCommand } from "../../hooks/useCommand";
import type { UITask } from "./tasksTypes";

export interface CognitiveLoadPillProps {
  /** Accepts undefined (UITask shape) or null (BE DailyTask shape) —
   *  both render nothing. */
  load: UITask["cognitiveLoad"] | null;
  /** Optional: when provided, renders ↓/↑ buttons that fire
   *  command:override-cognitive-load (Phase D). Click "feels easier"
   *  steps the load DOWN one level; "feels harder" steps it UP.
   *  Reflection turns repeated overrides into a memory_fact future
   *  classifications respect (per-category).
   *  Pass `taskId={null}` (or omit) to render a read-only pill. */
  taskId?: string | null;
  /** Caller refetches view:tasks after a successful override so the
   *  pill re-renders with the new classification. */
  onOverridden?: () => void;
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

export default function CognitiveLoadPill({
  load,
  taskId,
  onOverridden,
}: CognitiveLoadPillProps) {
  const { run, running } = useCommand();
  const [hover, setHover] = useState(false);
  if (!load) return null;
  const spec = SPECS[load];
  const interactive = Boolean(taskId);

  async function override(perceived: "easier" | "harder") {
    if (!taskId) return;
    try {
      await run("command:override-cognitive-load", { taskId, perceivedLoad: perceived });
      onOverridden?.();
    } catch (err) {
      console.warn("[cognitive-load-pill] override failed:", err);
    }
  }

  return (
    <span
      data-testid={`cognitive-load-pill-${load}`}
      title={spec.tooltip}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
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
      {interactive && hover && (
        <span style={{ display: "inline-flex", gap: 2, marginLeft: 4 }}>
          {/* "Feels easier" — step the load down */}
          {load !== "low" && (
            <button
              data-testid={`cognitive-load-easier-${taskId}`}
              onClick={(e) => {
                e.stopPropagation();
                void override("easier");
              }}
              disabled={running}
              title="Feels easier — drop one level"
              style={{
                border: 0,
                background: "transparent",
                color: "var(--fg-faint)",
                cursor: "pointer",
                padding: "0 2px",
                fontSize: 10,
                lineHeight: 1,
              }}
            >
              ↓
            </button>
          )}
          {/* "Feels harder" — step the load up */}
          {load !== "high" && (
            <button
              data-testid={`cognitive-load-harder-${taskId}`}
              onClick={(e) => {
                e.stopPropagation();
                void override("harder");
              }}
              disabled={running}
              title="Feels harder — bump one level"
              style={{
                border: 0,
                background: "transparent",
                color: "var(--fg-faint)",
                cursor: "pointer",
                padding: "0 2px",
                fontSize: 10,
                lineHeight: 1,
              }}
            >
              ↑
            </button>
          )}
        </span>
      )}
    </span>
  );
}
