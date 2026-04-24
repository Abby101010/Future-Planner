/* PlanningInFlight — skeleton state shown on GoalPlanPage while a
 * `command:regenerate-goal-plan` job is pending/running and the goal
 * has no plan to display yet.
 *
 * Reuses the ns-indeterminate keyframe (styles/tokens.css) for the
 * shimmer bar, matching the JobStatusDock bottom-left toast so the
 * user sees the same visual language in both places.
 *
 * Cancel is intentionally absent — the backend does not currently
 * support cancelling an in-flight plan job (gap 6 in the pipeline
 * audit). Adding a UI-only Cancel that does nothing would mislead.
 */

import { useEffect, useState } from "react";
import Icon from "../../components/primitives/Icon";

export interface PlanningInFlightProps {
  /** Server-reported timestamp when the plan job was enqueued.
   *  Used to render an elapsed-time counter. */
  startedAt: string;
  /** Optional — shown as "Planning your 12-month goal" if passed. */
  horizon?: string;
  /** 'pending' while queued, 'running' once the worker picks it up. */
  status: "pending" | "running";
}

export default function PlanningInFlight({
  startedAt,
  horizon,
  status,
}: PlanningInFlightProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const started = new Date(startedAt).getTime();
  const elapsedSec = Number.isFinite(started) ? Math.max(0, Math.round((now - started) / 1000)) : 0;

  const statusLabel =
    status === "pending" ? "Queued — waiting for a worker" : "Generating plan";

  return (
    <section
      data-testid="goal-plan-inflight"
      data-state="planning-inflight"
      style={{
        maxWidth: 640,
        margin: "48px auto",
        padding: "32px 28px",
        background: "var(--bg-elev)",
        border: "1px solid var(--border)",
        borderRadius: "var(--r-md)",
        display: "flex",
        flexDirection: "column",
        gap: 18,
        boxShadow: "var(--shadow-1)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Icon name="sparkle" size={16} style={{ color: "var(--accent)" }} />
        <span
          style={{
            fontSize: 10,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--accent)",
            fontWeight: 600,
          }}
        >
          {statusLabel}
        </span>
      </div>

      <h2
        className="h-headline"
        style={{
          margin: 0,
          fontSize: "var(--t-2xl)",
          color: "var(--fg)",
          letterSpacing: "-0.01em",
        }}
      >
        Planning your {horizon ?? "goal"}.
      </h2>

      <p
        style={{
          margin: 0,
          fontSize: "var(--t-sm)",
          color: "var(--fg-mute)",
          lineHeight: 1.55,
        }}
      >
        Starward is analyzing your goal and building a milestone timeline.
        This usually takes 20–40 seconds. The page will refresh automatically
        when the plan is ready.
      </p>

      {/* Indeterminate progress shimmer — reuses ns-indeterminate keyframe. */}
      <div
        style={{
          height: 4,
          background: "var(--bg-sunken)",
          borderRadius: 2,
          overflow: "hidden",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            height: "100%",
            width: "40%",
            background:
              "linear-gradient(90deg, transparent 0%, var(--accent) 50%, transparent 100%)",
            animation: "ns-indeterminate 1.4s ease-in-out infinite",
          }}
        />
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 11,
          fontFamily: "var(--font-mono)",
          color: "var(--fg-faint)",
        }}
      >
        <span data-testid="goal-plan-inflight-elapsed">
          elapsed: {elapsedSec}s
        </span>
        <span>POST /commands/regenerate-goal-plan</span>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          paddingTop: 14,
          borderTop: "1px solid var(--border-soft)",
          fontSize: 11,
          color: "var(--fg-faint)",
        }}
      >
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Icon name="check" size={11} style={{ color: "var(--success)" }} />
          <span>Goal saved</span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span
            style={{
              width: 11,
              height: 11,
              borderRadius: "50%",
              border: "1.5px solid var(--accent)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span
              className="dot-blink"
              style={{ width: 4, height: 4, background: "var(--accent)" }}
            />
          </span>
          <span style={{ color: "var(--fg-mute)" }}>
            Building plan (milestones, weekly cadence, daily tasks)
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", opacity: 0.5 }}>
          <Icon name="circle" size={11} />
          <span>Refreshing Goal Plan…</span>
        </div>
      </div>
    </section>
  );
}
