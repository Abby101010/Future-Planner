/* Banner — inline alert (info | pace | overload | success). */

import type { ReactNode } from "react";
import Icon, { type IconName } from "./Icon";

export type BannerTone = "info" | "pace" | "overload" | "success";

export interface BannerProps {
  tone?: BannerTone;
  title?: string;
  body?: ReactNode;
  action?: ReactNode;
  icon?: IconName;
  onDismiss?: () => void;
}

const tones: Record<BannerTone, { bg: string; border: string; accent: string }> = {
  info: { bg: "var(--navy-tint)", border: "var(--border)", accent: "var(--navy-mid)" },
  pace: { bg: "var(--gold-faint)", border: "var(--gold-line-faint)", accent: "var(--accent)" },
  overload: {
    bg: "color-mix(in srgb, var(--danger) 6%, var(--bg))",
    border: "color-mix(in srgb, var(--danger) 22%, transparent)",
    accent: "var(--danger)",
  },
  success: {
    bg: "color-mix(in srgb, var(--success) 8%, var(--bg))",
    border: "color-mix(in srgb, var(--success) 25%, transparent)",
    accent: "var(--success)",
  },
};

export default function Banner({
  tone = "info",
  title,
  body,
  action,
  icon = "info",
  onDismiss,
}: BannerProps) {
  const t = tones[tone];
  return (
    <div
      style={{
        display: "flex",
        gap: "var(--s-3)",
        alignItems: "flex-start",
        padding: "var(--s-3) var(--s-4)",
        background: t.bg,
        border: `1px solid ${t.border}`,
        borderRadius: "var(--r-md)",
        borderLeft: `3px solid ${t.accent}`,
      }}
    >
      <div style={{ color: t.accent, paddingTop: 1 }}>
        <Icon name={icon} size={15} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {title && (
          <div style={{ fontSize: "var(--t-md)", fontWeight: 600, color: "var(--fg)", marginBottom: 2 }}>
            {title}
          </div>
        )}
        {body && <div style={{ fontSize: "var(--t-sm)", color: "var(--fg-mute)", lineHeight: 1.5 }}>{body}</div>}
      </div>
      {action && <div style={{ flexShrink: 0 }}>{action}</div>}
      {onDismiss && (
        <button
          onClick={onDismiss}
          style={{ border: 0, background: "transparent", cursor: "pointer", color: "var(--fg-faint)", padding: 2 }}
        >
          <Icon name="x" size={14} />
        </button>
      )}
    </div>
  );
}
