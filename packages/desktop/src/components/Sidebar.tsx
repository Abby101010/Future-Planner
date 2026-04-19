/* Sidebar — bare nav. Buttons switch currentView via the store. */

import useStore from "../store/useStore";
import type { AppView } from "@northstar/core";

const VIEWS: { view: AppView; label: string }[] = [
  { view: "tasks", label: "tasks" },
  { view: "calendar", label: "calendar" },
  { view: "planning", label: "planning" },
  { view: "roadmap", label: "roadmap" },
  { view: "news-feed", label: "news-feed" },
  { view: "settings", label: "settings" },
  { view: "onboarding", label: "onboarding" },
];

export default function Sidebar() {
  const currentView = useStore((s) => s.currentView);
  const setView = useStore((s) => s.setView);
  return (
    <nav>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {VIEWS.map(({ view, label }) => (
          <li key={view}>
            <button
              onClick={() => setView(view)}
              style={{ fontWeight: currentView === view ? "bold" : "normal" }}
            >
              {label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
