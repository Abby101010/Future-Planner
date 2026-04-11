import { Plus, Clock, Palmtree, Trash2, Monitor } from "lucide-react";
import type { CalendarEvent } from "@northstar/core";

const CATEGORY_COLORS: Record<string, string> = {
  work: "#ef4444",
  personal: "#8b5cf6",
  health: "#22c55e",
  social: "#f59e0b",
  travel: "#06b6d4",
  focus: "#3b82f6",
  other: "#6b7280",
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

interface Props {
  selectedDate: string;
  selectedDateEvents: CalendarEvent[];
  onAddEvent: (date: string) => void;
  onEditEvent: (event: CalendarEvent) => void;
  onDeleteEvent: (id: string) => void;
}

export default function CalendarDayDetail({
  selectedDate,
  selectedDateEvents,
  onAddEvent,
  onEditEvent,
  onDeleteEvent,
}: Props) {
  return (
    <div className="cal-day-detail card animate-slide-up">
      <div className="cal-day-detail-header">
        <h3>
          {new Date(selectedDate + "T12:00:00").toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric",
          })}
        </h3>
        <div className="cal-day-detail-actions">
          <button
            className="btn btn-primary btn-sm"
            onClick={() => onAddEvent(selectedDate)}
          >
            <Plus size={14} />
            Add Event
          </button>
        </div>
      </div>

      {selectedDateEvents.length === 0 ? (
        <p className="cal-day-empty">
          No events. Double-click a date or press Add to create one.
        </p>
      ) : (
        <div className="cal-day-events">
          {selectedDateEvents
            .sort((a, b) => a.startDate.localeCompare(b.startDate))
            .map((event) => (
              <div
                key={event.id}
                className={`cal-event ${event.isVacation ? "cal-event-vacation" : ""}`}
                style={{ borderLeftColor: CATEGORY_COLORS[event.category] }}
              >
                <div className="cal-event-main">
                  <div className="cal-event-title">{event.title}</div>
                  <div className="cal-event-time">
                    {event.isAllDay ? (
                      "All day"
                    ) : (
                      <>
                        <Clock size={12} />
                        {formatTime(event.startDate)} – {formatTime(event.endDate)}
                        <span className="cal-event-duration">
                          ({event.durationMinutes}m)
                        </span>
                      </>
                    )}
                  </div>
                  <div className="cal-event-meta">
                    <span
                      className="cal-event-category"
                      style={{ backgroundColor: CATEGORY_COLORS[event.category] + "22", color: CATEGORY_COLORS[event.category] }}
                    >
                      {event.category}
                    </span>
                    {event.isVacation && (
                      <span className="cal-event-vac-badge">
                        <Palmtree size={11} />
                        Vacation
                      </span>
                    )}
                    {event.source !== "manual" && (
                      <span className="cal-event-source">
                        <Monitor size={11} />
                        {event.sourceCalendar || event.source}
                      </span>
                    )}
                  </div>
                  {event.notes && (
                    <p className="cal-event-notes">{event.notes}</p>
                  )}
                </div>
                <div className="cal-event-actions">
                  <button
                    className="btn btn-ghost btn-xs"
                    onClick={() => onEditEvent(event)}
                    title="Edit"
                  >
                    ✏️
                  </button>
                  <button
                    className="btn btn-ghost btn-xs"
                    onClick={() => onDeleteEvent(event.id)}
                    title="Delete"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
