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
  const [confirming, setConfirming] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const { run } = useCommand();

  if (dismissed || overloadedGoals.length === 0) return null;

  const goalCount = overloadedGoals.length;

  const handleConfirm = async () => {
    setAdjusting(true);
    try {
      const goalIds = overloadedGoals.map((g) => g.goalId);
      await run("command:adjust-all-overloaded-plans", { goalIds });
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
        {overloadedGoals.map((g) => (
          <span key={g.goalId}>
            {g.goalTitle}: {g.overdueCount} tasks behind
          </span>
        ))}
      </div>

      {!confirming ? (
        <>
          <p className="overload-banner-detail">
            Your plans are generating more tasks than you can complete. Want me to lighten them to match your pace?
          </p>
          <div className="overload-banner-actions">
            <button
              className="btn btn-sm"
              style={{ borderColor: "var(--red, #ef4444)", color: "var(--red, #ef4444)" }}
              onClick={() => setConfirming(true)}
            >
              <RefreshCw size={14} />
              Adjust All Plans
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="overload-banner-confirm">
            This will redistribute remaining tasks in {goalCount} plan{goalCount > 1 ? "s" : ""} to
            match your actual pace. Target dates may shift. Continue?
          </p>
          <div className="overload-banner-actions">
            <button
              className="btn btn-primary btn-sm"
              onClick={handleConfirm}
              disabled={adjusting}
            >
              {adjusting ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
              Yes, adjust plans
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
      )}
    </div>
  );
}
