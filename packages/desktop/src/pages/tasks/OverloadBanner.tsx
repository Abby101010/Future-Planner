import { useState } from "react";
import { AlertTriangle, RefreshCw, X, Loader2 } from "lucide-react";
import { useCommand } from "../../hooks/useCommand";
import "./OverloadBanner.css";

interface OverloadedGoalSummary {
  goalId: string;
  goalTitle: string;
  overdueCount: number;
}

interface Props {
  overloadedGoals: OverloadedGoalSummary[];
  totalOverdueCount: number;
  onAdjustAll?: () => void;
}

export default function OverloadBanner({ overloadedGoals, totalOverdueCount, onAdjustAll }: Props) {
  const [dismissed, setDismissed] = useState(false);
  const [confirming, setConfirming] = useState<"all" | string | false>(false);
  const [adjusting, setAdjusting] = useState(false);
  const [adjustedGoals, setAdjustedGoals] = useState<Set<string>>(new Set());
  const { run } = useCommand();

  if (dismissed || overloadedGoals.length === 0) return null;

  const visibleGoals = overloadedGoals.filter((g) => !adjustedGoals.has(g.goalId));
  if (visibleGoals.length === 0) return null;

  const goalCount = visibleGoals.length;

  const handleAdjustGoal = async (goalId: string) => {
    setAdjusting(true);
    try {
      await run("command:adaptive-reschedule", { goalId });
      setAdjustedGoals((prev) => new Set([...prev, goalId]));
      onAdjustAll?.();
    } catch {
      // silent
    } finally {
      setAdjusting(false);
      setConfirming(false);
    }
  };

  const handleAdjustAll = async () => {
    setAdjusting(true);
    try {
      const goalIds = visibleGoals.map((g) => g.goalId);
      await run("command:adjust-all-overloaded-plans", { goalIds });
      setAdjustedGoals((prev) => new Set([...prev, ...goalIds]));
      onAdjustAll?.();
    } catch {
      // silent
    } finally {
      setAdjusting(false);
      setConfirming(false);
    }
  };

  return (
    <div className="overload-banner animate-slide-up">
      <div className="overload-banner-head">
        <AlertTriangle size={16} style={{ color: "var(--red, #ef4444)", flexShrink: 0 }} />
        <strong>
          {totalOverdueCount} overdue tasks across {goalCount} goal{goalCount > 1 ? "s" : ""}
        </strong>
        <button
          className="btn btn-ghost btn-icon-xs"
          onClick={() => setDismissed(true)}
          title="Dismiss"
        >
          <X size={14} />
        </button>
      </div>

      <div className="overload-banner-goals">
        {visibleGoals.map((g) => (
          <div key={g.goalId} className="overload-banner-goal-row">
            <span>
              {g.goalTitle}: {g.overdueCount} tasks behind
            </span>
            {confirming !== "all" && (
              <button
                className="btn btn-ghost btn-xs"
                disabled={adjusting}
                onClick={() => {
                  if (confirming === g.goalId) {
                    handleAdjustGoal(g.goalId);
                  } else {
                    setConfirming(g.goalId);
                  }
                }}
                title={confirming === g.goalId ? "Confirm adjust" : "Adjust this plan"}
              >
                {adjusting && confirming === g.goalId
                  ? <Loader2 size={12} className="spin" />
                  : <RefreshCw size={12} />}
                {confirming === g.goalId ? "Confirm" : "Adjust"}
              </button>
            )}
          </div>
        ))}
      </div>

      {confirming === false ? (
        <>
          <p className="overload-banner-detail">
            Your plans are generating more tasks than you can complete. Adjust individual plans or all at once.
          </p>
          {goalCount > 1 && (
            <div className="overload-banner-actions">
              <button
                className="btn btn-sm"
                style={{ borderColor: "var(--red, #ef4444)", color: "var(--red, #ef4444)" }}
                onClick={() => setConfirming("all")}
              >
                <RefreshCw size={14} />
                Adjust All Plans
              </button>
            </div>
          )}
        </>
      ) : confirming === "all" ? (
        <>
          <p className="overload-banner-confirm">
            This will redistribute remaining tasks in {goalCount} plan{goalCount > 1 ? "s" : ""} to
            match your actual pace. Target dates may shift. Continue?
          </p>
          <div className="overload-banner-actions">
            <button
              className="btn btn-primary btn-sm"
              onClick={handleAdjustAll}
              disabled={adjusting}
            >
              {adjusting ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
              Yes, adjust all plans
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setConfirming(false)}
              disabled={adjusting}
            >
              Cancel
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
