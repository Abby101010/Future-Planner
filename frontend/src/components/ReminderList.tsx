import { Bell, Check } from "lucide-react";
import type { Reminder } from "../types";

interface Props {
  reminders: Reminder[];
  onAcknowledge: (id: string) => void;
}

export default function ReminderList({ reminders, onAcknowledge }: Props) {
  if (reminders.length === 0) return null;
  return (
    <section className="reminders-section animate-slide-up">
      <div className="reminders-header">
        <Bell size={14} />
        <span>Reminders</span>
      </div>
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
