import { Target, Clock, ArrowLeft } from "lucide-react";
import { IconPicker } from "./RichTextToolbar";
import type { Goal } from "@northstar/core";
import { getDateLocale, type Language } from "../i18n";

interface Props {
  goal: Goal;
  showIconPicker: boolean;
  onToggleIconPicker: () => void;
  onSelectIcon: (icon: string) => void;
  onCloseIconPicker: () => void;
  totalTasks: number;
  completedTasks: number;
  progressPercent: number;
  lang: Language;
  t: ReturnType<typeof import("../i18n").useT>;
  onBack: () => void;
}

const importanceColors: Record<string, string> = {
  low: "badge-blue",
  medium: "badge-yellow",
  high: "badge-red",
  critical: "badge-red",
};

export default function GoalPlanHeader({
  goal,
  showIconPicker,
  onToggleIconPicker,
  onSelectIcon,
  onCloseIconPicker,
  totalTasks,
  completedTasks,
  progressPercent,
  lang,
  t,
  onBack,
}: Props) {
  return (
    <header className="gp-header animate-fade-in">
      <button className="btn btn-ghost btn-sm gp-back" onClick={onBack}>
        <ArrowLeft size={16} />
        Planning
      </button>
      <div className="gp-header-main">
        <div className="gp-header-info">
          <button
            className={`goal-icon-btn gp-header-icon-btn ${goal.icon ? "has-icon" : ""}`}
            onClick={onToggleIconPicker}
            title="Choose icon"
          >
            {goal.icon || <Target size={24} />}
          </button>
          {showIconPicker && (
            <IconPicker
              currentIcon={goal.icon}
              onSelect={onSelectIcon}
              onClose={onCloseIconPicker}
            />
          )}
          <div>
            <h2>{goal.title}</h2>
            {goal.description && (
              <p className="gp-header-description">{goal.description}</p>
            )}
            <div className="gp-header-meta">
              <span className={`badge ${importanceColors[goal.importance]}`}>
                {goal.importance}
              </span>
              {goal.isHabit && (
                <span className="badge badge-purple">{t.common.habit}</span>
              )}
              {goal.targetDate && !goal.isHabit && (
                <span className="gp-meta-item">
                  <Clock size={14} />
                  {new Date(goal.targetDate).toLocaleDateString(
                    getDateLocale(lang),
                    { month: "short", day: "numeric", year: "numeric" },
                  )}
                </span>
              )}
              <span
                className={`badge ${goal.planConfirmed ? "badge-green" : "badge-yellow"}`}
              >
                {goal.planConfirmed ? t.common.active : t.common.planning}
              </span>
            </div>
          </div>
        </div>
        {totalTasks > 0 && (
          <div className="gp-progress">
            <div className="gp-progress-label">
              {t.goalPlan.tasksProgress(
                completedTasks,
                totalTasks,
                progressPercent,
              )}
            </div>
            <div className="gp-progress-bar">
              <div
                className="gp-progress-fill"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
