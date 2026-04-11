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
  Calendar,
  Palmtree,
  CheckCircle2,
  AlertTriangle,
  Monitor,
} from "lucide-react";
import useStore from "../store/useStore";
import { listDeviceCalendars, importDeviceCalendarEvents } from "../services/ai";
import { entitiesRepo } from "../repositories";
import type { CalendarEvent, DeviceIntegrations } from "../types";
import DeviceCalendarPanel from "../components/DeviceCalendarPanel";
import CalendarDayDetail from "../components/CalendarDayDetail";
import CalendarEventFormModal from "../components/CalendarEventFormModal";
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

  const handleSaveEvent = async () => {
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
      const newEvent = await entitiesRepo.newEvent({
        title: formTitle.trim(),
        startDate,
        endDate,
        isAllDay: formIsAllDay,
        durationMinutes,
        category: formCategory,
        isVacation: formIsVacation,
        source: "manual",
        notes: formNotes.trim() || undefined,
      });
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
        // Convert device events to CalendarEvent format (backend-assigned IDs)
        const imported: CalendarEvent[] = await Promise.all(
          result.events.map((de) =>
            entitiesRepo.newEvent({
              title: (de.title as string) || "Untitled",
              startDate: (de.startDate as string) || "",
              endDate: (de.endDate as string) || "",
              isAllDay: (de.isAllDay as boolean) || false,
              durationMinutes: (de.durationMinutes as number) || 60,
              category: "other",
              isVacation:
                (de.isAllDay as boolean) &&
                ["vacation", "holiday", "pto", "off", "leave", "trip", "travel"].some(
                  (kw) => ((de.title as string) || "").toLowerCase().includes(kw),
                ),
              source: "device-calendar",
              sourceCalendar: (de.calendar as string) || "",
            }),
          ),
        );

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
          <DeviceCalendarPanel
            deviceIntegrations={deviceIntegrations}
            availableDeviceCalendars={availableDeviceCalendars}
            loadingDeviceCals={loadingDeviceCals}
            syncing={syncing}
            syncMessage={syncMessage}
            onEnable={handleEnableDeviceCalendar}
            onList={handleListDeviceCalendars}
            onToggle={handleToggleDeviceCalendar}
            onSyncNow={handleSyncNow}
          />
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
          <CalendarDayDetail
            selectedDate={selectedDate}
            selectedDateEvents={selectedDateEvents}
            onAddEvent={openNewEvent}
            onEditEvent={openEditEvent}
            onDeleteEvent={handleDeleteEvent}
          />
        )}

        {/* Event Form Modal */}
        {showEventForm && (
          <CalendarEventFormModal
            editingEvent={editingEvent}
            formTitle={formTitle}
            formDate={formDate}
            formStartTime={formStartTime}
            formEndTime={formEndTime}
            formIsAllDay={formIsAllDay}
            formCategory={formCategory}
            formIsVacation={formIsVacation}
            formNotes={formNotes}
            setFormTitle={setFormTitle}
            setFormDate={setFormDate}
            setFormStartTime={setFormStartTime}
            setFormEndTime={setFormEndTime}
            setFormIsAllDay={setFormIsAllDay}
            setFormCategory={setFormCategory}
            setFormIsVacation={setFormIsVacation}
            setFormNotes={setFormNotes}
            onClose={() => setShowEventForm(false)}
            onSave={handleSaveEvent}
          />
        )}
      </div>
    </div>
  );
}
