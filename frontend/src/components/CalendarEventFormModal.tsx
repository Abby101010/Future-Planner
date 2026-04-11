import { X, Palmtree } from "lucide-react";
import type { CalendarEvent } from "../types";

const CATEGORY_OPTIONS: Array<{ value: CalendarEvent["category"]; label: string }> = [
  { value: "work", label: "Work" },
  { value: "personal", label: "Personal" },
  { value: "health", label: "Health & Fitness" },
  { value: "social", label: "Social" },
  { value: "travel", label: "Travel" },
  { value: "focus", label: "Focus Time" },
  { value: "other", label: "Other" },
];

interface Props {
  editingEvent: CalendarEvent | null;
  formTitle: string;
  formDate: string;
  formStartTime: string;
  formEndTime: string;
  formIsAllDay: boolean;
  formCategory: CalendarEvent["category"];
  formIsVacation: boolean;
  formNotes: string;
  setFormTitle: (v: string) => void;
  setFormDate: (v: string) => void;
  setFormStartTime: (v: string) => void;
  setFormEndTime: (v: string) => void;
  setFormIsAllDay: (v: boolean) => void;
  setFormCategory: (v: CalendarEvent["category"]) => void;
  setFormIsVacation: (v: boolean) => void;
  setFormNotes: (v: string) => void;
  onClose: () => void;
  onSave: () => void;
}

export default function CalendarEventFormModal({
  editingEvent,
  formTitle,
  formDate,
  formStartTime,
  formEndTime,
  formIsAllDay,
  formCategory,
  formIsVacation,
  formNotes,
  setFormTitle,
  setFormDate,
  setFormStartTime,
  setFormEndTime,
  setFormIsAllDay,
  setFormCategory,
  setFormIsVacation,
  setFormNotes,
  onClose,
  onSave,
}: Props) {
  return (
    <div className="cal-modal-overlay" onClick={onClose}>
      <div
        className="cal-modal card animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cal-modal-header">
          <h3>{editingEvent ? "Edit Event" : "New Event"}</h3>
          <button className="btn btn-ghost btn-xs" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="cal-modal-body">
          <div className="cal-form-group">
            <label>Title</label>
            <input
              type="text"
              className="input"
              placeholder="Meeting, Gym, Vacation..."
              value={formTitle}
              onChange={(e) => setFormTitle(e.target.value)}
              autoFocus
            />
          </div>

          <div className="cal-form-row">
            <div className="cal-form-group">
              <label>Date</label>
              <input
                type="date"
                className="input"
                value={formDate}
                onChange={(e) => setFormDate(e.target.value)}
              />
            </div>
            <div className="cal-form-group">
              <label>Category</label>
              <select
                className="input"
                value={formCategory}
                onChange={(e) =>
                  setFormCategory(e.target.value as CalendarEvent["category"])
                }
              >
                {CATEGORY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="cal-form-toggles">
            <label className="cal-form-check">
              <input
                type="checkbox"
                checked={formIsAllDay}
                onChange={(e) => setFormIsAllDay(e.target.checked)}
              />
              <span>All-day event</span>
            </label>
            <label className="cal-form-check">
              <input
                type="checkbox"
                checked={formIsVacation}
                onChange={(e) => setFormIsVacation(e.target.checked)}
              />
              <Palmtree size={14} />
              <span>Vacation / Time off</span>
            </label>
          </div>

          {!formIsAllDay && (
            <div className="cal-form-row">
              <div className="cal-form-group">
                <label>Start time</label>
                <input
                  type="time"
                  className="input"
                  value={formStartTime}
                  onChange={(e) => setFormStartTime(e.target.value)}
                />
              </div>
              <div className="cal-form-group">
                <label>End time</label>
                <input
                  type="time"
                  className="input"
                  value={formEndTime}
                  onChange={(e) => setFormEndTime(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="cal-form-group">
            <label>Notes (optional)</label>
            <textarea
              className="input"
              placeholder="Any details..."
              value={formNotes}
              onChange={(e) => setFormNotes(e.target.value)}
              rows={2}
            />
          </div>
        </div>

        <div className="cal-modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={onSave}
            disabled={!formTitle.trim() || !formDate}
          >
            {editingEvent ? "Save Changes" : "Add Event"}
          </button>
        </div>
      </div>
    </div>
  );
}
