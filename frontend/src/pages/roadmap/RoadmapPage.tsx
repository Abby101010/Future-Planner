/* RoadmapPage — designed 12-month goal timeline.
 *
 * Per contract (line 177-180): Roadmap is a legacy user-level timeline.
 * Read-only; GET /view/roadmap on mount; refresh button refetches.
 */

import TopBar from "../../components/primitives/TopBar";
import Button from "../../components/primitives/Button";
import { useQuery } from "../../hooks/useQuery";

interface RoadmapSegment {
  start: number; // month index 0..11
  end: number;
  label: string;
  status: "done" | "active" | "upcoming" | "paused";
}
interface RoadmapRow {
  id: string;
  title: string;
  icon: string;
  segments: RoadmapSegment[];
}
interface RoadmapView {
  rows?: RoadmapRow[];
  months?: string[];
  /** Numeric "today" marker — 0 to 12, one decimal allowed (e.g. 6.7 for late Jun). */
  today?: number;
}

const DEFAULT_MONTHS = ["Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep"];

const STATUS_COLOR: Record<RoadmapSegment["status"], { bg: string; border: string; dot: string }> = {
  done: {
    bg: "color-mix(in srgb, var(--success) 12%, var(--bg-elev))",
    border: "color-mix(in srgb, var(--success) 30%, transparent)",
    dot: "var(--success)",
  },
  active: { bg: "var(--gold-faint)", border: "var(--gold-line)", dot: "var(--accent)" },
  upcoming: { bg: "var(--bg-soft)", border: "var(--border)", dot: "var(--fg-faint)" },
  paused: { bg: "var(--bg-sunken)", border: "var(--border-soft)", dot: "var(--fg-faint)" },
};

export default function RoadmapPage() {
  const { data, loading, error, refetch } = useQuery<RoadmapView>("view:roadmap");
  const rows = data?.rows ?? [];
  const months = data?.months ?? DEFAULT_MONTHS;
  const today = typeof data?.today === "number" ? data.today : 6;

  return (
    <>
      <TopBar
        eyebrow="12-month view · across all active goals"
        title="Roadmap"
        right={
          <Button
            size="sm"
            tone="ghost"
            icon="refresh"
            onClick={refetch}
            data-api="GET /view/roadmap"
            data-testid="roadmap-refetch"
          >
            Refresh
          </Button>
        }
      />
      <div style={{ maxWidth: 1280, margin: "0 auto", width: "100%", padding: "24px 32px 96px" }}>
        {loading && !data && (
          <div data-testid="roadmap-loading" style={{ padding: 40, textAlign: "center", color: "var(--fg-faint)" }}>
            Loading roadmap…
          </div>
        )}
        {error && (
          <div data-testid="roadmap-error" style={{ padding: 20, color: "var(--danger)", fontFamily: "var(--font-mono)", fontSize: 11 }}>
            {String(error)}
          </div>
        )}
        {!loading && !error && rows.length === 0 && (
          <div data-testid="roadmap-empty" style={{ padding: 40, textAlign: "center", color: "var(--fg-faint)" }}>
            No goals on the roadmap yet.
          </div>
        )}
        {rows.length > 0 && (
          <div
            data-testid="roadmap-grid"
            style={{
              background: "var(--bg-elev)",
              border: "1px solid var(--border)",
              borderRadius: "var(--r-md)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "220px repeat(12, 1fr)",
                background: "var(--bg-soft)",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <div
                style={{
                  padding: "10px 16px",
                  fontSize: 10,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: "var(--fg-faint)",
                  fontWeight: 600,
                }}
              >
                Goal
              </div>
              {months.map((m, i) => (
                <div
                  key={`${m}-${i}`}
                  style={{
                    padding: "10px 4px",
                    textAlign: "center",
                    fontSize: 10,
                    letterSpacing: "0.12em",
                    color: Math.floor(today) === i ? "var(--accent)" : "var(--fg-faint)",
                    textTransform: "uppercase",
                    fontWeight: 600,
                    borderLeft: "1px solid var(--border-soft)",
                  }}
                >
                  {m}
                </div>
              ))}
            </div>

            {rows.map((r) => (
              <div
                key={r.id}
                data-testid={`roadmap-row-${r.id}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "220px repeat(12, 1fr)",
                  borderBottom: "1px solid var(--border-soft)",
                  minHeight: 68,
                }}
              >
                <div
                  style={{
                    padding: "16px",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    borderRight: "1px solid var(--border-soft)",
                  }}
                >
                  <span style={{ fontSize: 18 }}>{r.icon}</span>
                  <span style={{ fontSize: "var(--t-sm)", color: "var(--user-color)", fontWeight: 500 }}>{r.title}</span>
                </div>
                <div style={{ gridColumn: "2 / -1", position: "relative", padding: "14px 0" }}>
                  {months.map((_, i) => (
                    <div
                      key={i}
                      style={{
                        position: "absolute",
                        top: 0,
                        bottom: 0,
                        left: `${(i / 12) * 100}%`,
                        width: 1,
                        background: "var(--border-soft)",
                      }}
                    />
                  ))}
                  <div
                    style={{
                      position: "absolute",
                      top: 0,
                      bottom: 0,
                      left: `${(today / 12) * 100}%`,
                      width: 2,
                      background: "var(--accent)",
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        top: -8,
                        left: -18,
                        fontSize: 9,
                        color: "var(--accent)",
                        fontWeight: 700,
                        letterSpacing: "0.08em",
                      }}
                    >
                      NOW
                    </div>
                  </div>
                  {r.segments.map((s, i) => {
                    const c = STATUS_COLOR[s.status];
                    return (
                      <div
                        key={i}
                        data-testid={`roadmap-segment-${r.id}-${i}`}
                        title={`${s.label} · ${s.status}`}
                        style={{
                          position: "absolute",
                          top: 14,
                          height: 40,
                          left: `${(s.start / 12) * 100}%`,
                          width: `${((s.end - s.start) / 12) * 100}%`,
                          background: c.bg,
                          border: `1px solid ${c.border}`,
                          borderLeft: `3px solid ${c.dot}`,
                          borderRadius: 3,
                          padding: "4px 8px",
                          overflow: "hidden",
                          fontSize: 11,
                          fontWeight: 500,
                          color: "var(--fg)",
                        }}
                      >
                        {s.label}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: 14, marginTop: 12, fontSize: 10, color: "var(--fg-faint)" }}>
          {(["done", "active", "upcoming", "paused"] as const).map((l) => (
            <span key={l} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 2,
                  background: STATUS_COLOR[l].dot,
                }}
              />
              {l}
            </span>
          ))}
        </div>
      </div>
    </>
  );
}
