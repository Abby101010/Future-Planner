import { useState } from "react";
import {
  Loader2,
  CheckCircle2,
  Pencil,
  Clock,
  Calendar,
  CalendarDays,
  AlertTriangle,
  Check,
  XCircle,
  Target,
  ArrowRight,
} from "lucide-react";
import { useT } from "../../i18n";
import type { PendingTask, CalendarEvent, Goal } from "@northstar/core";

export interface DailyLoad {
  currentWeight: number;
  currentMinutes: number;
  activeTaskCount: number;
  todayEventCount: number;
}

export function getOverloadWarnings(
  load: DailyLoad,
  addWeight = 0,
  addMinutes = 0,
): string[] {
  const warnings: string[] = [];
  const newWeight = load.currentWeight + addWeight;
  const newMinutes = load.currentMinutes + addMinutes;

  if (newWeight > 12) {
    warnings.push(`Cognitive load will hit ${newWeight}/12 — over your daily limit`);
  } else if (newWeight >= 10) {
    warnings.push(`Cognitive load will reach ${newWeight}/12 — near your limit`);
  }

  if (newMinutes > 180) {
    warnings.push(`Total time will exceed the 3-hour deep work ceiling (${newMinutes} min)`);
  } else if (newMinutes >= 150) {
    warnings.push(`You're approaching the 3-hour ceiling (${newMinutes} min scheduled)`);
  }

  if (load.activeTaskCount >= 5) {
    warnings.push(`You already have ${load.activeTaskCount} active tasks — decision fatigue risk`);
  } else if (load.activeTaskCount >= 4) {
    warnings.push(`Adding this gives you ${load.activeTaskCount + 1} active tasks — near the limit`);
  }

  if (load.todayEventCount >= 3) {
    warnings.push(`Packed day — ${load.todayEventCount} calendar events already`);
  }

  return warnings;
}

export function PendingTaskCard({
  pendingTask,
  dailyLoad,
  onConfirm,
  onReject,
  onUpdateAnalysis,
}: {
  pendingTask: PendingTask;
  dailyLoad: DailyLoad;
  onConfirm: () => void;
  onReject: () => void;
  onUpdateAnalysis: (updates: Partial<NonNullable<PendingTask["analysis"]>>) => void;
}) {
  const t = useT();
  const [editingDesc, setEditingDesc] = useState(false);
  const [editDesc, setEditDesc] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState("");

  if (pendingTask.status === "analyzing") {
    return (
      <div className="pending-card pending-card-analyzing">
        <div className="pending-card-header">
          <Loader2 size={14} className="spin" />
          <span className="pending-card-input">"{pendingTask.userInput}"</span>
        </div>
        <p className="pending-card-status">{t.home.analyzing}</p>
      </div>
    );
  }

  if (!pendingTask.analysis) return null;
  const a = pendingTask.analysis;

  const isForToday = a.suggestedDate === new Date().toISOString().split("T")[0];
  const overloadWarnings = isForToday
    ? getOverloadWarnings(dailyLoad, a.cognitiveWeight, a.durationMinutes)
    : [];

  const weightColors: Record<number, string> = {
    1: "badge-weight-1", 2: "badge-weight-2", 3: "badge-weight-3",
    4: "badge-weight-4", 5: "badge-weight-5",
  };

  return (
    <div className="pending-card pending-card-ready">
      <div className="pending-card-header">
        <CheckCircle2 size={14} className="pending-ready-icon" />
        {editingTitle ? (
          <input
            className="input pending-edit-input pending-edit-title"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onBlur={() => {
              if (editTitle.trim()) onUpdateAnalysis({ title: editTitle.trim() });
              setEditingTitle(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (editTitle.trim()) onUpdateAnalysis({ title: editTitle.trim() });
                setEditingTitle(false);
              }
              if (e.key === "Escape") setEditingTitle(false);
            }}
            autoFocus
          />
        ) : (
          <span
            className="pending-card-title pending-editable"
            onClick={() => { setEditTitle(a.title); setEditingTitle(true); }}
            title="Click to edit"
          >
            {a.title}
            <Pencil size={11} className="pending-edit-icon" />
          </span>
        )}
      </div>
      {a.description && (
        editingDesc ? (
          <textarea
            className="input pending-edit-input pending-edit-desc"
            value={editDesc}
            onChange={(e) => setEditDesc(e.target.value)}
            onBlur={() => {
              onUpdateAnalysis({ description: editDesc.trim() });
              setEditingDesc(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onUpdateAnalysis({ description: editDesc.trim() });
                setEditingDesc(false);
              }
              if (e.key === "Escape") setEditingDesc(false);
            }}
            rows={2}
            autoFocus
          />
        ) : (
          <p
            className="pending-card-desc pending-editable"
            onClick={() => { setEditDesc(a.description); setEditingDesc(true); }}
            title="Click to edit"
          >
            {a.description}
            <Pencil size={11} className="pending-edit-icon" />
          </p>
        )
      )}
      <div className="pending-card-meta">
        <span className="badge badge-accent">{a.category}</span>
        <span className={`badge ${weightColors[a.cognitiveWeight] || ""}`}>
          {a.cognitiveWeight}/5
        </span>
        <span className="pending-card-duration">
          <Clock size={12} /> {a.durationMinutes}m
        </span>
        <span className="pending-card-date">
          <Calendar size={12} /> {a.suggestedDate}
        </span>
      </div>
      {a.conflictsWithExisting.length > 0 && (
        <p className="pending-card-conflict">
          {t.home.conflicts}: {a.conflictsWithExisting.join(", ")}
        </p>
      )}
      {overloadWarnings.length > 0 && (
        <div className="pending-overload-warning">
          <AlertTriangle size={13} />
          <div>
            {overloadWarnings.map((w, i) => (
              <p key={i}>{w}</p>
            ))}
          </div>
        </div>
      )}
      <div className="pending-card-actions">
        <button className="btn btn-primary btn-sm" onClick={onConfirm}>
          <Check size={14} /> {overloadWarnings.length > 0 ? "Add anyway" : t.home.confirmTask}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onReject}>
          <XCircle size={14} /> {t.home.rejectTask}
        </button>
      </div>
    </div>
  );
}

