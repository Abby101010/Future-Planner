/* TopBar — page header with eyebrow, title, optional breadcrumbs, right actions. */

import { Fragment, type ReactNode } from "react";
import Icon from "./Icon";

export interface Breadcrumb {
  label: string;
  onClick?: () => void;
}

export interface TopBarProps {
  title: ReactNode;
  eyebrow?: ReactNode;
  right?: ReactNode;
  breadcrumbs?: Breadcrumb[];
}

export default function TopBar({ title, eyebrow, right, breadcrumbs }: TopBarProps) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        flexWrap: "wrap",
        padding: "24px 32px 16px",
        borderBottom: "1px solid var(--border)",
        gap: 16,
        background: "var(--bg)",
        flexShrink: 0,
      }}
    >
      <div style={{ minWidth: 0 }}>
        {breadcrumbs && breadcrumbs.length > 0 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: "var(--t-xs)",
              color: "var(--fg-faint)",
              marginBottom: 6,
              fontWeight: 500,
            }}
          >
            {breadcrumbs.map((b, i) => (
              <Fragment key={i}>
                <span
                  onClick={b.onClick}
                  style={{
                    cursor: b.onClick ? "pointer" : "default",
                    color: i === breadcrumbs.length - 1 ? "var(--fg-mute)" : "var(--fg-faint)",
                  }}
                >
                  {b.label}
                </span>
                {i < breadcrumbs.length - 1 && <Icon name="chevron-right" size={10} />}
              </Fragment>
            ))}
          </div>
        )}
        {eyebrow && (
          <div
            style={{
              fontSize: 10,
              letterSpacing: "0.18em",
              color: "var(--fg-faint)",
              textTransform: "uppercase",
              marginBottom: 6,
              fontWeight: 600,
            }}
          >
            {eyebrow}
          </div>
        )}
        <h1
          className="h-display"
          style={{ margin: 0, fontSize: "var(--t-3xl)", color: "var(--fg)", lineHeight: 1.08 }}
        >
          {title}
        </h1>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>{right}</div>
    </header>
  );
}
