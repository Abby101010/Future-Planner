/* NorthStar - Goal Breakdown Page
   Hierarchical drill-down: Year > Month > Week > Day
   With calendar integration and reallocation */

import { useState, useCallback } from "react";
import {
  ChevronRight,
  ChevronDown,
  Calendar,
  Clock,
  Loader2,
  Sparkles,
  RefreshCw,
  Target,
  Zap,
  Sun,
  Moon,
  Palmtree,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
} from "lucide-react";
import useStore from "../store/useStore";
import { generateGoalBreakdown, reallocateGoals, getCalendarSchedule } from "../services/ai";
import type {
  GoalBreakdown,
  YearPlan,
  MonthPlan,
  WeekPlan,
  DayPlan,
  ClarifiedGoal,
} from "../types";
import "./GoalBreakdownPage.css";

export default function GoalBreakdownPage() {
  const {
    goalBreakdown,
    setGoalBreakdown,
    calendarEvents,
    deviceIntegrations,
    user,
    isLoading,
    setLoading,
    error,
    setError,
    setView,
  } = useStore();

  const [activeYear, setActiveYear] = useState<number | null>(null);
  const [activeMonth, setActiveMonth] = useState<string | null>(null);
  const [activeWeek, setActiveWeek] = useState<number | null>(null);
  const [showNewGoal, setShowNewGoal] = useState(!goalBreakdown);
  const [showReallocate, setShowReallocate] = useState(false);
  const [reallocateReason, setReallocateReason] = useState("");

  // Quick goal form state
  const [goalText, setGoalText] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [dailyHours, setDailyHours] = useState(2);
  const [calendarStatus, setCalendarStatus] = useState<"unknown" | "checking" | "ok" | "denied">("unknown");

  // Check calendar status
  const checkCalendar = useCallback(async () => {
    setCalendarStatus("checking");
    try {
      const today = new Date().toISOString().split("T")[0];
      const result = await getCalendarSchedule(today, today, calendarEvents, deviceIntegrations);
      setCalendarStatus(result.ok ? "ok" : "denied");
    } catch {
      setCalendarStatus("denied");
    }
  }, [calendarEvents, deviceIntegrations]);

  // Generate breakdown
  const handleGenerate = useCallback(async () => {
    if (!goalText.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const goal: ClarifiedGoal = {
        goal: goalText,
        startingPoint: user?.currentRole || "Getting started",
        targetOutcome: goalText,
        timeline: targetDate || "flexible",
        timeBudget: `${dailyHours} hours/day`,
        constraints: user?.constraints || "None specified",
        motivation: "Personal growth",
      };
      const breakdown = await generateGoalBreakdown(goal, targetDate, dailyHours, calendarEvents, deviceIntegrations);
      setGoalBreakdown(breakdown);
      setShowNewGoal(false);

      // Auto-expand first year
      if (breakdown.yearlyBreakdown.length > 0) {
        setActiveYear(breakdown.yearlyBreakdown[0].year);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate plan");
    } finally {
      setLoading(false);
    }
  }, [goalText, targetDate, dailyHours, user, setLoading, setError, setGoalBreakdown]);

  // Reallocate
  const handleReallocate = useCallback(async () => {
    if (!goalBreakdown || !reallocateReason.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const updated = await reallocateGoals(goalBreakdown, reallocateReason, undefined, calendarEvents, deviceIntegrations);
      setGoalBreakdown(updated);
      setShowReallocate(false);
      setReallocateReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reallocate");
    } finally {
      setLoading(false);
    }
  }, [goalBreakdown, reallocateReason, setLoading, setError, setGoalBreakdown]);

  // -- RENDER --

  return (
    <div className="goal-breakdown">
      <div className="goal-breakdown-scroll">
        {/* Header */}
        <header className="gb-header animate-fade-in">
          <div className="gb-header-left">
            <Target size={24} className="gb-header-icon" />
            <div>
              <h2>Goal Breakdown</h2>
              <p className="gb-subtitle">
                {goalBreakdown
                  ? goalBreakdown.goalSummary
                  : "Break your big goal into years, months, weeks, and days"}
              </p>
            </div>
          </div>
          <div className="gb-header-actions">
            {goalBreakdown && (
              <>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setShowReallocate(!showReallocate)}
                >
                  <RefreshCw size={14} />
                  Reallocate
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setShowNewGoal(true)}
                >
                  <Sparkles size={14} />
                  New Goal
                </button>
              </>
            )}
          </div>
        </header>

        {/* Error */}
        {error && (
          <div className="gb-error animate-fade-in">
            <AlertTriangle size={16} />
            <p>{error}</p>
          </div>
        )}

        {/* Reallocation panel */}
        {showReallocate && goalBreakdown && (
          <div className="gb-reallocate-panel card animate-slide-up">
            <h3>
              <RefreshCw size={16} />
              Reallocate Plan
            </h3>
            <p>Schedule changed? Going on vacation? Tell the AI what happened and it will adjust your plan.</p>
            <textarea
              className="input gb-reallocate-input"
              placeholder="e.g., I'm going on vacation July 10-17, or I have a busy week at work..."
              value={reallocateReason}
              onChange={(e) => setReallocateReason(e.target.value)}
              rows={3}
            />
            <div className="gb-reallocate-actions">
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setShowReallocate(false)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleReallocate}
                disabled={isLoading || !reallocateReason.trim()}
              >
                {isLoading ? (
                  <>
                    <Loader2 size={14} className="spin" />
                    Reallocating...
                  </>
                ) : (
                  <>
                    <RefreshCw size={14} />
                    Reallocate
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Reallocation summary */}
        {goalBreakdown?.reallocationSummary && (
          <div className="gb-realloc-summary card animate-fade-in">
            <h4>
              <CheckCircle2 size={16} />
              Plan Updated
            </h4>
            <p><strong>Reason:</strong> {goalBreakdown.reallocationSummary.reason}</p>
            <p><strong>Impact:</strong> {goalBreakdown.reallocationSummary.timelineImpact}</p>
            <p>
              {goalBreakdown.reallocationSummary.daysAffected} days affected,{" "}
              {goalBreakdown.reallocationSummary.tasksMoved} tasks moved
            </p>
            <ul className="gb-realloc-changes">
              {goalBreakdown.reallocationSummary.keyChanges.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>
        )}

        {/* New Goal Form */}
        {showNewGoal && (
          <div className="gb-new-goal card animate-slide-up">
            <h3>
              <Sparkles size={18} />
              Create Your Plan
            </h3>
            <p className="gb-new-goal-desc">
              Describe your goal and the AI will break it down into actionable steps,
              respecting your calendar and schedule.
            </p>

            <div className="gb-form">
              <div className="gb-form-group">
                <label>What's your goal?</label>
                <textarea
                  className="input"
                  placeholder="e.g., Learn machine learning and build a portfolio project"
                  value={goalText}
                  onChange={(e) => setGoalText(e.target.value)}
                  rows={3}
                />
              </div>

              <div className="gb-form-row">
                <div className="gb-form-group">
                  <label>
                    <Calendar size={14} />
                    Target date (optional)
                  </label>
                  <input
                    type="date"
                    className="input"
                    value={targetDate}
                    onChange={(e) => setTargetDate(e.target.value)}
                  />
                </div>
                <div className="gb-form-group">
                  <label>
                    <Clock size={14} />
                    Hours per day
                  </label>
                  <input
                    type="number"
                    className="input"
                    value={dailyHours}
                    onChange={(e) => setDailyHours(Number(e.target.value))}
                    min={0.5}
                    max={8}
                    step={0.5}
                  />
                </div>
              </div>

              {/* Calendar status */}
              <div className="gb-calendar-status">
                {calendarEvents.length > 0 ? (
                  <span className="gb-cal-ok">
                    <CheckCircle2 size={14} />
                    {calendarEvents.length} event{calendarEvents.length !== 1 ? "s" : ""} in your calendar
                    {deviceIntegrations.calendar.enabled && " (+ device sync)"}
                  </span>
                ) : (
                  <span className="gb-cal-denied">
                    <AlertTriangle size={14} />
                    No events in calendar — add events for a smarter plan
                  </span>
                )}
                <button className="btn btn-ghost btn-sm" onClick={() => setView("calendar")}>
                  <Calendar size={14} />
                  Open Calendar
                </button>
              </div>

              <div className="gb-form-actions">
                {goalBreakdown && (
                  <button
                    className="btn btn-ghost"
                    onClick={() => setShowNewGoal(false)}
                  >
                    Cancel
                  </button>
                )}
                <button
                  className="btn btn-primary"
                  onClick={handleGenerate}
                  disabled={isLoading || !goalText.trim()}
                >
                  {isLoading ? (
                    <>
                      <Loader2 size={16} className="spin" />
                      AI is thinking...
                    </>
                  ) : (
                    <>
                      <Sparkles size={16} />
                      Generate Plan
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Or use Goal Coach */}
            <div className="gb-alt-path">
              <span>Want a guided conversation instead?</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setView("onboarding")}>
                Open Goal Coach
                <ArrowRight size={14} />
              </button>
            </div>
          </div>
        )}

        {/* Breakdown Overview */}
        {goalBreakdown && !showNewGoal && (
          <div className="gb-overview animate-fade-in">
            <div className="gb-stats-row">
              <div className="gb-stat card">
                <div className="gb-stat-label">Total Hours</div>
                <div className="gb-stat-value">{goalBreakdown.totalEstimatedHours}h</div>
              </div>
              <div className="gb-stat card">
                <div className="gb-stat-label">Completion</div>
                <div className="gb-stat-value">{goalBreakdown.projectedCompletion}</div>
              </div>
              <div className="gb-stat card">
                <div className="gb-stat-label">Confidence</div>
                <div className={`gb-stat-value gb-confidence-${goalBreakdown.confidenceLevel}`}>
                  {goalBreakdown.confidenceLevel}
                </div>
              </div>
              <div className="gb-stat card">
                <div className="gb-stat-label">Version</div>
                <div className="gb-stat-value">v{goalBreakdown.version}</div>
              </div>
            </div>

            {/* AI Reasoning */}
            {goalBreakdown.reasoning && (
              <div className="gb-reasoning card">
                <h4>
                  <Zap size={16} />
                  AI Reasoning
                </h4>
                <p>{goalBreakdown.reasoning}</p>
              </div>
            )}

            {/* Year-level breakdown */}
            <div className="gb-timeline">
              {goalBreakdown.yearlyBreakdown.map((year) => (
                <YearCard
                  key={year.year}
                  year={year}
                  isActive={activeYear === year.year}
                  onToggle={() => setActiveYear(activeYear === year.year ? null : year.year)}
                  activeMonth={activeMonth}
                  setActiveMonth={setActiveMonth}
                  activeWeek={activeWeek}
                  setActiveWeek={setActiveWeek}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// -- Year Card --
function YearCard({
  year,
  isActive,
  onToggle,
  activeMonth,
  setActiveMonth,
  activeWeek,
  setActiveWeek,
}: {
  year: YearPlan;
  isActive: boolean;
  onToggle: () => void;
  activeMonth: string | null;
  setActiveMonth: (m: string | null) => void;
  activeWeek: number | null;
  setActiveWeek: (w: number | null) => void;
}) {
  return (
    <div className={`gb-year ${isActive ? "expanded" : ""}`}>
      <button className="gb-year-header" onClick={onToggle}>
        <div className="gb-year-left">
          {isActive ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          <Sun size={18} className="gb-year-icon" />
          <span className="gb-year-label">{year.year}</span>
          <span className="gb-year-theme">{year.theme}</span>
        </div>
        <span className="gb-year-months">{year.months.length} months</span>
      </button>

      {isActive && (
        <div className="gb-year-body animate-slide-up">
          <p className="gb-year-outcome">{year.outcome}</p>
          <div className="gb-months">
            {year.months.map((month) => (
              <MonthCard
                key={month.month}
                month={month}
                isActive={activeMonth === month.month}
                onToggle={() => setActiveMonth(activeMonth === month.month ? null : month.month)}
                activeWeek={activeWeek}
                setActiveWeek={setActiveWeek}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// -- Month Card --
function MonthCard({
  month,
  isActive,
  onToggle,
  activeWeek,
  setActiveWeek,
}: {
  month: MonthPlan;
  isActive: boolean;
  onToggle: () => void;
  activeWeek: number | null;
  setActiveWeek: (w: number | null) => void;
}) {
  return (
    <div className={`gb-month ${isActive ? "expanded" : ""}`}>
      <button className="gb-month-header" onClick={onToggle}>
        <div className="gb-month-left">
          {isActive ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <Moon size={16} className="gb-month-icon" />
          <span className="gb-month-label">{month.label}</span>
        </div>
        <div className="gb-month-right">
          {month.adjustedFor && (
            <span className="badge badge-yellow">
              <Palmtree size={12} />
              Adjusted
            </span>
          )}
          <span className="gb-month-hours">{month.estimatedHours}h</span>
        </div>
      </button>

      {isActive && (
        <div className="gb-month-body animate-slide-up">
          <p className="gb-month-focus"><strong>Focus:</strong> {month.focus}</p>
          {month.adjustedFor && (
            <p className="gb-month-adjusted">
              <Palmtree size={14} />
              {month.adjustedFor}
            </p>
          )}
          <div className="gb-objectives">
            <strong>Objectives:</strong>
            <ul>
              {month.objectives.map((obj, i) => (
                <li key={i}>{obj}</li>
              ))}
            </ul>
          </div>
          {month.reasoning && <p className="gb-month-reasoning">{month.reasoning}</p>}

          {/* Weeks */}
          {month.weeks.length > 0 && (
            <div className="gb-weeks">
              {month.weeks.map((week) => (
                <WeekCard
                  key={`${month.month}-w${week.weekNumber}`}
                  week={week}
                  isActive={activeWeek === week.weekNumber}
                  onToggle={() => setActiveWeek(activeWeek === week.weekNumber ? null : week.weekNumber)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// -- Week Card --
function WeekCard({
  week,
  isActive,
  onToggle,
}: {
  week: WeekPlan;
  isActive: boolean;
  onToggle: () => void;
}) {
  const intensityColors: Record<string, string> = {
    light: "badge-green",
    normal: "badge-blue",
    heavy: "badge-red",
  };

  return (
    <div className={`gb-week ${isActive ? "expanded" : ""}`}>
      <button className="gb-week-header" onClick={onToggle}>
        <div className="gb-week-left">
          {isActive ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className="gb-week-label">Week {week.weekNumber}</span>
          <span className="gb-week-dates">{week.startDate} - {week.endDate}</span>
        </div>
        <div className="gb-week-right">
          <span className={`badge ${intensityColors[week.intensity] || "badge-blue"}`}>
            {week.intensity}
          </span>
          <span className="gb-week-hours">{week.estimatedHours}h</span>
        </div>
      </button>

      {isActive && (
        <div className="gb-week-body animate-slide-up">
          <p className="gb-week-focus"><strong>Focus:</strong> {week.focus}</p>
          <div className="gb-deliverables">
            <strong>Deliverables:</strong>
            <ul>
              {week.deliverables.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          </div>

          {/* Days */}
          {week.days.length > 0 && (
            <div className="gb-days">
              {week.days.map((day) => (
                <DayCard key={day.date} day={day} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// -- Day Card --
function DayCard({ day }: { day: DayPlan }) {
  if (day.isVacation) {
    return (
      <div className="gb-day vacation">
        <div className="gb-day-header">
          <span className="gb-day-name">{day.dayName}</span>
          <span className="gb-day-date">{day.date}</span>
          <span className="badge badge-yellow">
            <Palmtree size={12} />
            Vacation
          </span>
        </div>
      </div>
    );
  }

  if (day.isWeekend && day.tasks.length === 0) {
    return (
      <div className="gb-day weekend">
        <div className="gb-day-header">
          <span className="gb-day-name">{day.dayName}</span>
          <span className="gb-day-date">{day.date}</span>
          <span className="badge badge-blue">Weekend</span>
        </div>
      </div>
    );
  }

  const totalTaskMinutes = day.tasks.reduce((s, t) => s + t.durationMinutes, 0);

  return (
    <div className="gb-day">
      <div className="gb-day-header">
        <span className="gb-day-name">{day.dayName}</span>
        <span className="gb-day-date">{day.date}</span>
        <span className="gb-day-time">
          <Clock size={12} />
          {totalTaskMinutes}m / {day.availableMinutes}m free
        </span>
      </div>
      {day.tasks.length > 0 && (
        <div className="gb-day-tasks">
          {day.tasks.map((task, i) => {
            const priorityColors: Record<string, string> = {
              "must-do": "badge-red",
              "should-do": "badge-yellow",
              bonus: "badge-blue",
            };
            const categoryColors: Record<string, string> = {
              learning: "badge-accent",
              building: "badge-green",
              networking: "badge-yellow",
              reflection: "badge-blue",
              planning: "badge-blue",
            };
            return (
              <div key={i} className="gb-task">
                <div className="gb-task-title">
                  <span>{task.title}</span>
                  <span className="gb-task-duration">
                    <Clock size={11} />
                    {task.durationMinutes}m
                  </span>
                </div>
                {task.description && (
                  <p className="gb-task-desc">{task.description}</p>
                )}
                <div className="gb-task-meta">
                  <span className={`badge ${priorityColors[task.priority] || "badge-blue"}`}>
                    {task.priority}
                  </span>
                  <span className={`badge ${categoryColors[task.category] || "badge-blue"}`}>
                    {task.category}
                  </span>
                </div>
                {task.whyToday && <p className="gb-task-why">{task.whyToday}</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
