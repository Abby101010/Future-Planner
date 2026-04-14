/* ──────────────────────────────────────────────────────────
   NorthStar — In-App Calendar Page

   • Monthly calendar view with tasks (unified model)
   • Create / edit / delete tasks
   • Mark vacation days
   • Recurring task support
   ────────────────────────────────────────────────────────── */

import { useState, useCallback, useMemo } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Calendar,
  Palmtree,
  Loader2,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import type { DailyTask, Goal, GoalPlanTaskForCalendar } from "@northstar/core";
import { useQuery } from "../../hooks/useQuery";
import { useCommand } from "../../hooks/useCommand";
import CalendarDayDetail from "./CalendarDayDetail";
import CalendarTaskFormModal from "./CalendarEventFormModal";
import { toDateStr } from "../../utils/dateFormat";
import "./CalendarPage.css";

// MUST match packages/server/src/views/calendarView.ts
interface CalendarVacationMode {
  active: boolean;
  startDate: string | null;
  endDate: string | null;
}
interface CalendarView {
  rangeStart: string;
  rangeEnd: string;
  tasks: DailyTask[];
  goalPlanTasks: GoalPlanTaskForCalendar[];
  goals: Goal[];
  vacationMode: CalendarVacationMode;
}

// ── Helpers ─────────────────────────────────────────────

