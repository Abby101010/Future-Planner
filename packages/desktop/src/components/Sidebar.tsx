/* ──────────────────────────────────────────────────────────
   NorthStar — Sidebar component
   ────────────────────────────────────────────────────────── */

import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  Map,
  Settings,
  CalendarDays,
  Target,
  CheckSquare,
  Compass,
  Newspaper,
  Download,
} from "lucide-react";
import useStore from "../store/useStore";
import { useQuery } from "../hooks/useQuery";
import { useT, getDateLocale } from "../i18n";
import type { AppView, Goal, Roadmap, UserProfile } from "@northstar/core";
import "./Sidebar.css";

interface NavItem {
  icon: React.ReactNode;
  label: string;
  view: AppView;
  optIn?: boolean;
}

interface SidebarPlanningView {
  goals: Goal[];
}
interface SidebarRoadmapView {
  roadmap: Roadmap | null;
}
interface SidebarSettingsView {
  user: UserProfile | null;
}

export default function Sidebar() {
  const currentView = useStore((s) => s.currentView);
  const setView = useStore((s) => s.setView);
  const lang = useStore((s) => s.language);
  const { data: planningData } = useQuery<SidebarPlanningView>("view:planning");
  const { data: roadmapData } = useQuery<SidebarRoadmapView>("view:roadmap");
  const { data: settingsData } = useQuery<SidebarSettingsView>("view:settings");
  const goals: Goal[] = planningData?.goals ?? [];
  const roadmap = roadmapData?.roadmap ?? null;
  const user = settingsData?.user ?? null;
  const t = useT();

  // ── Auto-update badge ──
  // Listens for "updater:status" IPC events from electron/auto-updater.ts.
  // When the updater detects a newer version on GitHub Releases, it pushes
  // { status: "available", version }, and we surface a badge in the footer.
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  useEffect(() => {
    if (!window.electronAPI?.on) return;
    const off = window.electronAPI.on("updater:status", (...args: unknown[]) => {
      const payload = args[0] as { status?: string; version?: string } | undefined;
      if (payload?.status === "available" && payload.version) {
        setUpdateVersion(payload.version);
      }
    });
    return () => {
      if (typeof off === "function") off();
    };
  }, []);
  const handleOpenReleases = () => {
    window.electronAPI?.invoke?.("updater:open-releases");
  };

  const bigGoals = goals.filter(
    (g) => (g.goalType === "big" || (!g.goalType && g.scope === "big")) && g.status !== "archived"
  );
  const everydayCount = goals.filter(
    (g) => (g.goalType === "everyday" || (!g.goalType && g.scope === "small")) && g.status !== "archived" && g.status !== "completed"
  ).length;
  const repeatingCount = goals.filter(
    (g) => g.goalType === "repeating" && g.status !== "archived"
  ).length;

  const nav: NavItem[] = [
    { icon: <LayoutDashboard size={18} />, label: t.sidebar.today, view: "dashboard" },
    { icon: <Compass size={18} />, label: "Planning", view: "planning" },
    { icon: <CheckSquare size={18} />, label: t.sidebar.tasks, view: "tasks" },
    { icon: <CalendarDays size={18} />, label: t.sidebar.calendar, view: "calendar" },
    { icon: <Map size={18} />, label: t.sidebar.roadmap, view: "roadmap" },
    {
      icon: <Newspaper size={18} />,
      label: t.settings.newsFeed,
      view: "news-feed",
      optIn: true,
    },
    { icon: <Settings size={18} />, label: t.sidebar.settings, view: "settings" },
  ];

  // Filter visibility
  const visibleNav = nav.filter((item) => {
    if (item.label === t.sidebar.roadmap && !roadmap) return false;
    if (item.label === t.settings.newsFeed) {
      return user?.settings.enableNewsFeed;
    }
    return true;
  });

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="sidebar-title">NorthStar</span>
      </div>

      <nav className="sidebar-nav">
        {visibleNav.map((item) => (
          <button
            key={item.view + item.label}
            className={`sidebar-item ${currentView === item.view ? "active" : ""}`}
            onClick={() => setView(item.view)}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}

        {/* Dynamic entries for goals */}
        {(bigGoals.length > 0 || everydayCount > 0 || repeatingCount > 0) && (
          <>
            <div className="sidebar-divider" />
            <div className="sidebar-section-label">{t.sidebar.goalsSection}</div>
            {bigGoals.map((goal) => {
              const goalView: AppView = `goal-plan-${goal.id}`;
              // Compute progress for sidebar badge
              let progressPercent = 0;
              if (goal.plan && Array.isArray(goal.plan.years)) {
                let total = 0, completed = 0;
                for (const yr of goal.plan.years) {
                  for (const mo of yr.months) {
                    for (const wk of mo.weeks) {
                      for (const dy of wk.days) {
                        for (const tk of dy.tasks) {
                          total++;
                          if (tk.completed) completed++;
                        }
                      }
                    }
                  }
                }
                progressPercent = total > 0 ? Math.round((completed / total) * 100) : 0;
              }
              return (
                <button
                  key={goal.id}
                  className={`sidebar-item ${currentView === goalView ? "active" : ""}`}
                  onClick={() => setView(goalView)}
                >
                  {goal.icon ? (
                    <span className="sidebar-goal-icon">{goal.icon}</span>
                  ) : (
                    <Target size={18} />
                  )}
                  <span className="sidebar-goal-label">
                    {goal.title}
                    {progressPercent > 0 && (
                      <span className="sidebar-goal-progress">{progressPercent}%</span>
                    )}
                  </span>
                </button>
              );
            })}
            {everydayCount > 0 && (
              <button
                className={`sidebar-item ${currentView === "planning" ? "" : ""}`}
                onClick={() => setView("planning")}
              >
                <CheckSquare size={18} />
                <span>{t.goalTypes?.everydayTasks || "Everyday"} <span className="sidebar-count">{everydayCount}</span></span>
              </button>
            )}
          </>
        )}
      </nav>

      <div className="sidebar-footer">
        {updateVersion && (
          <button
            type="button"
            className="sidebar-update-badge"
            onClick={handleOpenReleases}
            title={`Click to download NorthStar ${updateVersion}`}
          >
            <Download size={14} />
            <span>Update available · {updateVersion}</span>
          </button>
        )}
        <div className="sidebar-user">
          <CalendarDays size={14} />
          <span className="sidebar-date">
            {new Date().toLocaleDateString(getDateLocale(lang), {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </span>
        </div>
      </div>
    </aside>
  );
}