export function PendingEventCard({
  event,
  dailyLoad,
  onConfirm,
  onReject,
  onUpdate,
}: {
  event: CalendarEvent;
  dailyLoad: DailyLoad;
  onConfirm: () => void;
  onReject: () => void;
  onUpdate: (updates: Partial<CalendarEvent>) => void;
}) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState(event.title);

  const isForToday =
    event.startDate.split("T")[0] === new Date().toISOString().split("T")[0];
  const overloadWarnings = isForToday
    ? getOverloadWarnings(dailyLoad, 0, event.durationMinutes)
    : [];

  const startDate = new Date(event.startDate);
  const dateStr = startDate.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const timeStr = event.isAllDay
    ? "All day"
    : startDate.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      });

  return (
    <div className="pending-card pending-event-card">
      <div className="pending-card-header">
        <Calendar size={14} className="pending-event-icon" />
        {editingTitle ? (
          <input
            className="input pending-edit-input pending-edit-title"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onBlur={() => {
              if (editTitle.trim()) onUpdate({ title: editTitle.trim() });
              setEditingTitle(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (editTitle.trim()) onUpdate({ title: editTitle.trim() });
                setEditingTitle(false);
              }
              if (e.key === "Escape") setEditingTitle(false);
            }}
            autoFocus
          />
        ) : (
          <span
            className="pending-card-title pending-editable"
            onClick={() => {
              setEditTitle(event.title);
              setEditingTitle(true);
            }}
            title="Click to edit"
          >
            {event.title}
            <Pencil size={11} className="pending-edit-icon" />
          </span>
        )}
      </div>
      <div className="pending-card-meta">
        <span className="badge badge-accent">{event.category}</span>
        <span className="pending-card-date">
          <CalendarDays size={12} /> {dateStr}
        </span>
        <span className="pending-card-duration">
          <Clock size={12} /> {timeStr}
          {!event.isAllDay && ` · ${event.durationMinutes}m`}
        </span>
      </div>
      {event.notes && <p className="pending-card-desc">{event.notes}</p>}
      {overloadWarnings.length > 0 && (
        <div className="pending-overload-warning">
          <AlertTriangle size={13} />
          <div>
            {overloadWarnings.map((w, i) => (
              <p key={i}>{w}</p>
            ))}
          </div>
        </div>
      )}
      <div className="pending-card-actions">
        <button className="btn btn-primary btn-sm" onClick={onConfirm}>
          <Check size={14} /> {overloadWarnings.length > 0 ? "Add anyway" : "Add to calendar"}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onReject}>
          <XCircle size={14} /> Discard
        </button>
      </div>
    </div>
  );
}

