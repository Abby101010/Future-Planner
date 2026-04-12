import { Lock, ChevronDown, ChevronRight, CheckCircle2, Clock } from "lucide-react";
import type { GoalPlanWeek } from "@northstar/core";

interface Props {
  week: GoalPlanWeek;
  isExpanded: boolean;
  onToggle: () => void;
  onToggleTask: (weekId: string, dayId: string, taskId: string) => void;
  lang: string;
  t: any;
}

export default function GoalPlanWeekCard({
  week,
  isExpanded,
  onToggle,
  onToggleTask,
  t,
}: Props) {
  if (week.locked) {
    return (
      <div className="gp-week locked">
        <div className="gp-week-header locked-header">
          <div className="gp-level-left">
            <Lock size={14} className="gp-lock-icon" />
            <span className="gp-level-label">{week.label}</span>
          </div>
          <span className="gp-locked-hint">{t.goalPlan.lockedHint}</span>
        </div>
      </div>
    );
  }

  const days = week.days ?? [];
  const totalTasks = days.reduce((sum, d) => sum + (d.tasks ?? []).length, 0);
  const completedTasks = days.reduce(
    (sum, d) => sum + (d.tasks ?? []).filter((tk) => tk.completed).length,
    0,
  );
  const allDone = totalTasks > 0 && completedTasks === totalTasks;

  return (
    <div className={`gp-week ${isExpanded ? "expanded" : ""} ${allDone ? "all-done" : ""}`}>
      <div className="gp-week-header-row">
        <button className="gp-week-header" onClick={onToggle}>
          <div className="gp-level-left">
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span className="gp-level-label">{week.label}</span>
          </div>
          <div className="gp-week-right">
            <span className="gp-level-objective">{week.objective}</span>
            <span className="gp-section-count">
              {completedTasks}/{totalTasks}
            </span>
          </div>
        </button>
      </div>

      {isExpanded && days.length > 0 && (
        <div className="gp-week-body animate-slide-up">
          {days.map((day) => (
            <div key={day.id} className="gp-day">
              <div className="gp-day-label">{day.label}</div>
              <div className="gp-day-tasks">
                {(day.tasks ?? []).map((task) => (
                  <div
                    key={task.id}
                    className={`gp-task ${task.completed ? "completed" : ""}`}
                  >
                    <div
                      className={`gp-task-check ${task.completed ? "checked" : ""}`}
                      onClick={() => onToggleTask(week.id, day.id, task.id)}
                    >
                      {task.completed && <CheckCircle2 size={14} />}
                    </div>
                    <div className="gp-task-info">
                      <span className="gp-task-title">{task.title}</span>
                      {task.description && (
                        <p className="gp-task-desc">{task.description}</p>
                      )}
                      <div className="gp-task-meta">
                        <span className="gp-task-duration">
                          <Clock size={11} />
                          {task.durationMinutes}m
                        </span>
                        <span className={`gp-task-priority priority-${task.priority}`}>
                          {task.priority}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
