import { AlertTriangle, Bell, Check, Pencil, Trash2, X, CheckSquare } from "lucide-react";
import { useState } from "react";
import type { Reminder } from "@northstar/core";
import { toLocalDatetimeInput } from "../../utils/dateFormat";

interface Props {
  reminders: Reminder[];
  onAcknowledge: (id: string) => void;
  onDelete?: (id: string) => void;
  onEdit?: (reminder: Reminder) => void;
  onBulkDelete?: (ids: string[]) => void;
  variant?: "today" | "overdue";
}

export default function ReminderList({
  reminders,
  onAcknowledge,
  onDelete,
  onEdit,
  onBulkDelete,
  variant = "today",
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editTime, setEditTime] = useState("");
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const beginEdit = (r: Reminder) => {
    setEditingId(r.id);
    setEditTitle(r.title);
    setEditTime(toLocalDatetimeInput(r.reminderTime));
  };

  const saveEdit = (r: Reminder) => {
    if (!onEdit) return;
    const newTime = new Date(editTime);
    onEdit({
      ...r,
      title: editTitle,
      reminderTime: newTime.toISOString(),
      date: editTime.split("T")[0], // local date from datetime-local input, not UTC
    });
    setEditingId(null);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runBulkDelete = () => {
    if (!onBulkDelete || selectedIds.size === 0) return;
    if (!window.confirm(`Delete ${selectedIds.size} reminder(s)?`)) return;
    onBulkDelete(Array.from(selectedIds));
    setSelectedIds(new Set());
    setSelectMode(false);
  };

  if (reminders.length === 0) return null;

  return (
    <section className={`reminders-section animate-slide-up${variant === "overdue" ? " reminders-section-overdue" : ""}`}>
      <div className="reminders-header">
        {variant === "overdue" ? <AlertTriangle size={14} /> : <Bell size={14} />}
        <span>{variant === "overdue" ? "Overdue" : "Reminders"}</span>
        <span className="reminders-count">{reminders.length}</span>
        {onBulkDelete && (
          <div className="reminders-header-actions">
            {selectMode ? (
              <>
                <button
                  className="btn btn-ghost btn-xs"
                  onClick={runBulkDelete}
                  disabled={selectedIds.size === 0}
                >
                  <Trash2 size={12} /> Delete ({selectedIds.size})
                </button>
                <button
                  className="btn btn-ghost btn-xs"
                  onClick={() => {
                    setSelectMode(false);
                    setSelectedIds(new Set());
                  }}
                >
                  <X size={12} />
                </button>
              </>
            ) : (
              <button
                className="btn btn-ghost btn-xs"
                onClick={() => setSelectMode(true)}
                title="Select multiple"
              >
                <CheckSquare size={12} />
              </button>
            )}
          </div>
        )}
      </div>
      {reminders.map((reminder) => {
        const isPast = new Date(reminder.reminderTime) <= new Date();
        const timeStr = new Date(reminder.reminderTime).toLocaleTimeString(
          undefined,
          { hour: "numeric", minute: "2-digit" },
        );
        const isEditing = editingId === reminder.id;
        const isSelected = selectedIds.has(reminder.id);
        return (
          <div
            key={reminder.id}
            className={`reminder-card ${isPast ? "reminder-card-active" : ""} ${isSelected ? "selected" : ""}`}
          >
            <div className="reminder-card-glow" />
            {selectMode && (
              <div
                className={`task-select-checkbox ${isSelected ? "checked" : ""}`}
                onClick={() => toggleSelect(reminder.id)}
              >
                {isSelected && <Check size={14} />}
              </div>
            )}
            <div className="reminder-card-content">
              {isEditing ? (
                <>
                  <input
                    className="input input-sm"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    placeholder="Title"
                  />
                  <input
                    className="input input-sm"
                    type="datetime-local"
                    value={editTime}
                    onChange={(e) => setEditTime(e.target.value)}
                  />
                </>
              ) : (
                <>
                  <div className="reminder-card-time">
                    <Bell size={12} />
                    <span>{timeStr}</span>
                    {reminder.repeat && (
                      <span className="reminder-repeat">{reminder.repeat}</span>
                    )}
                  </div>
                  <div className="reminder-card-title">{reminder.title}</div>
                  {variant === "overdue" && (
                    <span className="reminder-card-date">from {reminder.date}</span>
                  )}
                  {reminder.description && (
                    <div className="reminder-card-desc">{reminder.description}</div>
                  )}
                </>
              )}
            </div>
            <div className="reminder-card-actions">
              {isEditing ? (
                <>
                  <button
                    className="reminder-acknowledge-btn"
                    onClick={() => saveEdit(reminder)}
                    title="Save"
                  >
                    <Check size={14} />
                  </button>
                  <button
                    className="reminder-acknowledge-btn"
                    onClick={() => setEditingId(null)}
                    title="Cancel"
                  >
                    <X size={14} />
                  </button>
                </>
              ) : (
                <>
                  {onEdit && (
                    <button
                      className="reminder-acknowledge-btn"
                      onClick={() => beginEdit(reminder)}
                      title="Edit"
                    >
                      <Pencil size={13} />
                    </button>
                  )}
                  {onDelete && (
                    <button
                      className="reminder-acknowledge-btn reminder-delete-btn"
                      onClick={() => {
                        if (window.confirm("Delete this reminder?")) {
                          onDelete(reminder.id);
                        }
                      }}
                      title="Delete"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                  <button
                    className="reminder-acknowledge-btn"
                    onClick={() => onAcknowledge(reminder.id)}
                    title="Dismiss"
                  >
                    <Check size={14} />
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
}
