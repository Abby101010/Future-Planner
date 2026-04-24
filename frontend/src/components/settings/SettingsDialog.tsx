/* SettingsDialog — two-tier floating settings popup.
 *
 * Tier 1: small menu (244px) floating near the sidebar profile
 * Tier 2: section popup (440px) — renders a single `SettingsPage` section
 *         via the `section` prop
 *
 * Non-modal: no backdrop, no blur, rest of app stays clickable. Esc and
 * outside-click both dismiss. */

import { useEffect, useRef, useState } from "react";
import useStore from "../../store/useStore";
import Icon, { type IconName } from "../primitives/Icon";
import SettingsPage, { type SettingsSection } from "../../pages/settings/SettingsPage";

interface SectionMeta {
  id: SettingsSection;
  label: string;
  icon: IconName;
  hint: string;
}

const SECTIONS: SectionMeta[] = [
  { id: "general", label: "General", icon: "settings", hint: "Appearance, timezone, notifications" },
  { id: "planning", label: "Planning", icon: "planning", hint: "Work hours, vacation mode" },
  { id: "memory", label: "Memory", icon: "brain", hint: "Facts, preferences, reflection" },
  { id: "monthly", label: "Monthly context", icon: "calendar", hint: "Per-month travel / capacity notes" },
  { id: "account", label: "Account", icon: "power", hint: "Session, danger zone" },
];

export default function SettingsDialog() {
  const open = useStore((s) => s.isSettingsOpen);
  const setOpen = useStore((s) => s.setSettingsOpen);
  const [section, setSection] = useState<SettingsSection | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      setSection(null);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (section) setSection(null);
      else setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      const active = section ? popupRef : menuRef;
      if (active.current && !active.current.contains(e.target as Node)) {
        if (section) setSection(null);
        else setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    const t = window.setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(t);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open, section, setOpen]);

  if (!open) return null;

  if (!section) {
    return (
      <div
        ref={menuRef}
        data-testid="settings-menu"
        role="menu"
        aria-label="Settings"
        style={{
          position: "fixed",
          left: 76,
          top: 16,
          zIndex: 70,
          width: 244,
          background: "var(--bg-elev)",
          border: "1px solid var(--border)",
          borderRadius: "var(--r-md)",
          boxShadow: "0 12px 32px rgba(13, 20, 36, 0.18)",
          padding: 6,
          animation: "ns-slide-up .14s ease",
        }}
      >
        <div
          style={{
            padding: "8px 10px 10px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: "1px solid var(--border-soft)",
            marginBottom: 4,
          }}
        >
          <span
            style={{
              fontSize: 10,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "var(--fg-faint)",
              fontWeight: 600,
            }}
          >
            Settings
          </span>
          <button
            data-testid="settings-close"
            onClick={() => setOpen(false)}
            aria-label="Close"
            style={{
              border: 0,
              background: "transparent",
              cursor: "pointer",
              color: "var(--fg-faint)",
              padding: 2,
              display: "flex",
            }}
          >
            <Icon name="x" size={12} />
          </button>
        </div>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            data-testid={`settings-section-${s.id}`}
            role="menuitem"
            onClick={() => setSection(s.id)}
            data-api="GET /view/settings"
            style={{
              width: "100%",
              textAlign: "left",
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 10px",
              border: 0,
              background: "transparent",
              cursor: "pointer",
              borderRadius: 4,
              color: "var(--fg)",
              fontSize: "var(--t-sm)",
              fontFamily: "inherit",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-soft)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <Icon name={s.icon} size={14} style={{ color: "var(--fg-mute)", flexShrink: 0 }} />
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                lineHeight: 1.3,
                minWidth: 0,
                flex: 1,
              }}
            >
              <span style={{ fontWeight: 500 }}>{s.label}</span>
              <span
                style={{
                  fontSize: 10,
                  color: "var(--fg-faint)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {s.hint}
              </span>
            </div>
            <Icon name="chevron-right" size={11} style={{ color: "var(--fg-faint)" }} />
          </button>
        ))}
      </div>
    );
  }

  const active = SECTIONS.find((s) => s.id === section)!;
  return (
    <div
      ref={popupRef}
      data-testid={`settings-popup-${section}`}
      role="dialog"
      aria-modal="false"
      aria-label={`${active.label} settings`}
      style={{
        position: "fixed",
        left: 76,
        top: 16,
        zIndex: 70,
        width: 440,
        maxHeight: "calc(100vh - 32px)",
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: "var(--r-md)",
        boxShadow: "0 16px 40px rgba(13, 20, 36, 0.22)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        animation: "ns-slide-up .14s ease",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 14px",
          borderBottom: "1px solid var(--border-soft)",
          background: "var(--bg-elev)",
        }}
      >
        <button
          data-testid="settings-back"
          onClick={() => setSection(null)}
          title="Back to settings menu"
          style={{
            border: 0,
            background: "transparent",
            cursor: "pointer",
            color: "var(--fg-faint)",
            padding: 2,
            display: "flex",
          }}
        >
          <Icon name="chevron-left" size={14} />
        </button>
        <Icon name={active.icon} size={14} style={{ color: "var(--fg-mute)" }} />
        <span
          style={{
            fontSize: "var(--t-md)",
            fontWeight: 600,
            color: "var(--fg)",
            flex: 1,
          }}
        >
          {active.label}
        </span>
        <button
          onClick={() => setOpen(false)}
          aria-label="Close settings"
          style={{
            border: 0,
            background: "transparent",
            cursor: "pointer",
            color: "var(--fg-faint)",
            padding: 2,
            display: "flex",
          }}
        >
          <Icon name="x" size={14} />
        </button>
      </header>
      <div style={{ overflow: "auto", flex: 1 }}>
        <SettingsPage section={section} compact />
      </div>
    </div>
  );
}
