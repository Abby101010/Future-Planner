/* Card — sectioned container with optional header (eyebrow, title, action). */

import type { CSSProperties, ReactNode } from "react";

export type CardTone = "default" | "soft" | "ambient";

export interface CardProps {
  title?: ReactNode;
  eyebrow?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  padded?: boolean;
  tone?: CardTone;
  style?: CSSProperties;
}

const surfaces: Record<CardTone, CSSProperties> = {
  default: { background: "var(--bg-elev)", border: "1px solid var(--border)" },
  soft: { background: "var(--bg-soft)", border: "1px solid transparent" },
  ambient: { background: "var(--bg-rail)", border: "1px solid var(--border-soft)" },
};

export default function Card({
  title,
  eyebrow,
  action,
  children,
  padded = true,
  tone = "default",
  style,
}: CardProps) {
  return (
    <section style={{ ...surfaces[tone], borderRadius: "var(--r-md)", ...style }}>
      {(title || eyebrow || action) && (
        <header
          style={{
            padding: "10px 14px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: tone === "soft" ? "none" : "1px solid var(--border-soft)",
          }}
        >
          <div>
            {eyebrow && (
              <div
                style={{
                  fontSize: 10,
                  letterSpacing: "0.16em",
                  color: "var(--fg-faint)",
                  textTransform: "uppercase",
                  fontWeight: 600,
                }}
              >
                {eyebrow}
              </div>
            )}
            {title && (
              <div
                style={{
                  fontSize: "var(--t-md)",
                  fontWeight: 600,
                  color: "var(--fg)",
                  marginTop: eyebrow ? 2 : 0,
                }}
              >
                {title}
              </div>
            )}
          </div>
          {action}
        </header>
      )}
      <div style={{ padding: padded ? 14 : 0 }}>{children}</div>
    </section>
  );
}
