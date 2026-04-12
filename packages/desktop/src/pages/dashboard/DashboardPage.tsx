/* ──────────────────────────────────────────────────────────
   NorthStar — Dashboard page (Home)

   Summary view: greeting, today's progress, active goals,
   pending tasks. Chat is handled by the global slide-out
   panel (components/Chat.tsx).
   ────────────────────────────────────────────────────────── */

import { useState } from "react";
import {
  CalendarDays,
  ArrowRight,
  Loader2,
  AlertTriangle,
  RefreshCw,
  MessageCircle,
  Target,
  CheckCircle2,
  Clock,
} from "lucide-react";
import useStore from "../../store/useStore";
import { useT } from "../../i18n";
import type {
  PendingTask,
  CalendarEvent,
  ContextualNudge,
  Goal,
  HomeChatMessage,
  MonthlyContext,
  Reminder,
  DailyTask,
} from "@northstar/core";
import { PendingTaskCard, PendingEventCard } from "./PendingCards";
import { useQuery } from "../../hooks/useQuery";
import { useCommand } from "../../hooks/useCommand";
import "./DashboardPage.css";

// MUST match packages/server/src/views/dashboardView.ts
interface DashboardTodaySummary {
  completedTasks: number;
  totalTasks: number;
  streak: number;
}

interface DashboardVacationMode {
  active: boolean;
  startDate: string | null;
  endDate: string | null;
}

interface DashboardDailyLoad {
  currentWeight: number;
  currentMinutes: number;
  activeTaskCount: number;
  todayEventCount: number;
}

interface DashboardView {
  todayDate: string;
  greetingName: string;
  todaySummary: DashboardTodaySummary;
  activeGoals: Goal[];
  todayTasks: DailyTask[];
  todayEvents: CalendarEvent[];
  pendingTasks: PendingTask[];
  activePendingTasks: PendingTask[];
  dailyLoad: DashboardDailyLoad;
  homeChatMessages: HomeChatMessage[];
  activeReminders: Reminder[];
  recentNudges: ContextualNudge[];
  vacationMode: DashboardVacationMode;
  currentMonthContext: MonthlyContext | null;
  needsMonthlyContext: boolean;
}

