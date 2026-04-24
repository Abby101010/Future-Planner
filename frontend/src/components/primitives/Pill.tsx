/* Pill — small inline badge with tonal variants. */

import type { CSSProperties, ReactNode } from "react";
import Icon, { type IconName } from "./Icon";

export type PillTone = "base" | "gold" | "navy" | "success" | "warn" | "danger" | "info";

export interface PillProps {
  tone?: PillTone;
  icon?: IconName;
  children?: ReactNode;
  style?: CSSProperties;
  mono?: boolean;
  title?: string;
}

const pillStyles: Record<string, CSSProperties> = {
  base: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "1px 7px",
    borderRadius: "var(--r-pill)",
    fontSize: "var(--t-xs)",
    fontWeight: 500,
    border: "1px solid var(--border)",
    color: "var(--fg-mute)",
    background: "var(--bg-elev)",
    whiteSpace: "nowrap",
    flexShrink: 0,
    lineHeight: 1.6,
  },
  gold: { color: "var(--accent)", borderColor: "var(--gold-line)", background: "var(--gold-faint)" },
  navy: { color: "var(--white)", background: "var(--navy)", borderColor: "transparent" },
  success: { color: "var(--success)", borderColor: "color-mix(in srgb, var(--success) 25%, transparent)", background: "color-mix(in srgb, var(--success) 8%, transparent)" },
  warn: { color: "var(--accent)", background: "var(--gold-faint)", borderColor: "var(--gold-line-faint)" },
  danger: { color: "var(--danger)", borderColor: "color-mix(in srgb, var(--danger) 30%, transparent)", background: "color-mix(in srgb, var(--danger) 8%, transparent)" },
  info: { color: "var(--info)", borderColor: "color-mix(in srgb, var(--info) 28%, transparent)", background: "color-mix(in srgb, var(--info) 7%, transparent)" },
  mono: { fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: 0, padding: "1px 5px", borderRadius: 3 },
};

export default function Pill({ tone = "base", icon, children, style, mono, title }: PillProps) {
  const s: CSSProperties = {
    ...pillStyles.base,
    ...(tone !== "base" ? pillStyles[tone] : {}),
    ...(mono ? pillStyles.mono : {}),
    ...style,
  };
  return (
    <span title={title} style={s}>
      {icon && <Icon name={icon} size={10} />}
      {children}
    </span>
  );
}
