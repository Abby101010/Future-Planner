/* ──────────────────────────────────────────────────────────
   NorthStar — In-App Calendar Page
   
   • Monthly calendar view with events
   • Create / edit / delete events
   • Mark vacation days
   • Optional device calendar sync (macOS Calendar.app etc.)
   ────────────────────────────────────────────────────────── */

import { useState, useCallback, useMemo, useEffect } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  X,
  Calendar,
  Clock,
  Palmtree,
  Trash2,
  Download,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Settings2,
  Monitor,
  RefreshCw,
} from "lucide-react";
import useStore from "../store/useStore";
import { listDeviceCalendars, importDeviceCalendarEvents } from "../services/ai";
import type { CalendarEvent, DeviceIntegrations } from "../types";
import "./CalendarPage.css";

// ── Helpers ─────────────────────────────────────────────

function getDaysInMonth(year: number, month: number): Date[] {
  const days: Date[] = [];
  const d = new Date(year, month, 1);
  while (d.getMonth() === month) {
    days.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

function toDateStr(d: Date): string {
  return d.toISOString().split("T")[0];
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

const CATEGORY_COLORS: Record<string, string> = {
  work: "#ef4444",
  personal: "#8b5cf6",
  health: "#22c55e",
  social: "#f59e0b",
  travel: "#06b6d4",
  focus: "#3b82f6",
  other: "#6b7280",
};

const CATEGORY_OPTIONS: Array<{ value: CalendarEvent["category"]; label: string }> = [
  { value: "work", label: "Work" },
  { value: "personal", label: "Personal" },
  { value: "health", label: "Health & Fitness" },
  { value: "social", label: "Social" },
  { value: "travel", label: "Travel" },
  { value: "focus", label: "Focus Time" },
  { value: "other", label: "Other" },
];

// ── Main Component ──────────────────────────────────────

export default function CalendarPage() {
  const {
    calendarEvents,
    addCalendarEvent,
    updateCalendarEvent,
    removeCalendarEvent,
    setCalendarEvents,
    deviceIntegrations,
    updateIntegration,
    setDeviceIntegrations,
  } = useStore();

  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showEventForm, setShowEventForm] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [showIntegrations, setShowIntegrations] = useState(false);

  // Event form state
  const [formTitle, setFormTitle] = useState("");
  const [formDate, setFormDate] = useState("");
  const [formStartTime, setFormStartTime] = useState("09:00");
  const [formEndTime, setFormEndTime] = useState("10:00");
  const [formIsAllDay, setFormIsAllDay] = useState(false);
  const [formCategory, setFormCategory] = useState<CalendarEvent["category"]>("personal");
  const [formIsVacation, setFormIsVacation] = useState(false);
  const [formNotes, setFormNotes] = useState("");

  // Device integration state
  const [availableDeviceCalendars, setAvailableDeviceCalendars] = useState<string[]>([]);
  const [loadingDeviceCals, setLoadingDeviceCals] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");

  // ── Calendar grid ─────────────────────────────────────

  const daysInMonth = useMemo(
    () => getDaysInMonth(viewYear, viewMonth),
    [viewYear, viewMonth]
  );

  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay();
  const monthLabel = new Date(viewYear, viewMonth).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  const prevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear(viewYear - 1);
    } else {
      setViewMonth(viewMonth - 1);
    }
  };

  const nextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear(viewYear + 1);
    } else {
      setViewMonth(viewMonth + 1);
    }
  };

  const goToToday = () => {
    setViewYear(today.getFullYear());
    setViewMonth(today.getMonth());
  };

  // Get events for a specific date
  const getEventsForDate = useCallback(
    (dateStr: string) => {
      return calendarEvents.filter((e) => {
        const eventDate = e.startDate.split("T")[0];
        return eventDate === dateStr;
      });
    },
    [calendarEvents]
  );

  // ── Event CRUD ────────────────────────────────────────

  const openNewEvent = (dateStr?: string) => {
    setEditingEvent(null);
    setFormTitle("");
    setFormDate(dateStr || toDateStr(today));
    setFormStartTime("09:00");
    setFormEndTime("10:00");
    setFormIsAllDay(false);
    setFormCategory("personal");
    setFormIsVacation(false);
    setFormNotes("");
    setShowEventForm(true);
  };

  const openEditEvent = (event: CalendarEvent) => {
    setEditingEvent(event);
    setFormTitle(event.title);
    setFormDate(event.startDate.split("T")[0]);
    if (!event.isAllDay) {
      const start = new Date(event.startDate);
      const end = new Date(event.endDate);
      setFormStartTime(
        `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`
      );
      setFormEndTime(
        `${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`
      );
    }
    setFormIsAllDay(event.isAllDay);
    setFormCategory(event.category);
    setFormIsVacation(event.isVacation);
    setFormNotes(event.notes || "");
    setShowEventForm(true);
  };

  const handleSaveEvent = () => {
    if (!formTitle.trim() || !formDate) return;

    const startDate = formIsAllDay
      ? `${formDate}T00:00:00`
      : `${formDate}T${formStartTime}:00`;
    const endDate = formIsAllDay
      ? `${formDate}T23:59:59`
      : `${formDate}T${formEndTime}:00`;

    const startMs = new Date(startDate).getTime();
    const endMs = new Date(endDate).getTime();
    const durationMinutes = formIsAllDay
      ? 960
      : Math.max(1, Math.round((endMs - startMs) / 60000));

    if (editingEvent) {
      updateCalendarEvent(editingEvent.id, {
        title: formTitle.trim(),
        startDate,
        endDate,
        isAllDay: formIsAllDay,
        durationMinutes,
        category: formCategory,
        isVacation: formIsVacation,
        notes: formNotes.trim() || undefined,
      });
    } else {
      const newEvent: CalendarEvent = {
        id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        title: formTitle.trim(),
        startDate,
        endDate,
        isAllDay: formIsAllDay,
        durationMinutes,
        category: formCategory,
        isVacation: formIsVacation,
        source: "manual",
        notes: formNotes.trim() || undefined,
      };
      addCalendarEvent(newEvent);
    }

    setShowEventForm(false);
    setEditingEvent(null);
  };

  const handleDeleteEvent = (id: string) => {
    removeCalendarEvent(id);
    if (editingEvent?.id === id) {
      setShowEventForm(false);
      setEditingEvent(null);
    }
  };

  // ── Device Integration ────────────────────────────────

  const handleListDeviceCalendars = useCallback(async () => {
    setLoadingDeviceCals(true);
    try {
      const result = await listDeviceCalendars();
      if (result.ok) {
        setAvailableDeviceCalendars(result.calendars);
      }
    } catch {
      // ignore
    } finally {
      setLoadingDeviceCals(false);
    }
  }, []);

  const handleToggleDeviceCalendar = (calName: string) => {
    const current = deviceIntegrations.calendar.selectedCalendars;
    const updated = current.includes(calName)
      ? current.filter((c) => c !== calName)
      : [...current, calName];
    updateIntegration("calendar", { selectedCalendars: updated });
  };

  const handleEnableDeviceCalendar = (enabled: boolean) => {
    updateIntegration("calendar", { enabled });
    if (enabled && availableDeviceCalendars.length === 0) {
      handleListDeviceCalendars();
    }
  };

  const handleSyncNow = useCallback(async () => {
    if (!deviceIntegrations.calendar.enabled) return;
    setSyncing(true);
    setSyncMessage("");
    try {
      const startDate = toDateStr(new Date());
      const end = new Date();
      end.setDate(end.getDate() + 90);
      const endDate = toDateStr(end);

      const result = await importDeviceCalendarEvents(
        startDate,
        endDate,
        deviceIntegrations.calendar.selectedCalendars
      );
      if (result.ok && result.events.length > 0) {
        // Convert device events to CalendarEvent format and merge
        const imported: CalendarEvent[] = result.events.map((de) => ({
          id: `dev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          title: (de.title as string) || "Untitled",
          startDate: (de.startDate as string) || "",
          endDate: (de.endDate as string) || "",
          isAllDay: (de.isAllDay as boolean) || false,
          durationMinutes: (de.durationMinutes as number) || 60,
          category: "other" as const,
          isVacation: (de.isAllDay as boolean) &&
            ["vacation", "holiday", "pto", "off", "leave", "trip", "travel"]
              .some((kw) => ((de.title as string) || "").toLowerCase().includes(kw)),
          source: "device-calendar" as const,
          sourceCalendar: (de.calendar as string) || "",
        }));

        // Remove old device-imported events and add fresh ones
        const manualEvents = calendarEvents.filter((e) => e.source !== "device-calendar");
        setCalendarEvents([...manualEvents, ...imported]);
        updateIntegration("calendar", { lastSynced: new Date().toISOString() });
        setSyncMessage(`Imported ${imported.length} events`);
      } else {
        setSyncMessage("No events found to import");
      }
    } catch {
      setSyncMessage("Sync failed — check calendar permissions");
    } finally {
      setSyncing(false);
    }
  }, [deviceIntegrations, calendarEvents, setCalendarEvents, updateIntegration]);

  // ── Render ────────────────────────────────────────────

  const selectedDateEvents = selectedDate ? getEventsForDate(selectedDate) : [];
  const todayStr = toDateStr(today);

  return (
    <div className="calendar-page">
      <div className="calendar-page-scroll">
        {/* Header */}
        <header className="cal-header animate-fade-in">
          <div className="cal-header-left">
            <Calendar size={24} className="cal-header-icon" />
            <div>
              <h2>Calendar</h2>
              <p className="cal-subtitle">
                {calendarEvents.length} event{calendarEvents.length !== 1 ? "s" : ""} · 
                {calendarEvents.filter((e) => e.isVacation).length} vacation day{calendarEvents.filter((e) => e.isVacation).length !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
          <div className="cal-header-actions">
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setShowIntegrations(!showIntegrations)}
            >
              <Monitor size={14} />
              Device Sync
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => openNewEvent()}>
              <Plus size={14} />
              Add Event
            </button>
          </div>
        </header>

        {/* Device Integrations Panel */}
        {showIntegrations && (
          <div className="cal-integrations card animate-slide-up">
            <div className="cal-int-header">
              <Settings2 size={18} />
              <h3>Device Calendar Sync</h3>
              <span className="cal-int-badge">Optional</span>
            </div>
            <p className="cal-int-desc">
              Optionally import events from your device's calendar apps.
              Choose which calendars the AI should pay attention to.
              Your data stays on this device.
            </p>

            <div className="cal-int-toggle">
              <label className="toggle-row-inline">
                <span>Enable macOS Calendar sync</span>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={deviceIntegrations.calendar.enabled}
                    onChange={(e) => handleEnableDeviceCalendar(e.target.checked)}
                  />
                  <span className="toggle-slider" />
                </label>
              </label>
            </div>

            {deviceIntegrations.calendar.enabled && (
              <div className="cal-int-calendars animate-fade-in">
                <div className="cal-int-calendars-header">
                  <strong>Select calendars to import:</strong>
                  {loadingDeviceCals ? (
                    <Loader2 size={14} className="spin" />
                  ) : (
                    <button
                      className="btn btn-ghost btn-xs"
                      onClick={handleListDeviceCalendars}
                    >
                      <RefreshCw size={12} />
                      Refresh
                    </button>
                  )}
                </div>

                {availableDeviceCalendars.length === 0 ? (
                  <p className="cal-int-empty">
                    {loadingDeviceCals
                      ? "Loading calendars..."
                      : "No calendars found. Click Refresh to scan."}
                  </p>
                ) : (
                  <div className="cal-int-list">
                    {availableDeviceCalendars.map((name) => (
                      <label key={name} className="cal-int-item">
                        <input
                          type="checkbox"
                          checked={deviceIntegrations.calendar.selectedCalendars.includes(name)}
                          onChange={() => handleToggleDeviceCalendar(name)}
                        />
                        <span>{name}</span>
                      </label>
                    ))}
                  </div>
                )}

                <div className="cal-int-sync-row">
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={handleSyncNow}
                    disabled={
                      syncing ||
                      deviceIntegrations.calendar.selectedCalendars.length === 0
                    }
                  >
                    {syncing ? (
                      <>
                        <Loader2 size={14} className="spin" />
                        Syncing...
                      </>
                    ) : (
                      <>
                        <Download size={14} />
                        Sync Now
                      </>
                    )}
                  </button>
                  {deviceIntegrations.calendar.lastSynced && (
                    <span className="cal-int-last-sync">
                      Last synced: {new Date(deviceIntegrations.calendar.lastSynced).toLocaleString()}
                    </span>
                  )}
                  {syncMessage && (
                    <span className="cal-int-sync-msg">{syncMessage}</span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Calendar Grid */}
        <div className="cal-grid-container card animate-fade-in">
          <div className="cal-nav">
            <button className="btn btn-ghost btn-sm" onClick={prevMonth}>
              <ChevronLeft size={18} />
            </button>
            <h3 className="cal-month-label">{monthLabel}</h3>
            <button className="btn btn-ghost btn-sm" onClick={nextMonth}>
              <ChevronRight size={18} />
            </button>
            <button className="btn btn-ghost btn-xs cal-today-btn" onClick={goToToday}>
              Today
            </button>
          </div>

          <div className="cal-weekdays">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d} className="cal-weekday">
                {d}
              </div>
            ))}
          </div>

          <div className="cal-grid">
            {/* Blank cells before first day */}
            {Array.from({ length: firstDayOfWeek }).map((_, i) => (
              <div key={`blank-${i}`} className="cal-cell cal-cell-blank" />
            ))}

            {/* Day cells */}
            {daysInMonth.map((date) => {
              const dateStr = toDateStr(date);
              const dayEvents = getEventsForDate(dateStr);
              const isToday = dateStr === todayStr;
              const isSelected = dateStr === selectedDate;
              const hasVacation = dayEvents.some((e) => e.isVacation);
              const isWeekend = date.getDay() === 0 || date.getDay() === 6;

              return (
                <button
                  key={dateStr}
                  className={[
                    "cal-cell",
                    isToday && "cal-cell-today",
                    isSelected && "cal-cell-selected",
                    hasVacation && "cal-cell-vacation",
                    isWeekend && "cal-cell-weekend",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => setSelectedDate(dateStr)}
                  onDoubleClick={() => openNewEvent(dateStr)}
                >
                  <span className="cal-cell-day">{date.getDate()}</span>
                  {dayEvents.length > 0 && (
                    <div className="cal-cell-dots">
                      {dayEvents.slice(0, 3).map((e) => (
                        <span
                          key={e.id}
                          className="cal-cell-dot"
                          style={{ backgroundColor: CATEGORY_COLORS[e.category] }}
                        />
                      ))}
                      {dayEvents.length > 3 && (
                        <span className="cal-cell-more">+{dayEvents.length - 3}</span>
                      )}
                    </div>
                  )}
                  {hasVacation && (
                    <Palmtree size={10} className="cal-cell-vacation-icon" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Day detail panel */}
        {selectedDate && (
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
                  onClick={() => openNewEvent(selectedDate)}
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
                          onClick={() => openEditEvent(event)}
                          title="Edit"
                        >
                          ✏️
                        </button>
                        <button
                          className="btn btn-ghost btn-xs"
                          onClick={() => handleDeleteEvent(event.id)}
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
        )}

        {/* Event Form Modal */}
        {showEventForm && (
          <div className="cal-modal-overlay" onClick={() => setShowEventForm(false)}>
            <div
              className="cal-modal card animate-slide-up"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="cal-modal-header">
                <h3>{editingEvent ? "Edit Event" : "New Event"}</h3>
                <button
                  className="btn btn-ghost btn-xs"
                  onClick={() => setShowEventForm(false)}
                >
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
                <button
                  className="btn btn-ghost"
                  onClick={() => setShowEventForm(false)}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleSaveEvent}
                  disabled={!formTitle.trim() || !formDate}
                >
                  {editingEvent ? "Save Changes" : "Add Event"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
