import { X, MessageCircle } from "lucide-react";
import type { ContextualNudge } from "@northstar/core";

interface Props {
  nudge: ContextualNudge;
  onDismiss: () => void;
  onRespond: (feedbackValue: string, isPositive: boolean) => void;
}

const TYPE_ICONS: Record<string, string> = {
  early_finish: "🎯",
  snooze_probe: "😴",
  missed_deadline: "⏰",
  dead_zone: "🕳️",
  overwhelm: "😮‍💨",
  streak: "🔥",
  proactive: "💡",
  pace_warning: "⚠️",
};

const TYPE_COLORS: Record<string, string> = {
  early_finish: "nudge-positive",
  streak: "nudge-positive",
  snooze_probe: "nudge-neutral",
  dead_zone: "nudge-neutral",
  proactive: "nudge-neutral",
  missed_deadline: "nudge-warning",
  overwhelm: "nudge-warning",
  pace_warning: "nudge-warning",
};

export default function NudgeCard({ nudge, onDismiss, onRespond }: Props) {
  return (
    <div className={`nudge-card ${TYPE_COLORS[nudge.type] ?? "nudge-neutral"}`}>
      <div className="nudge-header">
        <span className="nudge-icon">{TYPE_ICONS[nudge.type] ?? "💬"}</span>
        <p className="nudge-message">{nudge.message}</p>
        <button className="nudge-dismiss" onClick={onDismiss} title="Dismiss">
          <X size={14} />
        </button>
      </div>
      {(nudge.actions ?? []).length > 0 && (
        <div className="nudge-actions">
          {(nudge.actions ?? []).map((action, i) => (
            <button
              key={i}
              className={`btn btn-xs ${action.isPositive ? "btn-primary" : "btn-ghost"}`}
              onClick={() => onRespond(action.feedbackValue, action.isPositive)}
            >
              <MessageCircle size={10} /> {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
