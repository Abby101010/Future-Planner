/* Sidebar — bare nav. Buttons switch currentView via the store.
 *
 * Top-level entries (intended structure): tasks, calendar, planning, roadmap,
 * news-feed, settings. News-feed is conditionally hidden based on the
 * user.settings.enableNewsFeed flag read from view:settings. */

import useStore from "../store/useStore";
import { useQuery } from "../hooks/useQuery";
import type { AppView } from "@starward/core";

const VIEWS: { view: AppView; label: string }[] = [
  { view: "tasks", label: "tasks" },
  { view: "calendar", label: "calendar" },
  { view: "planning", label: "planning" },
  { view: "roadmap", label: "roadmap" },
  { view: "news-feed", label: "news-feed" },
  { view: "settings", label: "settings" },
];

interface SettingsView {
  user?: { settings?: { enableNewsFeed?: boolean } };
}

export default function Sidebar() {
  const currentView = useStore((s) => s.currentView);
  const setView = useStore((s) => s.setView);
  const { data: settingsView } = useQuery<SettingsView>("view:settings");
  const enableNewsFeed =
    settingsView?.user?.settings?.enableNewsFeed !== false; // default ON

  const visibleViews = VIEWS.filter(
    (v) => v.view !== "news-feed" || enableNewsFeed,
  );

  return (
    <nav className="sidebar-nav" data-testid="sidebar-nav">
      <ul className="sidebar-list">
        {visibleViews.map(({ view, label }) => (
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
