/* GoalCard — designed card for a single goal on the Planning page.
 *
 * Per contract (lines 137-141): Planning shows pause/resume per goal + open
 * goal-plan. Archive + reorder prototype affordances are DROPPED (not in
 * contract — contract uses delete-goal for removal).
 */

import type { PlanningGoal } from "./planningTypes";
import Pill from "../../components/primitives/Pill";
import Icon from "../../components/primitives/Icon";
import PaceBadge from "./PaceBadge";

export interface GoalCardProps {
  goal: PlanningGoal;
  onOpen: (goalId: string) => void;
  onPause: (goalId: string) => void;
  onResume: (goalId: string) => void;
  onDelete: (goalId: string) => void;
}

export default function GoalCard({ goal: g, onOpen, onPause, onResume, onDelete }: GoalCardProps) {
  const paused = g.status === "paused";
  return (
    <article
      data-testid={`goal-card-${g.id}`}
      onClick={() => onOpen(g.id)}
      style={{
        background: "var(--bg-elev)",
        border: "1px solid var(--border)",
        borderRadius: "var(--r-md)",
        padding: 20,
        cursor: "pointer",
        opacity: paused ? 0.65 : 1,
        transition: "border-color .12s, transform .12s",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--border-strong)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--border)";
      }}
    >
      <header style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: "var(--r-md)",
            background: "var(--bg-soft)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 22,
            flexShrink: 0,
          }}
        >
          {g.icon ?? "◎"}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <h3
              style={{
                margin: 0,
                fontSize: "var(--t-xl)",
                color: "var(--fg)",
                fontWeight: 600,
                textDecoration: paused ? "line-through" : "none",
              }}
            >
              {g.title}
            </h3>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontSize: "var(--t-xs)",
              color: "var(--fg-faint)",
            }}
          >
            {g.horizon && <Pill>{g.horizon}</Pill>}
            <PaceBadge pace={g.pace} delta={g.paceDelta} inFlight={g.inFlight} />
          </div>
        </div>
        <div
          className="ns-row-trail"
          onClick={(e) => e.stopPropagation()}
          style={{ display: "flex", gap: 2 }}
        >
          {paused ? (
            <button
              data-testid={`goal-card-resume-${g.id}`}
              onClick={() => onResume(g.id)}
              data-api="POST /commands/resume-goal"
              title="Resume"
              style={{
                border: 0,
                background: "transparent",
                cursor: "pointer",
                color: "var(--fg-faint)",
                padding: 4,
              }}
            >
              <Icon name="play" size={13} />
            </button>
          ) : (
            <button
              data-testid={`goal-card-pause-${g.id}`}
              onClick={() => onPause(g.id)}
              data-api="POST /commands/pause-goal"
              title="Pause"
              style={{
                border: 0,
                background: "transparent",
                cursor: "pointer",
                color: "var(--fg-faint)",
                padding: 4,
              }}
            >
              <Icon name="pause" size={13} />
            </button>
          )}
          <button
            data-testid={`goal-card-delete-${g.id}`}
            onClick={() => onDelete(g.id)}
            data-api="POST /commands/delete-goal"
            title="Delete"
            style={{
              border: 0,
              background: "transparent",
              cursor: "pointer",
              color: "var(--fg-faint)",
              padding: 4,
            }}
          >
            <Icon name="trash" size={13} />
          </button>
        </div>
      </header>

      {g.description && (
        <p
          style={{
            margin: 0,
            fontSize: "var(--t-sm)",
            color: "var(--fg-mute)",
            lineHeight: 1.55,
            fontStyle: "italic",
          }}
        >
          "{g.description}"
        </p>
      )}

      <div>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            marginBottom: 6,
          }}
        >
          <span
            style={{
              fontSize: 10,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--fg-faint)",
              fontWeight: 600,
            }}
          >
            Progress
          </span>
          <span className="tnum num-gold" style={{ fontSize: 16 }}>
            {g.pct ?? 0}%
          </span>
        </div>
        <div
          style={{
            height: 4,
            background: "var(--bg-sunken)",
            borderRadius: 2,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${g.pct ?? 0}%`,
              height: "100%",
              background: "var(--accent)",
            }}
          />
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
          paddingTop: 14,
          borderTop: "1px solid var(--border-soft)",
        }}
      >
        <div>
          <div
            style={{
              fontSize: 9,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--fg-faint)",
              fontWeight: 600,
            }}
          >
            Next milestone
          </div>
          <div
            style={{
              fontSize: "var(--t-sm)",
              color: "var(--user-color)",
              fontWeight: 500,
              marginTop: 3,
            }}
          >
            {g.nextMilestone || "—"}
          </div>
          {g.nextDue && (
            <div className="tnum" style={{ fontSize: 10, color: "var(--fg-faint)", marginTop: 2 }}>
              {g.nextDue}
            </div>
          )}
        </div>
        <div>
          <div
            style={{
              fontSize: 9,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--fg-faint)",
              fontWeight: 600,
            }}
          >
            Tasks
          </div>
          <div
            style={{
              fontSize: "var(--t-sm)",
              color: "var(--user-color)",
              fontWeight: 500,
              marginTop: 3,
            }}
          >
            <span className="tnum">{g.tasksThisWeek ?? 0}</span> this week ·{" "}
            <span className="tnum">{g.openTasks ?? 0}</span> open
          </div>
        </div>
      </div>
    </article>
  );
}
