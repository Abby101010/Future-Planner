import { Check, Clock, SkipForward } from "lucide-react";
import { useT } from "../i18n";
import type { DailyTask } from "@northstar/core";

interface Props {
  task: DailyTask;
  isOneThing: boolean;
  onToggle: () => void;
  onSkip: () => void;
  index: number;
  /** Optional source badge text (e.g. "🎯 Goal Name", "📅 Calendar"). */
  sourceBadge?: string;
}

export default function TaskCard({
  task,
  isOneThing,
  onToggle,
  onSkip,
  index,
  sourceBadge,
}: Props) {
  const t = useT();
  const isSkipped = !!task.skipped;

  return (
    <div
      className={`task-card ${task.completed ? "completed" : ""} ${isOneThing ? "one-thing" : ""} ${isSkipped ? "skipped" : ""}`}
      style={{ animationDelay: `${index * 0.04}s` }}
    >
      <div
        className={`task-checkbox ${task.completed ? "checked" : ""}`}
        onClick={onToggle}
      >
        {task.completed && <Check size={14} />}
      </div>

      <div className="task-content">
        <div className="task-title-row">
          <span className="task-title">{task.title}</span>
          {isOneThing && <span className="badge badge-accent">{t.dashboard.priority}</span>}
          {isSkipped && <span className="badge badge-red">{t.dashboard.skipped}</span>}
          {sourceBadge && <span className="badge badge-source">{sourceBadge}</span>}
        </div>
        <div className="task-meta">
          <span className="task-duration">
            <Clock size={11} />
            {task.durationMinutes}m
          </span>
          {task.category && (
            <>
              <span className="task-meta-sep" />
              <span className="task-meta-label">{task.category}</span>
            </>
          )}
        </div>

        {!task.completed && !isSkipped && (
          <div className="task-actions">
            <button className="btn btn-ghost btn-xs task-action-btn task-action-skip" onClick={onSkip}>
              <SkipForward size={12} /> {t.dashboard.skip}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
