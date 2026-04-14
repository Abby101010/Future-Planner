import { Check, Clock, SkipForward, Trash2, Ban } from "lucide-react";
import { useT } from "../../i18n";
import type { DailyTask } from "@northstar/core";

interface Props {
  task: DailyTask;
  isOneThing: boolean;
  onToggle: () => void;
  onSkip: () => void;
  /** Optional delete handler. When provided, shows a trash-can button
   *  next to skip. Left optional so callers that don't need destructive
   *  actions (archived views, read-only lists) can skip it. */
  onDelete?: () => void;
  /** Optional can't-complete handler. Shows a "Can't do" button that
   *  routes to the can't-complete flow (reschedule or big goal reevaluation). */
  onCantComplete?: () => void;
  /** Whether the parent selection-mode checkbox is shown. Selected rows
   *  get a highlighted border so the user sees what will be bulk-deleted. */
  selected?: boolean;
  onToggleSelect?: () => void;
  selectMode?: boolean;
  index: number;
  /** Optional source badge text (e.g. "🎯 Goal Name", "📅 Calendar"). */
  sourceBadge?: string;
}

export default function TaskCard({
  task,
  isOneThing,
  onToggle,
  onSkip,
  onDelete,
  onCantComplete,
  selected,
  onToggleSelect,
  selectMode,
  index,
  sourceBadge,
}: Props) {
  const t = useT();
  const isSkipped = !!task.skipped;
  const deferredFrom = (task as unknown as { deferredFrom?: string }).deferredFrom;

  return (
    <div
      className={`task-card ${task.completed ? "completed" : ""} ${isOneThing ? "one-thing" : ""} ${isSkipped ? "skipped" : ""} ${selected ? "selected" : ""}`}
      style={{ animationDelay: `${index * 0.04}s` }}
    >
      {selectMode && (
        <div
          className={`task-select-checkbox ${selected ? "checked" : ""}`}
          onClick={onToggleSelect}
          aria-label="select task"
        >
          {selected && <Check size={14} />}
        </div>
      )}
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
          {deferredFrom && (
            <span className="badge badge-source" title={`Moved from ${deferredFrom}`}>
              moved from {deferredFrom}
            </span>
          )}
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
            {onCantComplete && (
              <button
                className="btn btn-ghost btn-xs task-action-btn task-action-cant"
                onClick={onCantComplete}
                aria-label="can't complete"
                title="Can't complete this task"
              >
                <Ban size={12} /> Can't do
              </button>
            )}
            {onDelete && (
              <button
                className="btn btn-ghost btn-xs task-action-btn task-action-delete"
                onClick={onDelete}
                aria-label="delete task"
                title="Delete task"
              >
                <Trash2 size={12} /> Delete
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
