/* UpdateBadge — corner badge that appears when electron-updater
 * has downloaded a new version in the background.
 *
 * Behavior:
 *   - Listens for the "update:downloaded" IPC event (wired in
 *     electron/auto-updater.ts → electron/preload.ts).
 *   - When fired, shows a small, dismissible card in the bottom-right
 *     corner with the new version + concise release notes.
 *   - Click the X to dismiss for this session — the update STILL
 *     applies automatically on next app quit (Discord-style silent
 *     install). The badge is purely informational.
 *
 * Release notes can come back from electron-updater as either a
 * string (the GitHub release body) or an array of
 * { version, note } entries. We normalize both into a plain string
 * and trim aggressively (~280 chars) so the badge stays small.
 *
 * In dev mode the IPC event never fires (auto-updater is disabled
 * in dev — see auto-updater.ts:34). The component renders nothing
 * until an event arrives, so it's safe to mount unconditionally. */

import { useEffect, useState } from "react";

interface UpdateInfo {
  version: string;
  releaseNotes: string | { version: string; note?: string }[] | null;
  releaseName: string | null;
  releaseDate: string | null;
}

interface ElectronUpdaterAPI {
  onDownloaded: (callback: (info: UpdateInfo) => void) => () => void;
}

declare global {
  interface Window {
    electronUpdater?: ElectronUpdaterAPI;
  }
}

const NOTES_MAX_CHARS = 280;

function normalizeReleaseNotes(
  notes: UpdateInfo["releaseNotes"],
): string {
  if (!notes) return "";
  if (typeof notes === "string") {
    // Strip markdown headings + collapse whitespace; keep the first
    // bullet/sentence chunk so the badge stays scannable.
    const stripped = notes
      .replace(/^#+\s+/gm, "")
      .replace(/```[\s\S]*?```/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return stripped.length > NOTES_MAX_CHARS
      ? stripped.slice(0, NOTES_MAX_CHARS - 1) + "…"
      : stripped;
  }
  // Array form: pick the latest entry's note.
  const latest = notes[notes.length - 1];
  return latest?.note ? normalizeReleaseNotes(latest.note) : "";
}

export default function UpdateBadge() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const api = window.electronUpdater;
    if (!api) return; // not in Electron (web preview, etc.)
    const unsubscribe = api.onDownloaded((next) => {
      setInfo(next);
      setExpanded(false);
    });
    return unsubscribe;
  }, []);

  if (!info) return null;

  const notes = normalizeReleaseNotes(info.releaseNotes);

  return (
    <div
      data-testid="update-badge"
      style={{
        position: "fixed",
        bottom: 16,
        right: 16,
        zIndex: 100,
        maxWidth: 360,
        background: "var(--bg-elev)",
        border: "1px solid var(--accent)",
        borderLeft: "3px solid var(--accent)",
        borderRadius: "var(--r-md)",
        boxShadow: "var(--shadow-3, 0 8px 24px rgba(0,0,0,0.18))",
        padding: "10px 12px",
        fontSize: "var(--t-sm)",
        color: "var(--fg)",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        animation: "ns-slide-up .25s ease",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
          <span
            style={{
              fontSize: "var(--t-2xs)",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              fontWeight: 600,
              color: "var(--accent)",
            }}
          >
            Update ready
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--t-xs)",
              color: "var(--fg-mute)",
            }}
          >
            v{info.version}
          </span>
        </div>
        <button
          onClick={() => setInfo(null)}
          aria-label="Dismiss"
          title="Dismiss — update still applies on next quit"
          style={{
            border: 0,
            background: "transparent",
            color: "var(--fg-faint)",
            cursor: "pointer",
            fontSize: 14,
            lineHeight: 1,
            padding: 2,
            flexShrink: 0,
          }}
        >
          ✕
        </button>
      </div>
      <div
        style={{
          fontSize: "var(--t-xs)",
          color: "var(--fg-mute)",
          lineHeight: 1.45,
        }}
      >
        Will install when you quit. Restart anytime to apply.
      </div>
      {notes && (
        <>
          <div
            style={{
              fontSize: "var(--t-xs)",
              color: "var(--fg)",
              lineHeight: 1.5,
              maxHeight: expanded ? "none" : 60,
              overflow: "hidden",
              position: "relative",
            }}
          >
            {notes}
          </div>
          {notes.length > 120 && (
            <button
              onClick={() => setExpanded((e) => !e)}
              style={{
                alignSelf: "flex-start",
                border: 0,
                background: "transparent",
                color: "var(--fg-faint)",
                cursor: "pointer",
                fontSize: 10,
                padding: 0,
                textDecoration: "underline",
              }}
            >
              {expanded ? "less" : "what's new"}
            </button>
          )}
        </>
      )}
    </div>
  );
}
