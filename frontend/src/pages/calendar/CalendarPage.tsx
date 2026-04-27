/* CalendarPage — designed calendar with Month / Week / Day / Project views.
 *
 * Reads view:calendar with {startDate, endDate, viewMode}.
 * Wires: toggle-task, set-task-time-block (day-view drag/resize),
 *        reschedule-task (cross-day drag in week view),
 *        acknowledge-reminder, delete-reminder.
 * Per user decision, the Google Calendar connect/sync banner is DROPPED
 * (commands aren't in the contract).
 */

import { useMemo, useRef, useState } from "react";
import { useQuery } from "../../hooks/useQuery";
import { useCommand } from "../../hooks/useCommand";
import type { DailyTask, Goal, Reminder } from "@starward/core";
import TopBar from "../../components/primitives/TopBar";
import Button from "../../components/primitives/Button";
import Icon from "../../components/primitives/Icon";
import Pill from "../../components/primitives/Pill";

type CalendarViewMode = "month" | "week" | "day" | "project";

interface CalendarDateCounts {
  tasks: number;
  reminders: number;
}

interface ProjectTimeAllocation {
  projectTag: string | null;
  totalMinutes: number;
  percentOfRange: number;
  taskCount: number;
}

interface CalendarView {
  rangeStart: string;
  rangeEnd: string;
  viewMode: CalendarViewMode;
  tasks: DailyTask[];
  goalPlanTasks: unknown[];
  goals: Goal[];
  vacationMode: unknown;
  reminders: Reminder[];
  countsByDate: Record<string, CalendarDateCounts>;
  projectAllocation?: ProjectTimeAllocation[];
}

const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MONTHS_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function isoDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(d.getDate() + n);
  return out;
}

function startOfWeek(d: Date): Date {
  const out = new Date(d);
  out.setDate(d.getDate() - d.getDay());
  return out;
}