/** Confirmation card for goals detected in home chat.
 *  The user must click "Create Goal" before the goal is persisted
 *  and plan generation begins. */
export function PendingGoalCard({
  goal,
  onConfirm,
  onReject,
  onUpdate,
}: {
  goal: Partial<Goal>;
  onConfirm: () => void;
  onReject: () => void;
  onUpdate: (updates: Partial<Goal>) => void;
}) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState(goal.title ?? "");
  const [editingDesc, setEditingDesc] = useState(false);
  const [editDesc, setEditDesc] = useState(goal.description ?? "");

  const goalTypeLabel =
    goal.goalType === "big"
      ? "Long-term Goal"
      : goal.goalType === "repeating"
        ? "Repeating Goal"
        : "Everyday Goal";

  const importanceLabel =
    goal.importance === "critical"
      ? "Critical"
      : goal.importance === "high"
        ? "High"
        : goal.importance === "medium"
          ? "Medium"
          : "Low";

  return (
    <div className="pending-card pending-goal-card">
      <div className="pending-card-header">
        <Target size={14} className="pending-goal-icon" />
        {editingTitle ? (
          <input
            className="input pending-edit-input pending-edit-title"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onBlur={() => {
              if (editTitle.trim()) onUpdate({ title: editTitle.trim() });
              setEditingTitle(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (editTitle.trim()) onUpdate({ title: editTitle.trim() });
                setEditingTitle(false);
              }
              if (e.key === "Escape") setEditingTitle(false);
            }}
            autoFocus
          />
        ) : (
          <span
            className="pending-card-title pending-editable"
            onClick={() => {
              setEditTitle(goal.title ?? "");
              setEditingTitle(true);
            }}
            title="Click to edit"
          >
            {goal.title}
            <Pencil size={11} className="pending-edit-icon" />
          </span>
        )}
      </div>
      {goal.description && (
        editingDesc ? (
          <textarea
            className="input pending-edit-input pending-edit-desc"
            value={editDesc}
            onChange={(e) => setEditDesc(e.target.value)}
            onBlur={() => {
              onUpdate({ description: editDesc.trim() });
              setEditingDesc(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onUpdate({ description: editDesc.trim() });
                setEditingDesc(false);
              }
              if (e.key === "Escape") setEditingDesc(false);
            }}
            rows={2}
            autoFocus
          />
        ) : (
          <p
            className="pending-card-desc pending-editable"
            onClick={() => {
              setEditDesc(goal.description ?? "");
              setEditingDesc(true);
            }}
            title="Click to edit"
          >
            {goal.description}
            <Pencil size={11} className="pending-edit-icon" />
          </p>
        )
      )}
      <div className="pending-card-meta">
        <span className="badge badge-accent">{goalTypeLabel}</span>
        <span className="badge">{importanceLabel} priority</span>
        {goal.targetDate && (
          <span className="pending-card-date">
            <CalendarDays size={12} />{" "}
            {new Date(goal.targetDate + "T12:00:00").toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </span>
        )}
        {goal.isHabit && (
          <span className="badge">Ongoing habit</span>
        )}
      </div>
      <div className="pending-card-actions">
        <button className="btn btn-primary btn-sm" onClick={onConfirm}>
          <Check size={14} /> Create Goal <ArrowRight size={12} />
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onReject}>
          <XCircle size={14} /> Discard
        </button>
      </div>
    </div>
  );
}
