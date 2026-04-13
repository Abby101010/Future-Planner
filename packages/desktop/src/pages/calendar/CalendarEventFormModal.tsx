import { X, Palmtree } from "lucide-react";
import type { DailyTask } from "@northstar/core";

const CATEGORY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "learning", label: "Learning" },
  { value: "building", label: "Building" },
  { value: "networking", label: "Networking" },
  { value: "reflection", label: "Reflection" },
  { value: "planning", label: "Planning" },
];

interface Props {
  editingTask: DailyTask | null;
  formTitle: string;
  formDate: string;
  formStartTime: string;
  formEndTime: string;
  formIsAllDay: boolean;
  formCategory: string;
  formIsVacation: boolean;
  formNotes: string;
  setFormTitle: (v: string) => void;
  setFormDate: (v: string) => void;
  setFormStartTime: (v: string) => void;
  setFormEndTime: (v: string) => void;
  setFormIsAllDay: (v: boolean) => void;
  setFormCategory: (v: string) => void;
  setFormIsVacation: (v: boolean) => void;
  setFormNotes: (v: string) => void;
  onClose: () => void;
  onSave: () => void;
}

export default function CalendarTaskFormModal({
  editingTask,
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
          <h3>{editingTask ? "Edit Task" : "New Task"}</h3>
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
              placeholder="Study, Gym, Vacation..."
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
                onChange={(e) => setFormCategory(e.target.value)}
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
              <span>All-day task</span>
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
            {editingTask ? "Save Changes" : "Add Task"}
          </button>
        </div>
      </div>
    </div>
  );
}
