/* Sidebar — designed, collapsible nav.
 *
 * Layout (per prototype):
 *   PROFILE (top) → opens two-tier Settings popup
 *   [Workspace]
 *     Tasks
 *     Calendar
 *     Planning
 *     News Feed (hidden when settings.enableNewsFeed === false)
 *   [collapse/expand toggle]
 *   ★ Starward (bottom logo)
 *
 * Width: 64px collapsed, 224px expanded. 180ms width transition.
 *
 * Two-mode interaction:
 *   - "rest" (isSidebarCollapsed=true, default) — icons only at rest;
 *     hovering the cursor over the sidebar expands it to full width.
 *     Cursor leaves → collapses back.
 *   - "pinned" (isSidebarCollapsed=false) — sidebar stays expanded
 *     regardless of hover. The toggle button (chevron) flips between
 *     the two modes.
 *
 * Top padding clears the macOS traffic lights placed at
 * trafficLightPosition (16, 16) by `frontend/electron/main.ts`. ~44px
 * gives ~14px breathing room below the buttons; harmless on platforms
 * without a hidden-inset title bar.
 *
 * Reads view:settings for `enableNewsFeed`.
 * Writes currentView / isSidebarCollapsed / isSettingsOpen to the Zustand store.
 */

import { useState } from "react";
import useStore from "../store/useStore";
import { useQuery } from "../hooks/useQuery";
import type { AppView } from "@starward/core";
import Icon, { type IconName } from "./primitives/Icon";

interface SettingsView {
  user?: { settings?: { enableNewsFeed?: boolean } };
}

interface NavItem {
  id: AppView;
  label: string;
  icon: IconName;
  view: string;
}

