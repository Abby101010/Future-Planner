/* AddReminderLine — minimalist single-line reminder composer.
 *
 * Type a title + optionally pick a date (defaults to today) and a
 * time (defaults to 09:00). Hit Enter or click + to submit. Sends
 * `command:upsert-reminder` with the documented flat shape:
 *   { title, date, reminderTime? }
 * Server (backend/src/routes/commands/calendar.ts) auto-generates
 * `id`, fills `reminderTime` to `<date>T09:00:00` when omitted, and
 * sets sensible defaults for the other Reminder fields.
 *
 * Replaces the bare "Add" button that blindly inserted a placeholder
 * "New reminder" with no edit affordance — that left users stuck with
 * a useless empty row.
 */

import { useState } from "react";
import { useCommand } from "../../hooks/useCommand";
import Button from "../../components/primitives/Button";
import Icon from "../../components/primitives/Icon";

export interface AddReminderLineProps {
  onAdded: () => void;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function AddReminderLine({ onAdded }: AddReminderLineProps) {
  const { run, running } = useCommand();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(todayISO());
  const [time, setTime] = useState("09:00");
  const [focus, setFocus] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!title.trim()) return;
    setError(null);
    try {
      await run("command:upsert-reminder", {
        title: title.trim(),
        date,
        reminderTime: `${date}T${time}:00`,
      });
      setTitle("");
      // Date / time intentionally NOT reset — keeps the user in their
      // current "context" if they're adding a batch of reminders for
      // the same day/time slot.
      onAdded();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <section data-testid="add-reminder-line">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 2px 10px",
          borderBottom: `1px solid ${focus ? "var(--navy-mid)" : "var(--border-soft)"}`,
          transition: "border-color .15s ease",
        }}
      >
        <Icon
          name="plus"
          size={14}
          style={{
            color: focus ? "var(--navy-mid)" : "var(--fg-faint)",
            flexShrink: 0,
            transition: "color .15s",
          }}
        />
        <input
          data-testid="add-reminder-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          placeholder="Add a reminder…"
          onKeyDown={(e) => {
            if (e.key === "Enter" && title.trim()) void submit();
          }}
          data-api="POST /commands/upsert-reminder"
          style={{
            flex: 1,
            minWidth: 0,
            padding: "4px 0",
            border: 0,
            outline: "none",
            fontSize: "var(--t-sm)",
            background: "transparent",
            color: "var(--fg)",
          }}
        />
        <input
          data-testid="add-reminder-date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
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
          data-testid="add-reminder-time"
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
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
        <Button
          size="xs"
          tone="ghost"
          icon="plus"
          onClick={() => void submit()}
          data-api="POST /commands/upsert-reminder"
          data-testid="add-reminder-submit"
          disabled={running || !title.trim()}
        >
          Add
        </Button>
      </div>
      {error && (
        <div
          data-testid="add-reminder-error"
          style={{
            fontSize: 10,
            color: "var(--danger)",
            fontFamily: "var(--font-mono)",
            marginTop: 4,
          }}
        >
          {error}
        </div>
      )}
    </section>
  );
}