function fmtHM(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function rangeFor(mode: CalendarViewMode, anchor: string): { start: string; end: string } {
  const a = new Date(anchor + "T00:00:00");
  if (mode === "month") {
    const start = new Date(a.getFullYear(), a.getMonth(), 1);
    const end = new Date(a.getFullYear(), a.getMonth() + 1, 0);
    return { start: isoDate(start), end: isoDate(end) };
  }
  if (mode === "week") {
    const start = startOfWeek(a);
    return { start: isoDate(start), end: isoDate(addDays(start, 6)) };
  }
  if (mode === "day") return { start: anchor, end: anchor };
  const start = new Date(a.getFullYear(), a.getMonth(), 1);
  const end = new Date(a.getFullYear(), a.getMonth() + 1, 0);
  return { start: isoDate(start), end: isoDate(end) };
}

export default function CalendarPage() {
  const [mode, setMode] = useState<CalendarViewMode>("month");
  const [anchor, setAnchor] = useState<string>(() => isoDate(new Date()));
  const range = useMemo(() => rangeFor(mode, anchor), [mode, anchor]);

  const { data, loading, error, refetch } = useQuery<CalendarView>("view:calendar", {
    startDate: range.start,
    endDate: range.end,
    viewMode: mode,
  });

  function navPrev() {
    const a = new Date(anchor + "T00:00:00");
    if (mode === "month" || mode === "project")
      a.setMonth(a.getMonth() - 1);
    else if (mode === "week") a.setDate(a.getDate() - 7);
    else a.setDate(a.getDate() - 1);
    setAnchor(isoDate(a));
  }
  function navNext() {
    const a = new Date(anchor + "T00:00:00");
    if (mode === "month" || mode === "project")
      a.setMonth(a.getMonth() + 1);
    else if (mode === "week") a.setDate(a.getDate() + 7);
    else a.setDate(a.getDate() + 1);
    setAnchor(isoDate(a));
  }

  const anchorDate = new Date(anchor + "T00:00:00");
  const rangeLabel = useMemo(() => {
    if (mode === "month" || mode === "project") {
      return `${MONTHS_FULL[anchorDate.getMonth()]} ${anchorDate.getFullYear()}`;
    }
    if (mode === "week") {
      const s = new Date(range.start + "T00:00:00");
      const e = new Date(range.end + "T00:00:00");
      return `${MONTHS_FULL[s.getMonth()].slice(0, 3)} ${s.getDate()} – ${MONTHS_FULL[e.getMonth()].slice(0, 3)} ${e.getDate()}`;
    }
    return `${DAYS[anchorDate.getDay()]} ${MONTHS_FULL[anchorDate.getMonth()]} ${anchorDate.getDate()}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, anchor, range.start, range.end]);

  return (
    <>
      <TopBar
        eyebrow={rangeLabel}
        title="Calendar"
        right={
          <>
            <div
              style={{
                display: "inline-flex",
                border: "1px solid var(--border)",
                borderRadius: 4,
                overflow: "hidden",
              }}
            >
              {(["month", "week", "day", "project"] as const).map((m) => (
                <button
                  key={m}
                  data-testid={`calendar-mode-${m}`}
                  onClick={() => setMode(m)}
                  style={{
                    padding: "5px 12px",
                    fontSize: 11,
                    border: 0,
                    background: mode === m ? "var(--navy)" : "transparent",
                    color: mode === m ? "var(--white)" : "var(--fg-mute)",
                    cursor: "pointer",
                    textTransform: "capitalize",
                    fontFamily: "inherit",
                  }}
                >
                  {m}
                </button>
              ))}
            </div>
            <Button
              size="sm"
              tone="ghost"
              icon="chevron-left"
              onClick={navPrev}
              data-testid="calendar-prev"
            >
              Prev
            </Button>
            <input
              data-testid="calendar-anchor"
              type="date"
              value={anchor}
              onChange={(e) => setAnchor(e.target.value)}
              style={{
                padding: "5px 8px",
                fontSize: "var(--t-sm)",
                border: "1px solid var(--border)",
                borderRadius: 4,
              }}
            />
            <Button
              size="sm"
              tone="ghost"
              iconRight="chevron-right"
              onClick={navNext}
              data-testid="calendar-next"
            >
              Next
            </Button>
            <Button
              size="sm"
              tone="ghost"
              icon="refresh"
              onClick={refetch}
              data-api="GET /view/calendar"
              data-testid="calendar-refetch"
            >
              Refresh
            </Button>
          </>
        }
      />
      {loading && !data && (
        <div data-testid="calendar-loading" style={{ padding: 40, textAlign: "center", color: "var(--fg-faint)" }}>
          Loading…
        </div>
      )}
      {error && (
        <div
          data-testid="calendar-error"
          style={{
            padding: 20,
            color: "var(--danger)",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
          }}
        >
          {String(error)}
        </div>
      )}

      {data && mode === "month" && <MonthView data={data} onChange={refetch} />}
      {data && mode === "week" && <WeekView data={data} onChange={refetch} />}
      {data && mode === "day" && <DayView data={data} anchor={anchor} onChange={refetch} />}
      {data && mode === "project" && <ProjectView data={data} />}
    </>
  );
}

// ── Month view ────────────────────────────────────────────────

function MonthView({ data, onChange }: { data: CalendarView; onChange: () => void }) {
  const [selected, setSelected] = useState<string | null>(null);

  const rangeStart = new Date(data.rangeStart + "T00:00:00");
  const firstOfMonth = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
  const gridStart = startOfWeek(firstOfMonth);
  const days: Date[] = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const cursorMonth = rangeStart.getMonth();
  const today = new Date();

  return (
    <div
      className="ns-cal-two-col"
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) minmax(0, 320px)",
        gap: 16,
        padding: 20,
        alignItems: "start",
      }}
    >
      <div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", marginBottom: 6 }}>
          {DAYS.map((d) => (
            <div
              key={d}
              style={{
                fontSize: 10,
                letterSpacing: "0.12em",
                color: "var(--fg-faint)",
                textTransform: "uppercase",
                fontWeight: 600,
                padding: "4px 6px",
              }}
            >
              {d}
            </div>
          ))}
        </div>
        <div
          data-testid="calendar-month-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, 1fr)",
            gridAutoRows: "minmax(98px, 1fr)",
            border: "1px solid var(--border)",
            borderRadius: "var(--r-md)",
            background: "var(--bg-elev)",
            overflow: "hidden",
          }}
        >
          {days.map((d) => {
            const key = isoDate(d);
            const outside = d.getMonth() !== cursorMonth;
            const isToday = sameDay(d, today);
            const isSelected = selected === key;
            const counts = data.countsByDate[key] ?? { tasks: 0, reminders: 0 };
            const dayTasks = data.tasks.filter((t) => t.date === key).slice(0, 3);
            return (
              <div
                key={key}
                data-testid={`calendar-month-cell-${key}`}
                data-outside={outside ? "true" : "false"}
                data-selected={isSelected ? "true" : "false"}
                onClick={() => setSelected(key)}
                style={{
                  borderTop: "1px solid var(--border-soft)",
                  borderLeft: "1px solid var(--border-soft)",
                  padding: "6px 7px",
                  background: isSelected
                    ? "var(--navy-tint)"
                    : outside
                      ? "var(--bg-sunken)"
                      : "var(--bg-elev)",
                  cursor: "pointer",
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                  gap: 3,
                  minHeight: 0,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 4,
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: isToday ? 700 : 500,
                      color: isToday
                        ? "var(--white)"
                        : outside
                          ? "var(--fg-faint)"
                          : "var(--fg)",
                      background: isToday ? "var(--accent)" : "transparent",
                      borderRadius: 10,
                      padding: isToday ? "2px 7px" : 0,
                    }}
                  >
                    {d.getDate()}
                  </span>
                  {counts.tasks + counts.reminders > 0 && (
                    <span
                      data-testid={`calendar-month-count-${key}`}
                      title={`${counts.tasks} tasks · ${counts.reminders} reminders`}
                      style={{
                        fontSize: 9,
                        fontWeight: 600,
                        padding: "1px 6px",
                        borderRadius: 8,
                        background: counts.reminders > 0 ? "var(--gold-faint)" : "var(--bg-soft)",
                        color: counts.reminders > 0 ? "var(--accent)" : "var(--fg-mute)",
                        border: "1px solid var(--border-soft)",
                      }}
                    >
                      {counts.tasks}
                      {counts.reminders > 0 && `·${counts.reminders}`}
                    </span>
                  )}
                </div>
                {dayTasks.map((t) => (
                  <div
                    key={t.id}
                    style={{
                      fontSize: 10,
                      lineHeight: 1.3,
                      padding: "1px 5px",
                      borderLeft: "2px solid var(--accent)",
                      color: t.completed ? "var(--fg-faint)" : "var(--fg-mute)",
                      textDecoration: t.completed ? "line-through" : "none",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {t.title}
                  </div>
                ))}
                {counts.tasks > 3 && (
                  <span style={{ fontSize: 9, color: "var(--fg-faint)", marginTop: "auto" }}>
                    +{counts.tasks - 3} more
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <DateSideView date={selected} data={data} onChange={onChange} />
    </div>
  );
}

function DateSideView({
  date,
  data,
  onChange,
}: {
  date: string | null;
  data: CalendarView;
  onChange: () => void;
}) {
  const { run } = useCommand();
  if (!date) {
    return (
      <aside
        data-testid="calendar-side-empty"
        style={{
          padding: 16,
          border: "1px dashed var(--border)",
          borderRadius: "var(--r-md)",
          background: "var(--bg-elev)",
          color: "var(--fg-faint)",
          fontSize: "var(--t-sm)",
          textAlign: "center",
        }}
      >
        Click a date to see its tasks and reminders.
      </aside>
    );
  }

  const tasks = data.tasks.filter((t) => t.date === date);
  const reminders = data.reminders.filter((r) => r.date === date);
  const d = new Date(date + "T00:00:00");

  async function toggle(id: string) {
    await run("command:toggle-task", { taskId: id });
    onChange();
  }
  async function ack(id: string) {
    await run("command:acknowledge-reminder", { id });
    onChange();
  }
  async function del(id: string) {
    await run("command:delete-reminder", { id });
    onChange();
  }

  return (
    <aside
      data-testid={`calendar-side-${date}`}
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--r-md)",
        background: "var(--bg-elev)",
        padding: 16,
        fontSize: "var(--t-sm)",
      }}
    >
      <div
        style={{
          fontSize: 11,
          letterSpacing: "0.14em",
          color: "var(--fg-faint)",
          textTransform: "uppercase",
          fontWeight: 600,
          marginBottom: 4,
        }}
      >
        {DAYS[d.getDay()]}
      </div>
      <h3
        className="h-display"
        style={{
          margin: "0 0 14px",
          fontSize: 22,
          color: "var(--fg)",
          fontWeight: 600,
        }}
      >
        {MONTHS_FULL[d.getMonth()]} {d.getDate()}
      </h3>

      <div style={{ marginBottom: 14 }}>
        <div
          style={{
            fontSize: 10,
            letterSpacing: "0.12em",
            color: "var(--fg-faint)",
            textTransform: "uppercase",
            fontWeight: 600,
            marginBottom: 6,
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <span>Tasks</span>
          <span>{tasks.length}</span>
        </div>
        {tasks.length === 0 && (
          <div style={{ color: "var(--fg-faint)", fontStyle: "italic", fontSize: "var(--t-xs)" }}>
            No tasks.
          </div>
        )}
        {tasks.map((t) => (
          <div
            key={t.id}
            data-testid={`calendar-side-task-${t.id}`}
            className="ns-row"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 0",
              borderBottom: "1px solid var(--border-soft)",
            }}
          >
            <button
              onClick={() => toggle(t.id)}
              data-api="POST /commands/toggle-task"
              data-testid={`calendar-side-toggle-${t.id}`}
              style={{
                width: 16,
                height: 16,
                borderRadius: 3,
                border: t.completed
                  ? "1.5px solid var(--accent)"
                  : "1.5px solid var(--border-strong)",
                background: t.completed ? "var(--accent)" : "transparent",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              {t.completed && <Icon name="check" size={9} style={{ color: "var(--white)" }} />}
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: "var(--t-sm)",
                  color: "var(--fg)",
                  textDecoration: t.completed ? "line-through" : "none",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {t.title}
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: "var(--fg-faint)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {fmtHM(t.scheduledStartIso)}
                {t.estimatedDurationMinutes ? ` · ${t.estimatedDurationMinutes}m` : ""}
                {t.goalTitle ? ` · ${t.goalTitle}` : ""}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div>
        <div
          style={{
            fontSize: 10,
            letterSpacing: "0.12em",
            color: "var(--fg-faint)",
            textTransform: "uppercase",
            fontWeight: 600,
            marginBottom: 6,
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <span>Reminders</span>
          <span>{reminders.length}</span>
        </div>
        {reminders.length === 0 && (
          <div style={{ color: "var(--fg-faint)", fontStyle: "italic", fontSize: "var(--t-xs)" }}>
            No reminders.
          </div>
        )}
        {reminders.map((r) => (
          <div
            key={r.id}
            data-testid={`calendar-side-reminder-${r.id}`}
            className="ns-row"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 0",
              borderBottom: "1px solid var(--border-soft)",
            }}
          >
            <Icon name="bell" size={12} style={{ color: "var(--accent)", flexShrink: 0 }} />
            <span
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: "var(--t-sm)",
                color: "var(--fg)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {r.title}
            </span>
            <button
              onClick={() => ack(r.id)}
              data-api="POST /commands/acknowledge-reminder"
              data-testid={`calendar-side-ack-${r.id}`}
              title="Acknowledge"
              style={iconBtn}
            >
              <Icon name="check" size={11} />
            </button>
            <button
              onClick={() => del(r.id)}
              data-api="POST /commands/delete-reminder"
              data-testid={`calendar-side-del-${r.id}`}
              title="Delete"
              style={iconBtn}
            >
              <Icon name="trash" size={11} />
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
}

const iconBtn: React.CSSProperties = {
  width: 22,
  height: 22,
  border: "1px solid var(--border)",
  background: "var(--bg)",
  borderRadius: 3,
  color: "var(--fg-mute)",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

// ── Week view ────────────────────────────────────────────────

function WeekView({ data, onChange }: { data: CalendarView; onChange: () => void }) {
  const { run } = useCommand();
  const start = new Date(data.rangeStart + "T00:00:00");
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const today = new Date();

  async function onDropCrossDay(taskId: string, targetDate: string) {
    await run("command:reschedule-task", { taskId, targetDate });
    onChange();
  }

  return (
    <div style={{ padding: 20 }}>
      <div
        data-testid="calendar-week-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
          border: "1px solid var(--border)",
          borderRadius: "var(--r-md)",
          background: "var(--bg-elev)",
          overflow: "hidden",
        }}
      >
        {days.map((d) => {
          const key = isoDate(d);
          const isToday = sameDay(d, today);
          const dayTasks = data.tasks
            .filter((t) => t.date === key)
            .sort((a, b) => (a.scheduledStartIso ?? "").localeCompare(b.scheduledStartIso ?? ""));
          const dayReminders = data.reminders.filter((r) => r.date === key);
          return (
            <div
              key={key}
              data-testid={`calendar-week-col-${key}`}
              onDragOver={(e) => {
                e.preventDefault();
                e.currentTarget.style.background = "var(--navy-tint)";
              }}
              onDragLeave={(e) => {
                e.currentTarget.style.background = isToday
                  ? "var(--navy-tint)"
                  : "var(--bg-elev)";
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.currentTarget.style.background = isToday
                  ? "var(--navy-tint)"
                  : "var(--bg-elev)";
                const taskId = e.dataTransfer.getData("text/task-id");
                if (taskId) void onDropCrossDay(taskId, key);
              }}
              style={{
                minHeight: 380,
                borderRight: "1px solid var(--border-soft)",
                padding: "8px 8px 16px",
                display: "flex",
                flexDirection: "column",
                gap: 5,
                background: isToday ? "var(--navy-tint)" : "var(--bg-elev)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  borderBottom: "1px solid var(--border-soft)",
                  paddingBottom: 5,
                  marginBottom: 4,
                }}
              >
                <div
                  style={{
                    fontSize: 9,
                    letterSpacing: "0.12em",
                    color: "var(--fg-faint)",
                    textTransform: "uppercase",
                    fontWeight: 600,
                  }}
                >
                  {DAYS[d.getDay()]}
                </div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: isToday ? 700 : 500,
                    color: isToday ? "var(--accent)" : "var(--fg)",
                  }}
                >
                  {d.getDate()}
                </div>
              </div>
              {dayReminders.map((r) => (
                <div
                  key={r.id}
                  style={{
                    fontSize: 10,
                    padding: "3px 6px",
                    background: "var(--gold-faint)",
                    color: "var(--accent)",
                    border: "1px solid var(--gold-line-faint)",
                    borderRadius: 3,
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <Icon name="bell" size={9} />
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {r.title}
                  </span>
                </div>
              ))}
              {dayTasks.map((t) => (
                <div
                  key={t.id}
                  data-testid={`calendar-week-task-${t.id}`}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("text/task-id", t.id)}
                  title={`${fmtHM(t.scheduledStartIso)} · ${t.estimatedDurationMinutes ?? "?"}m`}
                  style={{
                    fontSize: 10,
                    padding: "3px 6px",
                    borderLeft: "2px solid var(--accent)",
                    background: "var(--bg)",
                    color: t.completed ? "var(--fg-faint)" : "var(--fg)",
                    textDecoration: t.completed ? "line-through" : "none",
                    borderRadius: 2,
                    cursor: "grab",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 9,
                      color: "var(--fg-faint)",
                      marginRight: 4,
                    }}
                  >
                    {fmtHM(t.scheduledStartIso)}
                  </span>
                  {t.title}
                </div>
              ))}
              {dayTasks.length === 0 && dayReminders.length === 0 && (
                <div
                  style={{
                    color: "var(--fg-faint)",
                    fontSize: 10,
                    fontStyle: "italic",
                    marginTop: 20,
                    textAlign: "center",
                  }}
                >
                  empty
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 10, color: "var(--fg-faint)", marginTop: 8, textAlign: "right" }}>
        Drag a task across days → <code>POST /commands/reschedule-task</code>
      </div>
    </div>
  );
}

// ── Day view ─────────────────────────────────────────────────

const PX_PER_HOUR = 48;

function DayView({
  data,
  anchor,
  onChange,
}: {
  data: CalendarView;
  anchor: string;
  onChange: () => void;
}) {
  const { run } = useCommand();
  const tasksForDate = data.tasks.filter((t) => t.date === anchor);
  // SPLIT: hour grid renders only tasks with non-null scheduledStartIso.
  // Tasks without it appear in the Unscheduled lane above. Don't add a
  // `?? new Date()` fallback in DayBlock — it produces invisible blocks
  // at wall-clock-now and hides the empty state. Mirrors Google
  // Calendar's "All-day" / Things 3's "Today" lane pattern. The day
  // summary's "Blocked: N · Unscheduled: M" makes the divergence
  // explicit instead of conflating both under "Scheduled".
  const blockedTasks = tasksForDate.filter((t) => Boolean(t.scheduledStartIso));
  const unscheduledTasks = tasksForDate.filter((t) => !t.scheduledStartIso);
  const reminders = data.reminders.filter((r) => r.date === anchor);

  // Compute total time from blocked tasks only (consistent with
  // "First/Last block" which already requires a real time).
  const totalBlockedMinutes = blockedTasks.reduce(
    (a, t) => a + (t.estimatedDurationMinutes ?? 0),
    0,
  );

  // Grid drop handler: chip dragged from the unscheduled lane.
  // dataTransfer carries the taskId; we compute the hour from the
  // drop Y offset within the grid (snap to 15-min increments).
  function onGridDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const taskId = e.dataTransfer.getData("text/x-starward-task-id");
    if (!taskId) return;
    const task = unscheduledTasks.find((t) => t.id === taskId);
    if (!task) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const minutesFromMidnight = Math.max(
      0,
      Math.min(24 * 60 - 15, Math.round(((y / PX_PER_HOUR) * 60) / 15) * 15),
    );
    // Construct the ISO at the user's local-day midnight + minutes.
    // anchor is YYYY-MM-DD; build a Date in local time for that day.
    const [yyyy, mm, dd] = anchor.split("-").map(Number);
    const start = new Date(yyyy, (mm ?? 1) - 1, dd ?? 1, 0, 0, 0, 0);
    start.setMinutes(start.getMinutes() + minutesFromMidnight);
    const durationMin = task.estimatedDurationMinutes ?? 30;
    void run("command:set-task-time-block", {
      taskId: task.id,
      timeBlock: {
        scheduledStartIso: start.toISOString(),
        estimatedDurationMinutes: durationMin,
      },
    }).then(onChange);
  }

  return (
    <div
      className="ns-cal-two-col"
      style={{
        padding: 20,
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) minmax(0, 280px)",
        gap: 16,
        alignItems: "start",
      }}
    >
      <div>
        {reminders.length > 0 && (
          <div
            style={{
              marginBottom: 12,
              padding: 10,
              border: "1px solid var(--gold-line-faint)",
              background: "var(--gold-faint)",
              borderRadius: "var(--r-md)",
            }}
          >
            <div
              style={{
                fontSize: 10,
                letterSpacing: "0.12em",
                color: "var(--accent)",
                textTransform: "uppercase",
                fontWeight: 600,
                marginBottom: 6,
              }}
            >
              Reminders today
            </div>
            {reminders.map((r) => (
              <div
                key={r.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: "var(--t-sm)",
                  padding: "2px 0",
                }}
              >
                <Icon name="bell" size={11} style={{ color: "var(--accent)" }} />
                <span>{r.title}</span>
              </div>
            ))}
          </div>
        )}

        {unscheduledTasks.length > 0 && (
          <div
            data-testid="calendar-day-unscheduled-lane"
            style={{
              marginBottom: 12,
              padding: 10,
              border: "1px dashed var(--border)",
              background: "var(--bg-elev)",
              borderRadius: "var(--r-md)",
            }}
          >
            <div
              style={{
                fontSize: 10,
                letterSpacing: "0.12em",
                color: "var(--fg-faint)",
                textTransform: "uppercase",
                fontWeight: 600,
                marginBottom: 8,
                display: "flex",
                alignItems: "baseline",
                gap: 8,
              }}
            >
              <span>Unscheduled · {unscheduledTasks.length}</span>
              <span
                style={{
                  fontSize: 9,
                  letterSpacing: "0.06em",
                  textTransform: "none",
                  color: "var(--fg-faint)",
                  fontWeight: 400,
                }}
              >
                drag a chip onto the grid to schedule
              </span>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {unscheduledTasks.map((t) => (
                <UnscheduledChip key={t.id} task={t} />
              ))}
            </div>
          </div>
        )}

        <div
          data-testid="calendar-day-grid"
          onDragOver={(e) => {
            // Required so the drop event fires.
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
          }}
          onDrop={onGridDrop}
          style={{
            position: "relative",
            border: "1px solid var(--border)",
            borderRadius: "var(--r-md)",
            background: "var(--bg-elev)",
            height: 24 * PX_PER_HOUR,
            overflow: "hidden",
          }}
        >
          {Array.from({ length: 24 }, (_, h) => h).map((h) => (
            <div
              key={h}
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: h * PX_PER_HOUR,
                height: PX_PER_HOUR,
                borderTop: h === 0 ? "0" : "1px solid var(--border-soft)",
                display: "flex",
                alignItems: "flex-start",
              }}
            >
              <span
                style={{
                  fontSize: 9,
                  fontFamily: "var(--font-mono)",
                  color: "var(--fg-faint)",
                  padding: "2px 6px",
                  width: 38,
                  borderRight: "1px solid var(--border-soft)",
                  height: PX_PER_HOUR,
                  background: "var(--bg-sunken)",
                }}
              >
                {String(h).padStart(2, "0")}:00
              </span>
            </div>
          ))}

          {blockedTasks.map((t) => (
            <DayBlock key={t.id} task={t} onChange={onChange} />
          ))}
        </div>
      </div>

      <aside
        style={{
          border: "1px solid var(--border)",
          borderRadius: "var(--r-md)",
          background: "var(--bg-elev)",
          padding: 14,
          fontSize: "var(--t-sm)",
        }}
      >
        <div
          style={{
            fontSize: 10,
            letterSpacing: "0.12em",
            color: "var(--fg-faint)",
            textTransform: "uppercase",
            fontWeight: 600,
            marginBottom: 8,
          }}
        >
          Day summary
        </div>
        <Metric label="Blocked" value={String(blockedTasks.length)} />
        <Metric label="Unscheduled" value={String(unscheduledTasks.length)} />
        <Metric
          label="Total time"
          value={`${Math.round((totalBlockedMinutes / 60) * 10) / 10}h`}
        />
        <Metric
          label="First block"
          value={blockedTasks[0] ? fmtHM(blockedTasks[0].scheduledStartIso) : "—"}
        />
        <Metric
          label="Last block"
          value={
            blockedTasks.length > 0
              ? fmtHM(blockedTasks[blockedTasks.length - 1].scheduledStartIso)
              : "—"
          }
        />
        <div
          style={{
            marginTop: 14,
            paddingTop: 12,
            borderTop: "1px solid var(--border-soft)",
            fontSize: 10,
            color: "var(--fg-faint)",
            lineHeight: 1.55,
          }}
        >
          Drag a block to move it. Drag its bottom edge to resize. <br />
          <span style={{ fontFamily: "var(--font-mono)", color: "var(--accent)" }}>
            POST /commands/set-task-time-block
          </span>
        </div>
      </aside>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        padding: "4px 0",
        borderBottom: "1px dashed var(--border-soft)",
      }}
    >
      <span style={{ fontSize: "var(--t-xs)", color: "var(--fg-faint)" }}>{label}</span>
      <span
        className="tnum"
        style={{ fontSize: "var(--t-sm)", color: "var(--fg)", fontWeight: 500 }}
      >
        {value}
      </span>
    </div>
  );
}

/** Draggable chip rendered in the Day view's Unscheduled lane.
 *  Drag onto an hour slot in the grid → DayView.onGridDrop fires
 *  command:set-task-time-block with the snapped time. Uses HTML5
 *  native drag (lighter than re-implementing mouse-tracking like
 *  DayBlock's move/resize). */
function UnscheduledChip({ task }: { task: DailyTask }) {
  const durationMin = task.estimatedDurationMinutes ?? 30;
  return (
    <div
      data-testid={`calendar-unscheduled-${task.id}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/x-starward-task-id", task.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      title={`${task.title} · ${durationMin}m`}
      style={{
        background: "var(--bg-soft)",
        border: "1px solid var(--border)",
        borderLeft: "3px solid var(--accent)",
        borderRadius: 3,
        padding: "4px 8px",
        fontSize: 11,
        color: "var(--fg)",
        cursor: "grab",
        userSelect: "none",
        display: "inline-flex",
        alignItems: "baseline",
        gap: 6,
        maxWidth: "100%",
      }}
    >
      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          maxWidth: 220,
        }}
      >
        {task.title}
      </span>
      <span
        style={{
          fontSize: 9,
          fontFamily: "var(--font-mono)",
          color: "var(--fg-faint)",
          flexShrink: 0,
        }}
      >
        {durationMin}m
      </span>
    </div>
  );
}

