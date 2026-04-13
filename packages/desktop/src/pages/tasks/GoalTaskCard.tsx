import { Check, Clock } from "lucide-react";
import useStore from "../../store/useStore";
import { useT, getDateLocale } from "../../i18n";

interface Props {
  task: {
    id: string;
    title: string;
    description: string;
    durationMinutes: number;
    completed: boolean;
    dueDate: string;
  };
  goalTitle: string;
  onToggle: () => void;
}

export default function GoalTaskCard({ task, goalTitle, onToggle }: Props) {
  const t = useT();
  const lang = useStore((s) => s.language);
  return (
    <div className={`task-card goal-task ${task.completed ? "completed" : ""}`}>
      <div className={`task-checkbox ${task.completed ? "checked" : ""}`} onClick={onToggle}>
        {task.completed && <Check size={14} />}
      </div>
      <div className="task-content">
        <div className="task-title-row">
          <span className="task-title">{task.title}</span>
        </div>
        {task.description && <p className="task-description">{task.description}</p>}
        <div className="task-meta">
          <span className="badge badge-accent">{goalTitle}</span>
          <span className="task-duration">
            <Clock size={12} /> {task.durationMinutes}m
          </span>
          {task.dueDate && (
            <span className="task-duration">
              {t.common.due}{" "}
              {new Date(task.dueDate + "T00:00:00").toLocaleDateString(getDateLocale(lang), {
                month: "short",
                day: "numeric",
              })}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
