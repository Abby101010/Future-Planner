import { ChevronDown, ChevronRight, Calendar, Unlock } from "lucide-react";
import GoalPlanWeekCard from "./GoalPlanWeekCard";
import type { GoalPlan } from "@northstar/core";
import type { Language } from "../../i18n";

interface Props {
  plan: GoalPlan;
  expandedYears: Set<string>;
  expandedMonths: Set<string>;
  expandedWeeks: Set<string>;
  onToggleYear: (id: string) => void;
  onToggleMonth: (id: string) => void;
  onToggleWeek: (id: string) => void;
  onToggleTask: (weekId: string, dayId: string, taskId: string) => void;
  hasLockedWeeks: boolean;
  onUnlockNext: () => void;
  lang: Language;
  t: ReturnType<typeof import("../../i18n").useT>;
}

export default function GoalPlanHierarchy({
  plan,
  expandedYears,
  expandedMonths,
  expandedWeeks,
  onToggleYear,
  onToggleMonth,
  onToggleWeek,
  onToggleTask,
  hasLockedWeeks,
  onUnlockNext,
  lang,
  t,
}: Props) {
  if (!Array.isArray(plan.years) || plan.years.length === 0) return null;

  return (
    <section className="gp-hierarchy animate-slide-up">
      {plan.years.map((year, yearIndex) => (
        <div key={year.id} className="gp-year">
          <div className="gp-year-header-row">
            <button
              className="gp-year-header"
              onClick={() => onToggleYear(year.id)}
            >
              <div className="gp-level-left">
                {expandedYears.has(year.id) ? (
                  <ChevronDown size={16} />
                ) : (
                  <ChevronRight size={16} />
                )}
                <Calendar size={16} className="gp-level-icon year-icon" />
                <span className="gp-level-label">{year.label || `Year ${yearIndex + 1}`}</span>
              </div>
              <span className="gp-level-objective">{year.objective}</span>
            </button>
          </div>

          {expandedYears.has(year.id) && (
            <div className="gp-year-body">
              {(year.months ?? []).map((month, monthIndex) => (
                <div key={month.id} className="gp-month">
                  <div className="gp-month-header-row">
                    <button
                      className="gp-month-header"
                      onClick={() => onToggleMonth(month.id)}
                    >
                      <div className="gp-level-left">
                        {expandedMonths.has(month.id) ? (
                          <ChevronDown size={14} />
                        ) : (
                          <ChevronRight size={14} />
                        )}
                        <span className="gp-level-label">{month.label || `Month ${monthIndex + 1}`}</span>
                      </div>
                      <span className="gp-level-objective">
                        {month.objective}
                      </span>
                    </button>
                  </div>

                  {expandedMonths.has(month.id) && (
                    <div className="gp-month-body">
                      {(month.weeks ?? []).length > 0 ? (
                        (month.weeks ?? []).map((week, weekIndex) => (
                          <GoalPlanWeekCard
                            key={week.id}
                            week={week}
                            weekIndex={weekIndex}
                            isExpanded={expandedWeeks.has(week.id)}
                            onToggle={() => onToggleWeek(week.id)}
                            onToggleTask={onToggleTask}
                            lang={lang}
                            t={t}
                          />
                        ))
                      ) : (
                        <div className="gp-month-empty">
                          Weeks will appear here as the plan progresses.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {hasLockedWeeks && (
        <button className="btn btn-ghost gp-unlock-btn" onClick={onUnlockNext}>
          <Unlock size={14} />
          {t.goalPlan.unlockNextWeek}
        </button>
      )}
    </section>
  );
}