function DayBlock({ task, onChange }: { task: DailyTask; onChange: () => void }) {
  const { run } = useCommand();
  // Caller (DayView) only passes tasks with non-null scheduledStartIso.
  // Don't add a `?? new Date()` fallback here — that produced invisible
  // blocks at wall-clock-now and hid the empty state. Tasks without a
  // time block belong in the Unscheduled lane above the grid.
  const start = new Date(task.scheduledStartIso!);
  const top = (start.getHours() + start.getMinutes() / 60) * PX_PER_HOUR;
  const durationMin = task.estimatedDurationMinutes ?? 30;
  const height = (durationMin / 60) * PX_PER_HOUR;

  const [dragging, setDragging] = useState(false);
  const [ghost, setGhost] = useState<{ dy: number; dh: number }>({ dy: 0, dh: 0 });
  const modeRef = useRef<"move" | "resize" | null>(null);

  function startDrag(e: React.MouseEvent, mode: "move" | "resize") {
    e.stopPropagation();
    modeRef.current = mode;
    const y0 = e.clientY;
    setDragging(true);
    const onMove = (ev: MouseEvent) => {
      const dy = ev.clientY - y0;
      setGhost(mode === "move" ? { dy, dh: 0 } : { dy: 0, dh: dy });
    };
    const onUp = async () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setDragging(false);
      setGhost(({ dy, dh }) => {
        if (mode === "move" && Math.abs(dy) > 3) {
          const deltaMin = Math.round(((dy / PX_PER_HOUR) * 60) / 15) * 15;
          const newStart = new Date(start);
          newStart.setMinutes(newStart.getMinutes() + deltaMin);
          void run("command:set-task-time-block", {
            taskId: task.id,
            timeBlock: {
              scheduledStartIso: newStart.toISOString(),
              estimatedDurationMinutes: durationMin,
            },
          }).then(onChange);
        }
        if (mode === "resize" && Math.abs(dh) > 3) {
          const newH = Math.max(
            15,
            Math.round(((height + dh) / PX_PER_HOUR) * 60 / 15) * 15,
          );
          void run("command:set-task-time-block", {
            taskId: task.id,
            timeBlock: {
              scheduledStartIso: task.scheduledStartIso,
              estimatedDurationMinutes: newH,
            },
          }).then(onChange);
        }
        return { dy: 0, dh: 0 };
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  return (
    <div
      data-testid={`calendar-day-block-${task.id}`}
      style={{
        position: "absolute",
        left: 46,
        right: 8,
        top: top + ghost.dy,
        height: Math.max(22, height + ghost.dh),
        background: "color-mix(in oklab, var(--accent) 10%, var(--bg-elev))",
        border: "1px solid var(--accent)",
        borderLeft: "3px solid var(--accent)",
        borderRadius: 3,
        padding: "3px 8px",
        fontSize: 11,
        color: "var(--fg)",
        cursor: dragging ? "grabbing" : "grab",
        userSelect: "none",
        overflow: "hidden",
        boxShadow: dragging ? "var(--shadow-2)" : "none",
        zIndex: dragging ? 10 : 1,
      }}
      onMouseDown={(e) => startDrag(e, "move")}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
        <span
          style={{
            fontSize: 10,
            fontFamily: "var(--font-mono)",
            color: "var(--fg-mute)",
          }}
        >
          {fmtHM(task.scheduledStartIso)}
        </span>
        <span style={{ fontSize: 10, color: "var(--fg-faint)" }}>{durationMin}m</span>
      </div>
      <div
        style={{
          fontWeight: 500,
          marginTop: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {task.title}
      </div>
      {task.goalTitle && (
        <div
          style={{
            fontSize: 9,
            color: "var(--fg-faint)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            marginTop: 1,
          }}
        >
          {task.goalTitle}
        </div>
      )}
      <div
        onMouseDown={(e) => startDrag(e, "resize")}
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 6,
          cursor: "ns-resize",
          background: "transparent",
        }}
      />
    </div>
  );
}

// ── Project view ─────────────────────────────────────────────

function ProjectView({ data }: { data: CalendarView }) {
  const alloc = data.projectAllocation ?? [];
  const total = alloc.reduce((a, p) => a + p.totalMinutes, 0);

  return (
    <div style={{ padding: 20, maxWidth: 860, margin: "0 auto" }}>
      <div style={{ marginBottom: 14 }}>
        <div
          style={{
            fontSize: 11,
            letterSpacing: "0.14em",
            color: "var(--fg-faint)",
            textTransform: "uppercase",
            fontWeight: 600,
            marginBottom: 4,
          }}
        >
          Time allocation
        </div>
        <div style={{ fontSize: "var(--t-sm)", color: "var(--fg-mute)" }}>
          {Math.round(total / 60)} hours scheduled across {alloc.length} projects
        </div>
      </div>

      {alloc.length === 0 ? (
        <div
          data-testid="calendar-project-empty"
          style={{
            padding: 40,
            textAlign: "center",
            color: "var(--fg-faint)",
            border: "1px dashed var(--border)",
            borderRadius: "var(--r-md)",
          }}
        >
          No project allocation data for this range.
        </div>
      ) : (
        <>
          <div
            style={{
              display: "flex",
              height: 12,
              borderRadius: 6,
              overflow: "hidden",
              border: "1px solid var(--border)",
              marginBottom: 18,
            }}
          >
            {alloc.map((p, i) => (
              <div
                key={i}
                title={`${p.projectTag ?? "unassigned"} · ${p.percentOfRange.toFixed(1)}%`}
                style={{
                  flex: p.percentOfRange,
                  background: i % 2 ? "var(--navy-mid)" : "var(--accent)",
                }}
              />
            ))}
          </div>
          <div
            data-testid="calendar-project-rows"
            style={{
              border: "1px solid var(--border)",
              borderRadius: "var(--r-md)",
              background: "var(--bg-elev)",
              overflow: "hidden",
            }}
          >
            {alloc.map((p, i) => (
              <div
                key={i}
                data-testid={`calendar-project-row-${p.projectTag ?? "unassigned"}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "160px 1fr auto",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 14px",
                  borderTop: i === 0 ? 0 : "1px solid var(--border-soft)",
                }}
              >
                <Pill tone="gold" icon="tag">
                  {p.projectTag ?? "(unassigned)"}
                </Pill>
                <div
                  style={{
                    height: 6,
                    background: "var(--bg-sunken)",
                    borderRadius: 3,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${p.percentOfRange}%`,
                      height: "100%",
                      background: "var(--accent)",
                    }}
                  />
                </div>
                <span className="tnum" style={{ fontSize: 11, color: "var(--fg-mute)" }}>
                  {Math.round((p.totalMinutes / 60) * 10) / 10}h ·{" "}
                  {p.percentOfRange.toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
