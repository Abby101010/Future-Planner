import { useState } from "react";
import { AlertTriangle, ArrowRight, X, Loader2 } from "lucide-react";
import { useCommand } from "../../hooks/useCommand";
import "./OverflowConfirmationCard.css";

interface OverflowRecommendation {
  taskId: string;
  title: string;
  cognitiveWeight: number;
  durationMinutes: number;
  priority: string;
  source: string;
  goalId: string | null;
  goalTitle?: string;
  suggestedDate: string;
  suggestedDateLabel: string;
}

interface Props {
  recommendations: OverflowRecommendation[];
  budget: { totalWeight: number; maxWeight: number; totalTasks: number; maxTasks: number };
  date: string;
  onResolved: () => void;
}

export default function OverflowConfirmationCard({ recommendations, budget, date, onResolved }: Props) {
  const [dismissed, setDismissed] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [deferringAll, setDeferringAll] = useState(false);
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set());
  const { run } = useCommand();

  if (dismissed) return null;

  const visible = recommendations.filter((r) => !resolvedIds.has(r.taskId));
  if (visible.length === 0) return null;

  const handleDeferOne = async (rec: OverflowRecommendation) => {
    setProcessingId(rec.taskId);
    try {
      await run("command:reschedule-task", {
        taskId: rec.taskId,
        targetDate: rec.suggestedDate,
        force: true,
      });
      setResolvedIds((prev) => new Set([...prev, rec.taskId]));
      onResolved();
    } catch {
      /* best-effort */
    } finally {
      setProcessingId(null);
    }
  };

  const handleDeferAll = async () => {
    setDeferringAll(true);
    try {
      const taskTargets: Record<string, string> = {};
      for (const r of visible) {
        taskTargets[r.taskId] = r.suggestedDate;
      }
      await run("command:defer-overflow", { date, taskTargets });
      setResolvedIds((prev) => new Set([...prev, ...visible.map((r) => r.taskId)]));
      onResolved();
    } catch {
      /* best-effort */
    } finally {
      setDeferringAll(false);
    }
  };

  const handleKeep = (taskId: string) => {
    setResolvedIds((prev) => new Set([...prev, taskId]));
  };

  return (
    <div className="overflow-card animate-slide-up">
      <div className="overflow-card-head">
        <AlertTriangle size={16} style={{ color: "var(--amber, #f59e0b)", flexShrink: 0 }} />
        <strong>
          Today is over budget ({budget.totalWeight}/{budget.maxWeight} weight, {budget.totalTasks}/{budget.maxTasks} tasks)
        </strong>
        <button
          className="btn btn-ghost btn-icon-xs"
          onClick={() => setDismissed(true)}
          title="Keep all tasks"
        >
          <X size={14} />
        </button>
      </div>

      <p className="overflow-card-detail">
        Move some tasks to a lighter day to stay within your cognitive budget.
      </p>

      <div className="overflow-card-items">
        {visible.map((r) => {
          const isProcessing = processingId === r.taskId;
          return (
            <div key={r.taskId} className="overflow-card-item">
              <div className="overflow-card-item-info">
                <span className="overflow-card-item-title">{r.title}</span>
                <span className="overflow-card-item-meta">
                  {r.cognitiveWeight} pts · {r.durationMinutes}m
                  {r.goalTitle && <> · {r.goalTitle}</>}
                </span>
              </div>
              <div className="overflow-card-item-actions">
                <button
                  className="btn btn-primary btn-sm"
                  disabled={isProcessing || deferringAll}
                  onClick={() => handleDeferOne(r)}
                >
                  {isProcessing ? (
                    <Loader2 size={12} className="spin" />
                  ) : (
                    <ArrowRight size={12} />
                  )}
                  {r.suggestedDateLabel}
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={isProcessing || deferringAll}
                  onClick={() => handleKeep(r.taskId)}
                >
                  Keep
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {visible.length > 1 && (
        <div className="overflow-card-bulk">
          <button
            className="btn btn-sm"
            style={{ borderColor: "var(--amber, #f59e0b)", color: "var(--amber, #f59e0b)" }}
            disabled={deferringAll}
            onClick={handleDeferAll}
          >
            {deferringAll ? <Loader2 size={14} className="spin" /> : <ArrowRight size={14} />}
            Defer all suggested
          </button>
        </div>
      )}
    </div>
  );
}
