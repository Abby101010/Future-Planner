/* Icon — SVG icon set ported from the Starward design prototype.
 * Every path is stroke-only (fill: currentColor on the dots where noted).
 * Add new icons by adding a case to the switch. */

import type { CSSProperties } from "react";

export type IconName =
  | "tasks" | "calendar" | "planning" | "news" | "settings"
  | "chat" | "plus" | "check" | "circle"
  | "chevron-right" | "chevron-left" | "chevron-down" | "chevron-up"
  | "north-star" | "bolt" | "sparkle" | "dot" | "refresh"
  | "trash" | "clock" | "skip" | "x" | "pause" | "play"
  | "image" | "bell" | "edit" | "tag" | "target" | "tree"
  | "search" | "arrow-right" | "arrow-left" | "google" | "link"
  | "upload" | "download" | "info" | "alert" | "brain" | "grip"
  | "dev" | "power";

export interface IconProps {
  name: IconName;
  size?: number;
  stroke?: number;
  style?: CSSProperties;
  className?: string;
}

export default function Icon({ name, size = 16, stroke = 1.5, style, className }: IconProps) {
  const props = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: stroke,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    style,
    className,
  };
  switch (name) {
    case "tasks": return (<svg {...props}><path d="M4 7h16M4 12h16M4 17h10"/><path d="M3 7.5l.8.8L5.2 7"/></svg>);
    case "calendar": return (<svg {...props}><rect x="3.5" y="5" width="17" height="15" rx="1"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/></svg>);
    case "planning": return (<svg {...props}><path d="M4 5h12M4 12h16M4 19h8"/><circle cx="19" cy="5" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>);
    case "news": return (<svg {...props}><rect x="3.5" y="4.5" width="17" height="15" rx="1"/><path d="M7 9h10M7 13h10M7 17h6"/></svg>);
    case "settings": return (<svg {...props}><circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/></svg>);
    case "chat": return (<svg {...props}><path d="M21 12c0 4.4-4 8-9 8a10.6 10.6 0 0 1-3.5-.6L4 21l1.5-3.7A8 8 0 0 1 3 12c0-4.4 4-8 9-8s9 3.6 9 8z"/></svg>);
    case "plus": return (<svg {...props}><path d="M12 5v14M5 12h14"/></svg>);
    case "check": return (<svg {...props}><path d="M5 12l5 5L19 7"/></svg>);
    case "circle": return (<svg {...props}><circle cx="12" cy="12" r="8"/></svg>);
    case "chevron-right": return (<svg {...props}><path d="M9 6l6 6-6 6"/></svg>);
    case "chevron-left": return (<svg {...props}><path d="M15 6l-6 6 6 6"/></svg>);
    case "chevron-down": return (<svg {...props}><path d="M6 9l6 6 6-6"/></svg>);
    case "chevron-up": return (<svg {...props}><path d="M6 15l6-6 6 6"/></svg>);
    case "north-star": return (<svg {...props}><path d="M12 2v8M12 14v8M2 12h8M14 12h8M5.5 5.5l4 4M14.5 14.5l4 4M5.5 18.5l4-4M14.5 9.5l4-4"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/></svg>);
    case "bolt": return (<svg {...props}><path d="M13 3L4 14h6l-1 7 9-11h-6l1-7z"/></svg>);
    case "sparkle": return (<svg {...props}><path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3z"/></svg>);
    case "dot": return (<svg {...props}><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/></svg>);
    case "refresh": return (<svg {...props}><path d="M20 11A8 8 0 0 0 6.3 6.3L4 8.5M4 4v4.5H8.5"/><path d="M4 13a8 8 0 0 0 13.7 4.7L20 15.5M20 20v-4.5h-4.5"/></svg>);
    case "trash": return (<svg {...props}><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>);
    case "clock": return (<svg {...props}><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>);
    case "skip": return (<svg {...props}><path d="M5 5v14l7-7-7-7z"/><path d="M15 5v14"/></svg>);
    case "x": return (<svg {...props}><path d="M6 6l12 12M18 6L6 18"/></svg>);
    case "pause": return (<svg {...props}><path d="M8 5v14M16 5v14"/></svg>);
    case "play": return (<svg {...props}><path d="M6 4l14 8-14 8z"/></svg>);
    case "image": return (<svg {...props}><rect x="3.5" y="4.5" width="17" height="15" rx="1"/><circle cx="9" cy="10" r="1.5"/><path d="M4 18l5-5 4 4 3-3 4 4"/></svg>);
    case "bell": return (<svg {...props}><path d="M6 10a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6zM10 20a2 2 0 0 0 4 0"/></svg>);
    case "edit": return (<svg {...props}><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4"/></svg>);
    case "tag": return (<svg {...props}><path d="M3 12V4h8l9 9-8 8-9-9z"/><circle cx="7" cy="8" r="1" fill="currentColor" stroke="none"/></svg>);
    case "target": return (<svg {...props}><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/></svg>);
    case "tree": return (<svg {...props}><path d="M12 3v4M12 11v4M12 11H6v4M12 11h6v4"/><circle cx="12" cy="4" r="1.5"/><circle cx="6" cy="16" r="1.5"/><circle cx="12" cy="16" r="1.5"/><circle cx="18" cy="16" r="1.5"/></svg>);
    case "search": return (<svg {...props}><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/></svg>);
    case "arrow-right": return (<svg {...props}><path d="M5 12h14M13 6l6 6-6 6"/></svg>);
    case "arrow-left": return (<svg {...props}><path d="M19 12H5M11 6l-6 6 6 6"/></svg>);
    case "google": return (<svg {...props}><path d="M21 12.2c0-.6-.1-1.3-.2-1.9H12v3.6h5.1c-.2 1.2-.9 2.2-1.9 2.9v2.4h3.1c1.8-1.7 2.8-4.1 2.8-7z"/><path d="M12 21c2.6 0 4.7-.9 6.3-2.3l-3.1-2.4c-.9.6-2 .9-3.2.9-2.5 0-4.5-1.7-5.3-3.9H3.6v2.5A9 9 0 0 0 12 21z"/></svg>);
    case "link": return (<svg {...props}><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.5 1.5M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.5-1.5"/></svg>);
    case "upload": return (<svg {...props}><path d="M12 16V4M7 9l5-5 5 5M4 20h16"/></svg>);
    case "download": return (<svg {...props}><path d="M12 4v12M7 11l5 5 5-5M4 20h16"/></svg>);
    case "info": return (<svg {...props}><circle cx="12" cy="12" r="8"/><path d="M12 8v.01M12 11v5"/></svg>);
    case "alert": return (<svg {...props}><path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.01"/></svg>);
    case "brain": return (<svg {...props}><path d="M9 4a3 3 0 0 0-3 3v1a3 3 0 0 0-2 3v1a3 3 0 0 0 2 3v1a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3v-1a3 3 0 0 0 2-3v-1a3 3 0 0 0-2-3V7a3 3 0 0 0-3-3z"/><path d="M12 4v16"/></svg>);
    case "grip": return (<svg {...props}><circle cx="9" cy="6" r="1" fill="currentColor"/><circle cx="15" cy="6" r="1" fill="currentColor"/><circle cx="9" cy="12" r="1" fill="currentColor"/><circle cx="15" cy="12" r="1" fill="currentColor"/><circle cx="9" cy="18" r="1" fill="currentColor"/><circle cx="15" cy="18" r="1" fill="currentColor"/></svg>);
    case "dev": return (<svg {...props}><path d="M8 8l-4 4 4 4M16 8l4 4-4 4M14 4l-4 16"/></svg>);
    case "power": return (<svg {...props}><path d="M12 4v8M8 6a7 7 0 1 0 8 0"/></svg>);
    default: return null;
  }
}
