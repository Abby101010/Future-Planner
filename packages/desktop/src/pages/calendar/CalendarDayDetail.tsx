import { Plus, Clock, Palmtree, Trash2, X, CheckCircle2, Circle, Target } from "lucide-react";
import type { DailyTask } from "@northstar/core";

const CATEGORY_COLORS: Record<string, string> = {
  learning: "#3b82f6",
  building: "#ef4444",
  networking: "#f59e0b",
  reflection: "#8b5cf6",
  planning: "#22c55e",
};

interface Props {
  selectedDate: string;
  tasks: DailyTask[];
  onAddTask: (date: string) => void;
  onEditTask: (task: DailyTask) => void;
  onDeleteTask: (id: string) => void;
  onToggleTask: (id: string) => void;
  onClose?: () => void;
}

export default function CalendarDayDetail({
  selectedDate,
  tasks,
  onAddTask,
  onEditTask,
  onDeleteTask,
  onToggleTask,
  onClose,
}: Props) {
  // Sort: scheduled-time tasks first (by time), then all-day / unscheduled
  const sorted = [...tasks].sort((a, b) => {
    if (a.scheduledTime && b.scheduledTime) return a.scheduledTime.localeCompare(b.scheduledTime);
    if (a.scheduledTime) return -1;
    if (b.scheduledTime) return 1;
    return 0;
  });

  return (
    <div className="cal-day-detail card animate-slide-up">
      <div className="cal-day-detail-header">
        <h3>
          {new Date(selectedDate + "T12:00:00").toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric",
          })}
        </h3>
        <div className="cal-day-detail-actions">
          <button
            className="btn btn-primary btn-sm"
            onClick={() => onAddTask(selectedDate)}
          >
            <Plus size={14} />
            Add Task
          </button>
          {onClose && (
            <button
              className="btn btn-ghost btn-sm cal-day-detail-close"
              onClick={onClose}
              title="Close"
              aria-label="Close day detail"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {sorted.length === 0 ? (
        <p className="cal-day-empty">
          No tasks. Double-click a date or press Add to create one.
        </p>
      ) : (
        <div className="cal-day-events">
          {sorted.map((task) => {
              const extra = task as unknown as Record<string, unknown>;
              const isGoalPlan = Boolean(extra._isGoalPlanTask);
              const goalTitle = extra._goalTitle as string | undefined;
              return (
              <div
                key={task.id}
                className={`cal-event ${task.isVacation ? "cal-event-vacation" : ""} ${task.completed ? "cal-event-completed" : ""}`}
                style={{ borderLeftColor: CATEGORY_COLORS[task.category] || "#6b7280" }}
              >
                <div className="cal-event-main">
                  <div className="cal-event-title-row">
                    <button
                      className="btn btn-ghost btn-xs cal-event-check"
                      onClick={() => onToggleTask(task.id)}
                      title={task.completed ? "Mark incomplete" : "Mark complete"}
                    >
                      {task.completed
                        ? <CheckCircle2 size={16} className="cal-event-done" />
                        : <Circle size={16} />}
                    </button>
                    <span className={`cal-event-title ${task.completed ? "cal-event-title-done" : ""}`}>
                      {task.title}
                    </span>
                  </div>
                  {isGoalPlan && goalTitle && (
                    <div className="cal-event-goal-badge">
                      <Target size={11} />
                      {goalTitle}
                    </div>
                  )}
                  <div className="cal-event-time">
                    {task.isAllDay || !task.scheduledTime ? (
                      isGoalPlan
                        ? `${task.durationMinutes ?? 30}m`
                        : "All day"
                    ) : (
                      <>
                        <Clock size={12} />
                        {task.scheduledTime} – {task.scheduledEndTime || ""}
                        <span className="cal-event-duration">
                          ({task.durationMinutes}m)
                        </span>
                      </>
                    )}
                  </div>
                  <div className="cal-event-meta">
                    <span
                      className="cal-event-category"
                      style={{
                        backgroundColor: (CATEGORY_COLORS[task.category] || "#6b7280") + "22",
                        color: CATEGORY_COLORS[task.category] || "#6b7280",
                      }}
                    >
                      {task.category}
                    </span>
                    <span className="cal-event-priority">{task.priority}</span>
                    {task.isVacation && (
                      <span className="cal-event-vac-badge">
                        <Palmtree size={11} />
                        Vacation
                      </span>
                    )}
                  </div>
                  {task.notes && (
                    <p className="cal-event-notes">{task.notes}</p>
                  )}
                </div>
                {!isGoalPlan && (
                <div className="cal-event-actions">
                  <button
                    className="btn btn-ghost btn-xs"
                    onClick={() => onEditTask(task)}
                    title="Edit"
                  >
                    ✏️
                  </button>
                  <button
                    className="btn btn-ghost btn-xs"
                    onClick={() => onDeleteTask(task.id)}
                    title="Delete"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                )}
              </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
