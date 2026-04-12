import { Bell, Check } from "lucide-react";
import type { Reminder } from "@northstar/core";

interface Props {
  reminders: Reminder[];
  onAcknowledge: (id: string) => void;
}

export default function ReminderList({ reminders, onAcknowledge }: Props) {
  return (
    <section className="reminders-section animate-slide-up">
      <div className="reminders-header">
        <Bell size={14} />
        <span>Reminders</span>
        <span className="reminders-count">{reminders.length}</span>
      </div>
      {reminders.length === 0 && (
        <div className="reminders-empty">
          No reminders for today. Ask the assistant to set one — e.g. "remind me to call the dentist at 3pm".
        </div>
      )}
      {reminders.map((reminder) => {
        const isPast = new Date(reminder.reminderTime) <= new Date();
        const timeStr = new Date(reminder.reminderTime).toLocaleTimeString(
          undefined,
          { hour: "numeric", minute: "2-digit" },
        );
        return (
          <div
            key={reminder.id}
            className={`reminder-card ${isPast ? "reminder-card-active" : ""}`}
          >
            <div className="reminder-card-glow" />
            <div className="reminder-card-content">
              <div className="reminder-card-time">
                <Bell size={12} />
                <span>{timeStr}</span>
                {reminder.repeat && (
                  <span className="reminder-repeat">{reminder.repeat}</span>
                )}
              </div>
              <div className="reminder-card-title">{reminder.title}</div>
              {reminder.description && (
                <div className="reminder-card-desc">{reminder.description}</div>
              )}
            </div>
            <button
              className="reminder-acknowledge-btn"
              onClick={() => onAcknowledge(reminder.id)}
              title="Dismiss"
            >
              <Check size={14} />
            </button>
          </div>
        );
      })}
    </section>
  );
}
