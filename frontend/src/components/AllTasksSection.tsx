import { Check, ChevronDown, ChevronRight } from "lucide-react";
import type { DailyTask } from "../types";

interface DateGroup {
  date: string;
  tasks: DailyTask[];
}

interface Props {
  groups: DateGroup[];
  totalIncomplete: number;
  isExpanded: boolean;
  onToggle: () => void;
}

export default function AllTasksSection({
  groups,
  totalIncomplete,
  isExpanded,
  onToggle,
}: Props) {
  if (groups.length === 0) return null;

  return (
    <section className="all-tasks-section animate-slide-up">
      <button className="all-tasks-toggle" onClick={onToggle}>
        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span>All Tasks</span>
        {totalIncomplete > 0 && (
          <span className="all-tasks-badge">{totalIncomplete} incomplete</span>
        )}
      </button>
      {isExpanded && (
        <div className="all-tasks-list">
          {groups.map((group) => (
            <div key={group.date} className="all-tasks-date-group">
              <div className="all-tasks-date-label">
                {new Date(group.date + "T00:00:00").toLocaleDateString(
                  undefined,
                  { weekday: "short", month: "short", day: "numeric" },
                )}
              </div>
              {group.tasks.map((task) => (
                <div
                  key={task.id}
                  className={`all-tasks-item ${task.completed ? "all-tasks-item-done" : ""} ${task.skipped ? "all-tasks-item-skipped" : ""}`}
                >
                  <span
                    className={`all-tasks-check ${task.completed ? "checked" : ""}`}
                  >
                    {task.completed ? <Check size={12} /> : null}
                  </span>
                  <span className="all-tasks-item-title">{task.title}</span>
                  <span className="all-tasks-item-meta">
                    {task.category} · {task.durationMinutes}m
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
