/* ──────────────────────────────────────────────────────────
   NorthStar — Recovery modal (Feature 4)
   ────────────────────────────────────────────────────────── */

import { useState } from "react";
import { X, Loader2, ArrowRight } from "lucide-react";
import useStore from "../store/useStore";
import { useT } from "../i18n";
import { handleRecovery } from "../services/ai";
import type { DailyLog, RecoveryResponse, BlockerOption } from "../types";
import "./RecoveryModal.css";

interface Props {
  todayLog: DailyLog;
  onClose: () => void;
}

export default function RecoveryModal({ todayLog, onClose }: Props) {
  const { roadmap, goalBreakdown, isLoading, setLoading, setError } = useStore();
  const [step, setStep] = useState<"ask" | "result">("ask");
  const [result, setResult] = useState<RecoveryResponse | null>(null);
  const t = useT();

  const BLOCKER_OPTIONS: BlockerOption[] = [
    { id: "no_time", label: t.recovery.noTime, emoji: "⏰" },
    { id: "too_hard", label: t.recovery.tooHard, emoji: "🧩" },
    { id: "low_energy", label: t.recovery.lowEnergy, emoji: "🔋" },
    { id: "forgot", label: t.recovery.forgot, emoji: "💭" },
    { id: "life", label: t.recovery.life, emoji: "🌊" },
    { id: "other", label: t.recovery.other, emoji: "✏️" },
  ];

  const missedTasks = todayLog.tasks.filter((t) => !t.completed);

  const handleSelect = async (blockerId: string) => {
    const plan = goalBreakdown || roadmap;
    if (!plan) return;
    setLoading(true);
    try {
      const res = await handleRecovery(blockerId, plan as any, todayLog);
      setResult(res as RecoveryResponse);
      setStep("result");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Recovery failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="recovery-overlay" onClick={onClose}>
      <div className="recovery-modal card animate-slide-up" onClick={(e) => e.stopPropagation()}>
        <div className="recovery-header">
          <h3>{t.recovery.title}</h3>
          <button className="btn btn-icon btn-ghost" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {step === "ask" && (
          <>
            <p className="recovery-subtitle">
              {t.recovery.subtitle(missedTasks.length)}
            </p>

            {isLoading ? (
              <div className="recovery-loading">
                <Loader2 size={24} className="spin" />
                <p>{t.recovery.adjusting}</p>
              </div>
            ) : (
              <div className="blocker-options">
                {BLOCKER_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    className="blocker-btn"
                    onClick={() => handleSelect(opt.id)}
                  >
                    <span className="blocker-emoji">{opt.emoji}</span>
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {step === "result" && result && (
          <div className="recovery-result animate-fade-in">
            <p className="recovery-ack">{result.blockerAcknowledged}</p>

            <div className="recovery-impact">
              <p>{result.timelineImpact}</p>
            </div>

            <div className="recovery-changes">
              <h4>{t.recovery.adjustedPlan}</h4>
              <p className="recovery-strategy">{result.adjustment.strategy}</p>
              {result.adjustment.tomorrowChanges.map((change, i) => (
                <div key={i} className="change-item">
                  <div className="change-before">{change.originalTask}</div>
                  <ArrowRight size={14} className="change-arrow" />
                  <div className="change-after">{change.adjustedTask}</div>
                  <p className="change-reason">{change.reason}</p>
                </div>
              ))}
              {result.adjustment.weekChanges && (
                <p className="recovery-week">{result.adjustment.weekChanges}</p>
              )}
            </div>

            <div className="recovery-forward">
              <p>{result.forwardNote}</p>
            </div>

            <button className="btn btn-primary w-full" onClick={onClose}>
              {t.recovery.gotIt}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
