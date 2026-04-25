/* ReminderRow — one reminder in the Tasks page reminders section.
 * Contract: POST /commands/acknowledge-reminder, /commands/delete-reminder,
 * /commands/upsert-reminder. */

import Icon from "../../components/primitives/Icon";
import type { UIReminder } from "./tasksTypes";

export interface ReminderRowProps {
  reminder: UIReminder;
  onAck: (id: string) => void;
  onDelete: (id: string) => void;
}

export default function ReminderRow({ reminder: r, onAck, onDelete }: ReminderRowProps) {
  return (
    <div
      data-testid={`reminder-${r.id}`}
      className="ns-row"
      style={{
        display: "grid",
        gridTemplateColumns: "22px 1fr auto",
        gap: 14,
        alignItems: "center",
        padding: "14px 0",
        borderBottom: "1px solid var(--border-soft)",
      }}
    >
      <button
        onClick={() => onAck(r.id)}
        data-api="POST /commands/acknowledge-reminder"
        data-testid={`reminder-ack-${r.id}`}
        title="Acknowledge"
        style={{
          width: 20,
          height: 20,
          borderRadius: "50%",
          border: "1.5px dashed var(--border-strong)",
          background: "transparent",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
        }}
      />
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, minWidth: 0 }}>
        <span
          style={{
            fontSize: "var(--t-md)",
            color: "var(--user-color)",
            fontWeight: 500,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
            flex: "0 1 auto",
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
      <div className="ns-row-trail" style={{ display: "flex", gap: 2 }}>
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
      </div>
    </div>
  );
}
