/* ──────────────────────────────────────────────────────────
   NorthStar — Can't-Complete Modal

   Repurposed from the old RecoveryModal. When a user marks a
   task as "can't complete", this modal:
   - Asks for an optional reason
   - Calls command:cant-complete-task
   - Shows reschedule options (user_created) or big goal
     re-evaluation context (big_goal)
   ────────────────────────────────────────────────────────── */

import { useState } from "react";
import { X, Loader2, Calendar, ArrowRight, Target } from "lucide-react";
import { useCommand } from "../../hooks/useCommand";
import "./RecoveryModal.css";

interface CantCompleteTask {
  id: string;
  title: string;
  source?: string;
  goalId?: string | null;
}

interface RescheduleOption {
  label: string;
  date: string;
}

interface CantCompleteResult {
  action: "reschedule" | "big_goal_reevaluate";
  task: {
    id: string;
    title: string;
    source: string;
    goalId: string | null;
    goalTitle?: string;
  };
  rescheduleOptions?: RescheduleOption[];
  bigGoalContext?: {
    goalId: string;
    goalTitle: string;
    taskTitle: string;
    reason: string;
  };
}

interface Props {
  task: CantCompleteTask;
  onClose: () => void;
  onDone: () => void;
}

const REASON_OPTIONS = [
  { id: "no_time", label: "No time today", emoji: "\u23F0" },
  { id: "too_hard", label: "Too difficult", emoji: "\uD83E\uDDE9" },
  { id: "low_energy", label: "Low energy", emoji: "\uD83D\uDD0B" },
  { id: "blocked", label: "Blocked by something", emoji: "\uD83D\uDEA7" },
  { id: "not_relevant", label: "Not relevant anymore", emoji: "\u274C" },
  { id: "other", label: "Other reason", emoji: "\u270F\uFE0F" },
];

export default function RecoveryModal({ task, onClose, onDone }: Props) {
  const { run } = useCommand();
  const [step, setStep] = useState<"reason" | "result">("reason");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CantCompleteResult | null>(null);
  const [rescheduling, setRescheduling] = useState(false);

  const handleSelectReason = async (reasonId: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await run<CantCompleteResult>("command:cant-complete-task", {
        taskId: task.id,
        reason: reasonId,
      });
      if (res) {
        setResult(res);
        setStep("result");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to process");
    } finally {
      setLoading(false);
    }
  };

  const handleReschedule = async (date: string) => {
    if (!date) {
      // "Pick a date" — close modal and let parent handle date picker
      onDone();
      return;
    }
    setRescheduling(true);
    try {
      await run("command:reschedule-task", {
        taskId: task.id,
        targetDate: date,
        force: true,
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reschedule failed");
    } finally {
      setRescheduling(false);
    }
  };

  return (
    <div className="recovery-overlay" onClick={onClose}>
      <div
        className="recovery-modal card animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="recovery-header">
          <h3>Can't complete this?</h3>
          <button className="btn btn-icon btn-ghost" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {step === "reason" && (
          <>
            <p className="recovery-subtitle">
              What's preventing you from completing "{task.title}"?
            </p>

            {loading ? (
              <div className="recovery-loading">
                <Loader2 size={24} className="spin" />
                <p>Processing...</p>
              </div>
            ) : (
              <div className="blocker-options">
                {error && (
                  <p
                    className="recovery-error"
                    style={{ color: "var(--red)" }}
                  >
                    {error}
                  </p>
                )}
                {REASON_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    className="blocker-btn"
                    onClick={() => handleSelectReason(opt.id)}
                  >
                    <span className="blocker-emoji">{opt.emoji}</span>
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {step === "result" && result?.action === "reschedule" && (
          <div className="recovery-result animate-fade-in">
            <div className="recovery-impact">
              <p>
                <Calendar size={14} style={{ marginRight: 6 }} />
                When would you like to do this instead?
              </p>
            </div>

            <div className="recovery-changes">
              {rescheduling ? (
                <div className="recovery-loading">
                  <Loader2 size={20} className="spin" />
                  <p>Moving task...</p>
                </div>
              ) : (
                (result.rescheduleOptions ?? []).map((opt, i) => (
                  <button
                    key={i}
                    className="blocker-btn"
                    onClick={() => handleReschedule(opt.date)}
                    style={{ width: "100%" }}
                  >
                    <ArrowRight size={14} />
                    <span>{opt.label}</span>
                  </button>
                ))
              )}
            </div>

            <button
              className="btn btn-ghost btn-sm"
              onClick={onDone}
              style={{ marginTop: 8 }}
            >
              Just skip it
            </button>
          </div>
        )}

        {step === "result" && result?.action === "big_goal_reevaluate" && (
          <div className="recovery-result animate-fade-in">
            <div className="recovery-impact">
              <p>
                <Target size={14} style={{ marginRight: 6 }} />
                This task is part of your goal: {result.bigGoalContext?.goalTitle}
              </p>
            </div>

            <div className="recovery-forward">
              <p>
                We'll re-evaluate your plan for this goal. The task has been
                removed from today, and your goal plan will be adjusted to
                account for this change.
              </p>
            </div>

            <button className="btn btn-primary w-full" onClick={onDone}>
              Got it
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
