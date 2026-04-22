/* Sidebar — bare nav. Buttons switch currentView via the store. */

import useStore from "../store/useStore";
import type { AppView } from "@northstar/core";

const VIEWS: { view: AppView; label: string }[] = [
  { view: "dashboard", label: "dashboard" },
  { view: "tasks", label: "tasks" },
  { view: "calendar", label: "calendar" },
  { view: "planning", label: "planning" },
  { view: "goal-breakdown", label: "goal-breakdown" },
  { view: "roadmap", label: "roadmap" },
  { view: "news-feed", label: "news-feed" },
  { view: "memory", label: "memory" },
  { view: "chat-sessions", label: "chat-sessions" },
  { view: "settings", label: "settings" },
  { view: "onboarding", label: "onboarding" },
];

export default function Sidebar() {
  const currentView = useStore((s) => s.currentView);
  const setView = useStore((s) => s.setView);
  return (
    <nav className="sidebar-nav" data-testid="sidebar-nav">
      <ul className="sidebar-list">
        {VIEWS.map(({ view, label }) => (
          <li key={view} className="sidebar-item">
            <button
              className={`sidebar-button${currentView === view ? " sidebar-button-active" : ""}`}
              data-testid={`sidebar-${view}`}
              data-active={currentView === view ? "true" : "false"}
              onClick={() => setView(view)}
            >
              {label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
