/* ReminderRow — one reminder in the Tasks page reminders section.
 * Contract: POST /commands/acknowledge-reminder, /commands/delete-reminder,
 * /commands/upsert-reminder.
 *
 * Edit mode:
 *   The pencil button flips the row into an inline editor (title + date
 *   + time + repeat). Save calls `onEdit({id, ...})` which dispatches
 *   `command:upsert-reminder` server-side. The BE upserts on `id`, so
 *   passing the existing id flips create→update at the SQL layer. There
 *   is intentionally NO separate "update-reminder" command — keeping
 *   one write path for both create and edit prevents the two from
 *   drifting (e.g. one accepting `repeat` and the other not). When you
 *   add a new editable field, add it to AddReminderLine, the inline
 *   editor here, and the BE upsert handler — that's the contract. */

import { useState } from "react";
import Icon from "../../components/primitives/Icon";
import type { UIReminder, UIReminderRepeat } from "./tasksTypes";

export interface ReminderRowProps {
  reminder: UIReminder;
  onAck: (id: string) => void;
  onDelete: (id: string) => void;
  /** Optional. When provided, the pencil button + inline editor render
   *  and Save dispatches an upsert with the merged patch. */
  onEdit?: (patch: { id: string } & Partial<UIReminder>) => void;
}

