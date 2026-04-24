/* Button — designed button with tonal and size variants + optional icons. */

import type { CSSProperties, MouseEventHandler, ReactNode } from "react";
import Icon, { type IconName } from "./Icon";

export type ButtonTone = "base" | "primary" | "gold" | "goldFill" | "ghost" | "danger";
export type ButtonSize = "xs" | "sm" | "lg";

export interface ButtonProps {
  tone?: ButtonTone;
  size?: ButtonSize;
  icon?: IconName;
  iconRight?: IconName;
  children?: ReactNode;
  style?: CSSProperties;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  title?: string;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
  /** data-api attribute for debugging — shows which contract endpoint this triggers. */
  "data-api"?: string;
  "data-testid"?: string;
}

const btnStyles: Record<string, CSSProperties> = {
  base: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "7px 12px",
    border: "1px solid var(--border-strong)",
    background: "var(--bg-elev)",
    color: "var(--fg)",
    borderRadius: "var(--r-md)",
    cursor: "pointer",
    fontSize: "var(--t-md)",
    fontWeight: 500,
    transition: "background .12s, border-color .12s, color .12s",
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  primary: { background: "var(--navy)", color: "var(--white)", borderColor: "var(--navy)" },
  gold: { background: "transparent", color: "var(--accent)", borderColor: "var(--gold-line)" },
  goldFill: { background: "var(--accent)", color: "var(--white)", borderColor: "var(--accent)" },
  ghost: { background: "transparent", border: "1px solid transparent", color: "var(--fg-mute)" },
  danger: { background: "transparent", color: "var(--danger)", borderColor: "color-mix(in srgb, var(--danger) 35%, transparent)" },
  sm: { padding: "4px 9px", fontSize: "var(--t-sm)" },
  xs: { padding: "2px 7px", fontSize: "var(--t-xs)" },
  lg: { padding: "10px 18px", fontSize: "var(--t-lg)" },
};

export default function Button({
  tone = "base",
  size,
  icon,
  iconRight,
  children,
  style,
  onClick,
  title,
  disabled,
  type = "button",
  "data-api": dataApi,
  "data-testid": dataTestid,
}: ButtonProps) {
  const merged: CSSProperties = {
    ...btnStyles.base,
    ...(tone !== "base" ? btnStyles[tone] : {}),
    ...(size ? btnStyles[size] : {}),
    ...(disabled ? { opacity: 0.45, cursor: "not-allowed" } : {}),
    ...style,
  };
  return (
    <button
      type={type}
      title={title}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={merged}
      data-api={dataApi}
      data-testid={dataTestid}
    >
      {icon && <Icon name={icon} size={14} />}
      {children}
      {iconRight && <Icon name={iconRight} size={14} />}
    </button>
  );
}