export default function Sidebar() {
  const currentView = useStore((s) => s.currentView);
  const setView = useStore((s) => s.setView);
  const pinned = !useStore((s) => s.isSidebarCollapsed);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);

  // Local hover peek: when the user has NOT pinned the sidebar open,
  // entering with the cursor expands it; leaving collapses it back.
  // Pinned state ignores hover and stays expanded.
  const [hovering, setHovering] = useState(false);
  const collapsed = !pinned && !hovering;

  const { data: settingsView } = useQuery<SettingsView>("view:settings");
  const enableNewsFeed = settingsView?.user?.settings?.enableNewsFeed !== false;

  const items: NavItem[] = [
    { id: "tasks", label: "Tasks", icon: "tasks", view: "view:tasks" },
    { id: "calendar", label: "Calendar", icon: "calendar", view: "view:calendar" },
    { id: "planning", label: "Planning", icon: "planning", view: "view:planning" },
    ...(enableNewsFeed
      ? [{ id: "news-feed" as AppView, label: "News Feed", icon: "news" as IconName, view: "view:news-feed" }]
      : []),
  ];

  const width = collapsed ? 64 : 224;
  // Consider goal-plan-${id} and goal-dashboard-${id} sub-routes as "planning".
  const activeId: string = currentView.startsWith("goal-plan-") || currentView.startsWith("goal-dashboard-")
    ? "planning"
    : currentView;

  return (
    <nav
      data-testid="sidebar-nav"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      style={{
        width,
        flexShrink: 0,
        borderRight: "1px solid var(--border)",
        background: "var(--bg)",
        // 44px top clears the macOS traffic-light buttons positioned
        // at (16, 16) by the Electron config (main.ts:83). 10px bottom
        // is unchanged.
        padding: "44px 0 10px",
        display: "flex",
        flexDirection: "column",
        position: "sticky",
        top: 0,
        height: "100vh",
        transition: "width 180ms ease",
        alignSelf: "flex-start",
      }}
    >
      {/* TOP: profile + collapse toggle */}
      <div
        style={{
          padding: collapsed ? "0 10px 10px" : "0 10px 14px",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <button
          data-testid="sidebar-profile"
          onClick={() => setSettingsOpen(true)}
          title="Open settings"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: collapsed ? 4 : "6px 8px",
            border: 0,
            background: "transparent",
            cursor: "pointer",
            borderRadius: "var(--r-md)",
            flex: 1,
            minWidth: 0,
            color: "var(--fg)",
            textAlign: "left",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-soft)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: "50%",
              background: "var(--navy)",
              color: "var(--white)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 11,
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            SY
          </div>
          {!collapsed && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                lineHeight: 1.2,
                minWidth: 0,
                flex: 1,
              }}
            >
              <span
                style={{
                  fontSize: "var(--t-sm)",
                  fontWeight: 600,
                  color: "var(--fg)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                Starward
              </span>
              <span
                style={{
                  fontSize: 10,
                  color: "var(--fg-faint)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                settings
              </span>
            </div>
          )}
          {!collapsed && (
            <Icon name="settings" size={12} style={{ color: "var(--fg-faint)", flexShrink: 0 }} />
          )}
        </button>
        {!collapsed && (
          <button
            data-testid="sidebar-collapse"
            onClick={toggleSidebar}
            title={pinned ? "Unpin (collapse on cursor leave)" : "Pin sidebar open"}
            style={{
              border: 0,
              background: "transparent",
              cursor: "pointer",
              color: "var(--fg-faint)",
              padding: 4,
              flexShrink: 0,
            }}
          >
            <Icon name="chevron-left" size={14} />
          </button>
        )}
      </div>

      {collapsed && (
        <button
          data-testid="sidebar-expand"
          onClick={toggleSidebar}
          title="Pin sidebar open"
          style={{
            margin: "0 14px 10px",
            border: "1px solid var(--border)",
            background: "var(--bg-elev)",
            cursor: "pointer",
            color: "var(--fg-mute)",
            padding: "4px 0",
            borderRadius: 4,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name="chevron-right" size={12} />
        </button>
      )}

      {!collapsed && (
        <div
          style={{
            padding: "0 18px 8px",
            fontSize: 10,
            letterSpacing: "0.14em",
            color: "var(--fg-faint)",
            textTransform: "uppercase",
            fontWeight: 600,
          }}
        >
          Workspace
        </div>
      )}

      {items.map((it) => {
        const active = activeId === it.id;
        return (
          <button
            key={it.id}
            data-testid={`sidebar-${it.id}`}
            data-active={active ? "true" : "false"}
            onClick={() => setView(it.id)}
            title={collapsed ? it.label : undefined}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: collapsed ? "10px 0" : "8px 14px",
              margin: "0 10px",
              border: 0,
              background: active ? "var(--navy-tint)" : "transparent",
              cursor: "pointer",
              justifyContent: collapsed ? "center" : "flex-start",
              color: active ? "var(--fg)" : "var(--fg-mute)",
              fontSize: "var(--t-md)",
              fontWeight: active ? 600 : 500,
              borderRadius: "var(--r-md)",
              position: "relative",
            }}
            onMouseEnter={(e) => {
              if (!active) e.currentTarget.style.background = "var(--bg-soft)";
            }}
            onMouseLeave={(e) => {
              if (!active) e.currentTarget.style.background = "transparent";
            }}
          >
            {active && (
              <span
                style={{
                  position: "absolute",
                  left: -10,
                  top: 6,
                  bottom: 6,
                  width: 2,
                  background: "var(--accent)",
                }}
              />
            )}
            <Icon name={it.icon} size={16} />
            {!collapsed && <span>{it.label}</span>}
          </button>
        );
      })}

      <div style={{ flex: 1 }} />

      {/* BOTTOM: minimized logo */}
      <div
        style={{
          padding: collapsed ? "10px 0" : "12px 16px",
          borderTop: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          justifyContent: collapsed ? "center" : "flex-start",
          color: "var(--fg-faint)",
        }}
      >
        <div style={{ color: "var(--accent)", display: "flex", flexShrink: 0 }}>
          <Icon name="north-star" size={16} stroke={1.5} />
        </div>
        {!collapsed && (
          <span
            style={{
              fontSize: 10,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              fontWeight: 600,
            }}
          >
            Starward
          </span>
        )}
      </div>
    </nav>
  );
}