function getDaysInMonth(year: number, month: number): Date[] {
  const days: Date[] = [];
  const d = new Date(year, month, 1);
  while (d.getMonth() === month) {
    days.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

const CATEGORY_COLORS: Record<string, string> = {
  learning: "#3b82f6",
  building: "#ef4444",
  networking: "#f59e0b",
  reflection: "#8b5cf6",
  planning: "#22c55e",
};

// ── Main Component ──────────────────────────────────────

export default function CalendarPage() {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [editingTask, setEditingTask] = useState<DailyTask | null>(null);

  // Task form state
  const [formTitle, setFormTitle] = useState("");
  const [formDate, setFormDate] = useState("");
  const [formStartTime, setFormStartTime] = useState("09:00");
  const [formEndTime, setFormEndTime] = useState("10:00");
  const [formIsAllDay, setFormIsAllDay] = useState(false);
  const [formCategory, setFormCategory] = useState<string>("planning");
  const [formIsVacation, setFormIsVacation] = useState(false);
  const [formNotes, setFormNotes] = useState("");

  // ── View query ────────────────────────────────────────
  const rangeStart = useMemo(
    () => toDateStr(new Date(viewYear, viewMonth - 1, 1)),
    [viewYear, viewMonth],
  );
  const rangeEnd = useMemo(
    () => toDateStr(new Date(viewYear, viewMonth + 2, 0)),
    [viewYear, viewMonth],
  );
  const { data, loading, error, refetch } = useQuery<CalendarView>(
    "view:calendar",
    { startDate: rangeStart, endDate: rangeEnd },
  );
  const { run, running } = useCommand();

  // Merge daily tasks + goal plan tasks into a unified list for the grid.
  // Goal plan tasks are mapped to a DailyTask-like shape with an extra
  // _isGoalPlanTask flag so the day detail can render them distinctly.
  const calendarTasks = useMemo(() => {
    const tasks: (DailyTask & { _isGoalPlanTask?: boolean; _goalTitle?: string })[] =
      data?.tasks ?? [];
    const planTasks: (DailyTask & { _isGoalPlanTask?: boolean; _goalTitle?: string })[] =
      (data?.goalPlanTasks ?? []).map((gpt) => ({
        id: gpt.id,
        title: gpt.title,
        description: gpt.description,
        date: gpt.date,
        category: gpt.category as DailyTask["category"],
        priority: gpt.priority as DailyTask["priority"],
        completed: gpt.completed,
        completedAt: gpt.completedAt,
        durationMinutes: gpt.durationMinutes,
        whyToday: "",
        isMomentumTask: false,
        progressContribution: "",
        goalId: gpt.goalId,
        planNodeId: gpt.id,
        source: "big_goal" as const,
        _isGoalPlanTask: true,
        _goalTitle: gpt.goalTitle,
      }));
    return [...tasks, ...planTasks];
  }, [data]);

  // ── Calendar grid ─────────────────────────────────────

  const daysInMonth = useMemo(
    () => getDaysInMonth(viewYear, viewMonth),
    [viewYear, viewMonth]
  );

  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay();
  const monthLabel = new Date(viewYear, viewMonth).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  const prevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear(viewYear - 1);
    } else {
      setViewMonth(viewMonth - 1);
    }
  };

  const nextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear(viewYear + 1);
    } else {
      setViewMonth(viewMonth + 1);
    }
  };

  const goToToday = () => {
    setViewYear(today.getFullYear());
    setViewMonth(today.getMonth());
  };

  // Get tasks for a specific date
  const getTasksForDate = useCallback(
    (dateStr: string) => {
      return calendarTasks.filter((t) => t.date === dateStr);
    },
    [calendarTasks]
  );

  // ── Task CRUD ────────────────────────────────────────

  const openNewTask = (dateStr?: string) => {
    setEditingTask(null);
    setFormTitle("");
    setFormDate(dateStr || toDateStr(today));
    setFormStartTime("09:00");
    setFormEndTime("10:00");
    setFormIsAllDay(false);
    setFormCategory("planning");
    setFormIsVacation(false);
    setFormNotes("");
    setShowTaskForm(true);
  };

  const openEditTask = (task: DailyTask) => {
    setEditingTask(task);
    setFormTitle(task.title);
    setFormDate(task.date || "");
    setFormStartTime(task.scheduledTime || "09:00");
    setFormEndTime(task.scheduledEndTime || "10:00");
    setFormIsAllDay(task.isAllDay ?? !task.scheduledTime);
    setFormCategory(task.category || "planning");
    setFormIsVacation(task.isVacation ?? false);
    setFormNotes(task.notes || "");
    setShowTaskForm(true);
  };

  const handleSaveTask = async () => {
    if (!formTitle.trim() || !formDate) return;

    const startMs = formIsAllDay
      ? 0
      : new Date(`2000-01-01T${formStartTime}:00`).getTime();
    const endMs = formIsAllDay
      ? 0
      : new Date(`2000-01-01T${formEndTime}:00`).getTime();
    const durationMinutes = formIsAllDay
      ? 960
      : Math.max(1, Math.round((endMs - startMs) / 60000));

    const payload: Record<string, unknown> = {
      description: "",
      durationMinutes,
      priority: "should-do",
      category: formCategory,
      isAllDay: formIsAllDay,
      isVacation: formIsVacation,
      notes: formNotes.trim() || undefined,
      source: "calendar",
    };
    if (!formIsAllDay) {
      payload.scheduledTime = formStartTime;
      payload.scheduledEndTime = formEndTime;
    }

    if (editingTask) {
      // Virtual recurring instances can't be edited directly — skip if id contains `::`
      const taskId = editingTask.id.includes("::") ? editingTask.id.split("::")[0] : editingTask.id;
      await run("command:update-task", {
        taskId,
        patch: {
          title: formTitle.trim(),
          date: formDate,
          ...payload,
        },
      });
    } else {
      await run("command:create-task", {
        date: formDate,
        title: formTitle.trim(),
        payload,
      });
    }

    setShowTaskForm(false);
    setEditingTask(null);
    refetch();
  };

  const handleDeleteTask = async (id: string) => {
    const taskId = id.includes("::") ? id.split("::")[0] : id;
    await run("command:delete-task", { taskId });
    if (editingTask?.id === id) {
      setShowTaskForm(false);
      setEditingTask(null);
    }
    refetch();
  };

  // ── Render ────────────────────────────────────────────

  if (loading && !data) {
    return (
      <div className="calendar-page">
        <div className="calendar-page-scroll">
          <div className="newsfeed-loading">
            <Loader2 size={18} className="spin" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="calendar-page">
        <div className="calendar-page-scroll">
          <div className="error-card">
            <div className="error-card-content">
              <AlertTriangle size={16} />
              <p>{error.message}</p>
            </div>
            <div className="error-card-actions">
              <button className="btn btn-ghost btn-sm" onClick={refetch}>
                <RefreshCw size={13} /> Retry
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const selectedDateTasks = selectedDate ? getTasksForDate(selectedDate) : [];
  const todayStr = toDateStr(today);
  const vacationTasks = calendarTasks.filter((t) => t.isVacation);

  return (
    <div className="calendar-page">
      <div className="calendar-page-scroll">
        {/* Header */}
        <header className="cal-header animate-fade-in">
          <div className="cal-header-left">
            <Calendar size={24} className="cal-header-icon" />
            <div>
              <h2>Calendar</h2>
              <p className="cal-subtitle">
                {calendarTasks.length} task{calendarTasks.length !== 1 ? "s" : ""} ·
                {vacationTasks.length} vacation day{vacationTasks.length !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
          <div className="cal-header-actions">
            <button
              className="btn btn-primary btn-sm"
              onClick={() => openNewTask()}
              disabled={running}
            >
              <Plus size={14} />
              Add Task
            </button>
          </div>
        </header>

        {/* Calendar + day-detail split: calendar shrinks when a date is picked */}
        <div className={`cal-split ${selectedDate ? "cal-split-open" : ""}`}>
        <div className="cal-grid-container card animate-fade-in">
          <div className="cal-nav">
            <button className="btn btn-ghost btn-sm" onClick={prevMonth}>
              <ChevronLeft size={18} />
            </button>
            <h3 className="cal-month-label">{monthLabel}</h3>
            <button className="btn btn-ghost btn-sm" onClick={nextMonth}>
              <ChevronRight size={18} />
            </button>
            <button className="btn btn-ghost btn-xs cal-today-btn" onClick={goToToday}>
              Today
            </button>
          </div>

          <div className="cal-weekdays">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d} className="cal-weekday">
                {d}
              </div>
            ))}
          </div>

          <div className="cal-grid">
            {/* Blank cells before first day */}
            {Array.from({ length: firstDayOfWeek }).map((_, i) => (
              <div key={`blank-${i}`} className="cal-cell cal-cell-blank" />
            ))}

            {/* Day cells */}
            {daysInMonth.map((date) => {
              const dateStr = toDateStr(date);
              const dayTasks = getTasksForDate(dateStr);
              const isToday = dateStr === todayStr;
              const isSelected = dateStr === selectedDate;
              const hasVacation = dayTasks.some((t) => t.isVacation);
              const isWeekend = date.getDay() === 0 || date.getDay() === 6;

              return (
                <button
                  key={dateStr}
                  className={[
                    "cal-cell",
                    isToday && "cal-cell-today",
                    isSelected && "cal-cell-selected",
                    hasVacation && "cal-cell-vacation",
                    isWeekend && "cal-cell-weekend",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() =>
                    setSelectedDate((prev) => (prev === dateStr ? null : dateStr))
                  }
                  onDoubleClick={() => openNewTask(dateStr)}
                >
                  <span className="cal-cell-day">{date.getDate()}</span>
                  {dayTasks.length > 0 && (
                    <div className="cal-cell-dots">
                      {dayTasks.slice(0, 3).map((t) => (
                        <span
                          key={t.id}
                          className="cal-cell-dot"
                          style={{ backgroundColor: CATEGORY_COLORS[t.category] || "#6b7280" }}
                        />
                      ))}
                      {dayTasks.length > 3 && (
                        <span className="cal-cell-more">+{dayTasks.length - 3}</span>
                      )}
                    </div>
                  )}
                  {hasVacation && (
                    <Palmtree size={10} className="cal-cell-vacation-icon" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Day detail panel — appears beside the shrunken calendar */}
        {selectedDate && (
          <CalendarDayDetail
            selectedDate={selectedDate}
            tasks={selectedDateTasks}
            onAddTask={openNewTask}
            onEditTask={openEditTask}
            onDeleteTask={handleDeleteTask}
            onToggleTask={async (id) => {
              await run("command:toggle-task", { taskId: id });
              refetch();
            }}
            onClose={() => setSelectedDate(null)}
          />
        )}
        </div>

        {/* Task Form Modal */}
        {showTaskForm && (
          <CalendarTaskFormModal
            editingTask={editingTask}
            formTitle={formTitle}
            formDate={formDate}
            formStartTime={formStartTime}
            formEndTime={formEndTime}
            formIsAllDay={formIsAllDay}
            formCategory={formCategory}
            formIsVacation={formIsVacation}
            formNotes={formNotes}
            setFormTitle={setFormTitle}
            setFormDate={setFormDate}
            setFormStartTime={setFormStartTime}
            setFormEndTime={setFormEndTime}
            setFormIsAllDay={setFormIsAllDay}
            setFormCategory={setFormCategory}
            setFormIsVacation={setFormIsVacation}
            setFormNotes={setFormNotes}
            onClose={() => setShowTaskForm(false)}
            onSave={handleSaveTask}
          />
        )}
      </div>
    </div>
  );
}