const REPEAT_OPTIONS: Array<{ value: "none" | "daily" | "weekly" | "monthly"; label: string }> = [
  { value: "none", label: "Once" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Extract HH:MM from an ISO datetime ("2026-04-27T09:00:00" → "09:00").
 *  Returns "09:00" when the input is missing or unparseable so the time
 *  picker has a sensible default. */
function timeFromIso(iso: string | undefined): string {
  if (!iso) return "09:00";
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  return m ? `${m[1]}:${m[2]}` : "09:00";
}

export default function ReminderRow({ reminder: r, onAck, onDelete, onEdit }: ReminderRowProps) {
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(r.title);
  const [draftDate, setDraftDate] = useState(r.date ?? todayISO());
  const [draftTime, setDraftTime] = useState(timeFromIso(r.reminderTime));
  const [draftRepeat, setDraftRepeat] = useState<"none" | "daily" | "weekly" | "monthly">(
    (r.repeat ?? "none") as "none" | "daily" | "weekly" | "monthly",
  );

  function startEdit() {
    setDraftTitle(r.title);
    setDraftDate(r.date ?? todayISO());
    setDraftTime(timeFromIso(r.reminderTime));
    setDraftRepeat((r.repeat ?? "none") as "none" | "daily" | "weekly" | "monthly");
    setEditing(true);
  }

  function save() {
    if (!onEdit) return;
    const repeatValue: UIReminderRepeat = draftRepeat === "none" ? null : draftRepeat;
    onEdit({
      id: r.id,
      title: draftTitle.trim() || r.title,
      date: draftDate,
      reminderTime: `${draftDate}T${draftTime}:00`,
      repeat: repeatValue,
    });
    setEditing(false);
  }

  return (
    <div
      data-testid={`reminder-${r.id}`}
      className="ns-row"
      style={{
        display: "grid",
        gridTemplateColumns: "22px 1fr auto",
        gap: 14,
        // start-align so when the title wraps to multiple lines the
        // ack/edit/delete controls stay pinned to the top of the row
        // instead of vertically centering against tall content.
        alignItems: "start",
        padding: "14px 0",
        borderBottom: "1px solid var(--border-soft)",
      }}
    >
      <button
        onClick={() => onAck(r.id)}
        data-api="POST /commands/acknowledge-reminder"
        data-testid={`reminder-ack-${r.id}`}
        title="Acknowledge"
        disabled={editing}
        style={{
          width: 20,
          height: 20,
          borderRadius: "50%",
          border: "1.5px dashed var(--border-strong)",
          background: "transparent",
          cursor: editing ? "default" : "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
          opacity: editing ? 0.4 : 1,
        }}
      />
      {!editing && (
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 12,
            minWidth: 0,
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              fontSize: "var(--t-md)",
              color: "var(--user-color)",
              fontWeight: 500,
              // Wrap long titles to multiple lines instead of clipping
              // with an ellipsis. wordBreak handles the case where a
              // single token (URL, long word) is wider than the row.
              wordBreak: "break-word",
              minWidth: 0,
              flex: "1 1 auto",
            }}
          >
            {r.title}
          </span>
          {r.overdue && (
            <span
              data-testid={`reminder-overdue-${r.id}`}
              style={{
                fontSize: "var(--t-2xs)",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--danger)",
                border: "1px solid var(--danger)",
                borderRadius: 4,
                padding: "1px 6px",
                flexShrink: 0,
                fontWeight: 600,
              }}
            >
              Overdue
            </span>
          )}
          {r.repeat && (
            <span
              data-testid={`reminder-repeat-${r.id}`}
              title={`Repeats ${r.repeat}`}
              style={{
                fontSize: "var(--t-2xs)",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--fg-mute)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                padding: "1px 6px",
                flexShrink: 0,
                fontWeight: 500,
              }}
            >
              {r.repeat}
            </span>
          )}
          {r.date && (
            <span
              className="tnum"
              style={{
                color: "var(--fg-faint)",
                fontSize: "var(--t-xs)",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {r.date}
            </span>
          )}
        </div>
      )}
      {editing && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <input
            data-testid={`reminder-edit-title-${r.id}`}
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && draftTitle.trim()) save();
              if (e.key === "Escape") setEditing(false);
            }}
            autoFocus
            style={{
              flex: 1,
              minWidth: 0,
              padding: "4px 6px",
              fontSize: "var(--t-sm)",
              border: "1px solid var(--border)",
              borderRadius: 3,
              background: "var(--bg)",
              color: "var(--fg)",
            }}
          />
          <input
            data-testid={`reminder-edit-date-${r.id}`}
            type="date"
            value={draftDate}
            onChange={(e) => setDraftDate(e.target.value)}
            title="Date"
            style={{
              border: "1px solid var(--border)",
              borderRadius: 3,
              fontSize: 11,
              padding: "2px 4px",
              background: "var(--bg)",
              color: "var(--fg-mute)",
              fontFamily: "var(--font-mono)",
            }}
          />
          <input
            data-testid={`reminder-edit-time-${r.id}`}
            type="time"
            value={draftTime}
            onChange={(e) => setDraftTime(e.target.value)}
            title="Time"
            style={{
              border: "1px solid var(--border)",
              borderRadius: 3,
              fontSize: 11,
              padding: "2px 4px",
              background: "var(--bg)",
              color: "var(--fg-mute)",
              fontFamily: "var(--font-mono)",
              width: 80,
            }}
          />
          <select
            data-testid={`reminder-edit-repeat-${r.id}`}
            value={draftRepeat}
            onChange={(e) =>
              setDraftRepeat(e.target.value as "none" | "daily" | "weekly" | "monthly")
            }
            title="Repeat"
            style={{
              border: "1px solid var(--border)",
              borderRadius: 3,
              fontSize: 11,
              padding: "2px 4px",
              background: "var(--bg)",
              color: "var(--fg-mute)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {REPEAT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="ns-row-trail" style={{ display: "flex", gap: 2 }}>
        {editing && (
          <>
            <button
              onClick={save}
              data-testid={`reminder-edit-save-${r.id}`}
              title="Save"
              disabled={!draftTitle.trim()}
              style={{
                padding: "3px 10px",
                border: "1px solid var(--accent)",
                background: "var(--accent)",
                color: "var(--white)",
                borderRadius: 4,
                fontSize: 11,
                cursor: draftTitle.trim() ? "pointer" : "not-allowed",
                fontWeight: 600,
                opacity: draftTitle.trim() ? 1 : 0.5,
              }}
            >
              Save
            </button>
            <button
              onClick={() => setEditing(false)}
              data-testid={`reminder-edit-cancel-${r.id}`}
              title="Cancel"
              style={{
                padding: "3px 10px",
                border: "1px solid var(--border)",
                background: "transparent",
                color: "var(--fg-mute)",
                borderRadius: 4,
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </>
        )}
        {!editing && onEdit && (
          <button
            onClick={startEdit}
            data-testid={`reminder-edit-${r.id}`}
            title="Edit"
            style={{
              width: 26,
              height: 26,
              border: 0,
              background: "transparent",
              color: "var(--fg-faint)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 4,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--bg-soft)";
              e.currentTarget.style.color = "var(--fg)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "var(--fg-faint)";
            }}
          >
            <Icon name="edit" size={13} />
          </button>
        )}
        {!editing && (
          <button
            onClick={() => onDelete(r.id)}
            title="Delete"
            data-api="POST /commands/delete-reminder"
            data-testid={`reminder-delete-${r.id}`}
            style={{
              width: 26,
              height: 26,
              border: 0,
              background: "transparent",
              color: "var(--fg-faint)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 4,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--bg-soft)";
              e.currentTarget.style.color = "var(--danger)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "var(--fg-faint)";
            }}
          >
            <Icon name="trash" size={13} />
          </button>
        )}
      </div>
    </div>
  );
}
