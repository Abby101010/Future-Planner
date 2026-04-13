import { useState } from "react";
import { AlertTriangle, TrendingDown, X, RefreshCw, Loader2 } from "lucide-react";
import { useCommand } from "../../hooks/useCommand";
import type { PaceMismatch } from "@northstar/core";

interface Props {
  mismatches: PaceMismatch[];
  onDismiss?: (goalId: string) => void;
  onReschedule?: () => void;
}

export default function PaceBanner({ mismatches, onDismiss, onReschedule }: Props) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [rescheduling, setRescheduling] = useState<string | null>(null);
  const { run } = useCommand();

  const visible = mismatches.filter((m) => !dismissed.has(m.goalId));
  if (visible.length === 0) return null;

  const top = visible[0];
  const severityColor =
    top.severity === "severe"
      ? "var(--red, #ef4444)"
      : top.severity === "moderate"
        ? "var(--orange, #f59e0b)"
        : "var(--yellow, #eab308)";

  const handleDismiss = (goalId: string) => {
    setDismissed((prev) => new Set(prev).add(goalId));
    onDismiss?.(goalId);
  };

  const handleReschedule = async (goalId: string) => {
    setRescheduling(goalId);
    try {
      await run("command:adaptive-reschedule", { goalId });
      onReschedule?.();
    } catch {
      // silent
    } finally {
      setRescheduling(null);
    }
  };

  return (
    <div
      className="pace-banner"
      style={{ borderColor: severityColor, background: `color-mix(in srgb, ${severityColor} 8%, transparent)` }}
    >
      <div className="pace-banner-head">
        <TrendingDown size={16} style={{ color: severityColor, flexShrink: 0 }} />
        <strong>Falling behind on {top.goalTitle}</strong>
        <button
          className="btn btn-ghost btn-icon-xs"
          onClick={() => handleDismiss(top.goalId)}
          title="Dismiss"
        >
          <X size={14} />
        </button>
      </div>
      <p className="pace-banner-detail">
        You're completing ~{top.actualTasksPerDay} tasks/day but your plan needs ~{top.requiredTasksPerDay}.
        {top.estimatedDelayDays > 0 && (
          <> At this pace, you'll finish ~{top.estimatedDelayDays} days late.</>
        )}
      </p>
      <div className="pace-banner-stats">
        <span>{top.completedPlanTasks}/{top.totalPlanTasks} tasks done</span>
        <span>{top.daysRemaining} days left</span>
      </div>
      <div className="pace-banner-actions">
        <button
          className="btn btn-sm"
          style={{ borderColor: severityColor, color: severityColor }}
          onClick={() => handleReschedule(top.goalId)}
          disabled={rescheduling === top.goalId}
        >
          {rescheduling === top.goalId ? (
            <Loader2 size={14} className="spin" />
          ) : (
            <RefreshCw size={14} />
          )}
          Adjust Plan
        </button>
      </div>
      {visible.length > 1 && (
        <p className="pace-banner-more">
          +{visible.length - 1} more goal{visible.length > 2 ? "s" : ""} behind pace
        </p>
      )}
    </div>
  );
}