export default function DashboardPage() {
  const setView = useStore((s) => s.setView);
  const toggleChat = useStore((s) => s.toggleChat);
  const t = useT();
  const { data, loading, error, refetch } = useQuery<DashboardView>("view:dashboard");
  const { run } = useCommand();

  const [monthNudgeDismissed, setMonthNudgeDismissed] = useState(false);
  const [pendingEvent, setPendingEvent] = useState<CalendarEvent | null>(null);

  const needsMonthlyContext = !!data?.needsMonthlyContext && !monthNudgeDismissed;
  const currentMonthLabel = new Date().toLocaleDateString(undefined, { month: "long" });

  if (loading && !data) {
    return (
      <div className="dashboard">
        <div className="dashboard-home">
          <div className="home-loading">
            <Loader2 size={18} className="spin" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dashboard">
        <div className="dashboard-home">
          <div className="error-card">
            <div className="error-card-content">
              <AlertTriangle size={16} />
              <p>{error.message}</p>
            </div>
            <div className="error-card-actions">
              <button className="btn btn-ghost btn-sm" onClick={refetch}>
                <RefreshCw size={14} /> Retry
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const activePending = data.activePendingTasks;
  const dailyLoad = data.dailyLoad;
  const summary = data.todaySummary;
  const activeGoals = data.activeGoals.filter(
    (g) => g.status !== "archived",
  );
  const completedCount = data.todayTasks.filter((t) => t.completed).length;
  const totalCount = data.todayTasks.length;

  return (
    <div className="dashboard">
      <div className="dashboard-home">
        {/* ── Greeting + Chat CTA ── */}
        <div className="home-greeting">
          <div className="home-greeting-text">
            <h1>
              {data.greetingName
                ? `Hi, ${data.greetingName}`
                : "Welcome back"}
            </h1>
            <p className="home-date">
              {new Date().toLocaleDateString(undefined, {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
            </p>
          </div>
          <button className="btn btn-primary home-chat-cta" onClick={toggleChat}>
            <MessageCircle size={16} />
            Chat with NorthStar
          </button>
        </div>

        {/* ── Today's Progress ── */}
        {totalCount > 0 && (
          <div className="home-progress-card" onClick={() => setView("tasks")}>
            <div className="home-progress-header">
              <CheckCircle2 size={16} />
              <span>Today's Tasks</span>
            </div>
            <div className="home-progress-bar-track">
              <div
                className="home-progress-bar-fill"
                style={{
                  width: `${totalCount > 0 ? (completedCount / totalCount) * 100 : 0}%`,
                }}
              />
            </div>
            <div className="home-progress-label">
              {completedCount}/{totalCount} completed
              {summary.streak > 1 && (
                <span className="home-streak"> · {summary.streak} day streak</span>
              )}
            </div>
          </div>
        )}

        {/* ── Active Goals ── */}
        {activeGoals.length > 0 && (
          <div className="home-goals-section">
            <div className="home-section-header">
              <Target size={16} />
              <span>Active Goals</span>
            </div>
            <div className="home-goals-grid">
              {activeGoals.slice(0, 3).map((goal) => (
                <button
                  key={goal.id}
                  className="home-goal-card"
                  onClick={() => setView(`goal-plan-${goal.id}`)}
                >
                  <span className="home-goal-icon">{goal.icon || "🎯"}</span>
                  <span className="home-goal-title">{goal.title}</span>
                  <span className="home-goal-slot">{goal.goalSlot}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Upcoming Events ── */}
        {data.todayEvents.length > 0 && (
          <div className="home-events-section">
            <div className="home-section-header">
              <Clock size={16} />
              <span>Today's Events</span>
            </div>
            {data.todayEvents.slice(0, 3).map((event) => (
              <div key={event.id} className="home-event-row">
                <span className="home-event-time">
                  {event.isAllDay
                    ? "All day"
                    : new Date(event.startDate).toLocaleTimeString(undefined, {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                </span>
                <span className="home-event-title">{event.title}</span>
              </div>
            ))}
          </div>
        )}

        {/* ── New month nudge ── */}
        {needsMonthlyContext && (
          <div className="home-month-nudge">
            <CalendarDays size={16} />
            <span>It's {currentMonthLabel} — how does this month look for you?</span>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => setView("planning")}
            >
              Set it up <ArrowRight size={12} />
            </button>
            <button
              className="home-month-nudge-dismiss"
              onClick={() => setMonthNudgeDismissed(true)}
              title="Dismiss"
            >
              &times;
            </button>
          </div>
        )}

        {/* ── Pending Event ── */}
        {pendingEvent && (
          <PendingEventCard
            event={pendingEvent}
            dailyLoad={dailyLoad}
            onConfirm={async () => {
              await run("command:upsert-calendar-event", { event: pendingEvent });
              setPendingEvent(null);
              refetch();
            }}
            onReject={() => setPendingEvent(null)}
            onUpdate={(updates) => setPendingEvent({ ...pendingEvent, ...updates })}
          />
        )}

        {/* ── Pending Tasks ── */}
        {activePending.length > 0 && (
          <div className="home-pending-section">
            {activePending.map((pt) => (
              <PendingTaskCard
                key={pt.id}
                pendingTask={pt}
                dailyLoad={dailyLoad}
                onConfirm={async () => {
                  await run("command:confirm-pending-task", { pendingId: pt.id });
                  refetch();
                }}
                onReject={async () => {
                  await run("command:reject-pending-task", { pendingId: pt.id });
                  refetch();
                }}
                onUpdateAnalysis={() => {}}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
