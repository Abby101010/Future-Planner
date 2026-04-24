/* InsightCardView — renders one InsightCard from the backend.
 *
 * The backend's dashboardInsightAgent emits typed cards with a stable
 * `cardType` enum + a flexible `props` bag. This component owns the
 * visual contract for each cardType. Adding a new backend cardType?
 * Add a matching case here. Unknown types fall back to a labeled JSON
 * dump so backend developers can see the payload shape until we build
 * the renderer.
 *
 * Visual language follows DashboardTab.tsx — inline styles + var(--*)
 * tokens. Outer frame (gold-tinted pill) lives here so each card type
 * renders the *inside* only.
 */

import type { InsightCard } from "@starward/core";
import Pill from "../../components/primitives/Pill";
import Icon from "../../components/primitives/Icon";

// ── Shared frame ──────────────────────────────────────────

function CardFrame({
  card,
  children,
}: {
  card: InsightCard;
  children: React.ReactNode;
}) {
  return (
    <div
      data-testid={`dashboard-insight-${card.id}`}
      style={{
        padding: "12px 14px",
        background: "var(--gold-faint)",
        border: "1px solid var(--gold-line-faint)",
        borderRadius: "var(--r-md)",
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
      }}
    >
      <Icon name="sparkle" size={13} style={{ color: "var(--accent)", marginTop: 2 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: "var(--t-sm)",
            fontWeight: 600,
            color: "var(--fg)",
            marginBottom: 8,
          }}
        >
          {card.title}
        </div>
        {children}
      </div>
      <Pill mono>{card.cardType}</Pill>
    </div>
  );
}

// ── Typed prop shapes ────────────────────────────────────

interface PhaseTrackerProps {
  label?: string;
  phases?: Array<{ name: string; state?: "past" | "current" | "future" }>;
}
interface StreakProps {
  label?: string;
  currentStreak?: number;
  longestStreak?: number;
}
interface ChecklistProps {
  label?: string;
  items?: Array<{ text: string; done?: boolean }>;
}
interface CountdownProps {
  label?: string;
  targetDate?: string;
  captionWhenReached?: string;
}
interface ProgressBarProps {
  label?: string;
  percent?: number;
  current?: number;
  target?: number;
}
interface FunnelProps {
  label?: string;
  stages?: Array<{ name: string; count: number }>;
}
interface SummaryProps {
  label?: string;
  body?: string;
}

// ── Small shared atoms ───────────────────────────────────

function Caption({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, color: "var(--fg-faint)", marginTop: 2 }}>
      {children}
    </div>
  );
}

function BigNum({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="num-gold tnum"
      style={{ fontSize: 28, lineHeight: 1.1, fontWeight: 600 }}
    >
      {children}
    </span>
  );
}

// ── Per-type renderers ───────────────────────────────────

function PhaseTracker({ props }: { props: PhaseTrackerProps }) {
  const phases = props.phases ?? [];
  if (phases.length === 0) return <Caption>No phases yet.</Caption>;
  return (
    <>
      {props.label && <Caption>{props.label}</Caption>}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${phases.length}, 1fr)`,
          gap: 6,
          marginTop: 6,
        }}
      >
        {phases.map((p, i) => {
          const state = p.state ?? "future";
          const bg =
            state === "current"
              ? "var(--accent)"
              : state === "past"
              ? "var(--border-strong)"
              : "transparent";
          const color =
            state === "current"
              ? "var(--bg)"
              : state === "past"
              ? "var(--fg)"
              : "var(--fg-faint)";
          const border =
            state === "future" ? "1px dashed var(--border)" : "1px solid transparent";
          return (
            <div
              key={i}
              style={{
                background: bg,
                color,
                border,
                borderRadius: "var(--r-sm)",
                padding: "6px 8px",
                fontSize: 11,
                textAlign: "center",
                fontWeight: state === "current" ? 600 : 500,
              }}
            >
              {p.name}
            </div>
          );
        })}
      </div>
    </>
  );
}

function StreakCard({ props }: { props: StreakProps }) {
  const current = props.currentStreak ?? 0;
  const longest = props.longestStreak ?? 0;
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
      <BigNum>{current}</BigNum>
      <div>
        {props.label && (
          <div style={{ fontSize: 11, color: "var(--fg-mute)" }}>{props.label}</div>
        )}
        <Caption>longest {longest}</Caption>
      </div>
    </div>
  );
}

function Checklist({ props }: { props: ChecklistProps }) {
  const items = props.items ?? [];
  if (items.length === 0) return <Caption>No items.</Caption>;
  return (
    <>
      {props.label && <Caption>{props.label}</Caption>}
      <ul
        style={{
          listStyle: "none",
          margin: "6px 0 0 0",
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        {items.map((it, i) => (
          <li
            key={i}
            style={{
              display: "flex",
              gap: 8,
              alignItems: "flex-start",
              fontSize: "var(--t-sm)",
              color: it.done ? "var(--fg-faint)" : "var(--fg)",
            }}
          >
            <span
              aria-hidden
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 14,
                height: 14,
                marginTop: 2,
                borderRadius: 3,
                border: "1px solid var(--border-strong)",
                background: it.done ? "var(--border-strong)" : "transparent",
                color: "var(--bg)",
                fontSize: 10,
                flexShrink: 0,
              }}
            >
              {it.done ? "✓" : ""}
            </span>
            <span
              style={{
                textDecoration: it.done ? "line-through" : "none",
                lineHeight: 1.4,
              }}
            >
              {it.text}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

function Countdown({ props }: { props: CountdownProps }) {
  if (!props.targetDate) return <Caption>{props.label ?? "No target date."}</Caption>;
  const target = new Date(props.targetDate);
  if (isNaN(target.getTime())) return <Caption>{props.targetDate}</Caption>;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const msPerDay = 86400000;
  const days = Math.round((target.getTime() - today.getTime()) / msPerDay);
  if (days < 0 && props.captionWhenReached) {
    return <Caption>{props.captionWhenReached}</Caption>;
  }
  const label = days === 0 ? "today" : days === 1 ? "day" : "days";
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
      <BigNum>{Math.max(0, days)}</BigNum>
      <div>
        <div style={{ fontSize: 11, color: "var(--fg-mute)" }}>
          {label} until {props.targetDate}
        </div>
        {props.label && <Caption>{props.label}</Caption>}
      </div>
    </div>
  );
}

function ProgressBar({ props }: { props: ProgressBarProps }) {
  const pct = Math.max(
    0,
    Math.min(100, props.percent ?? (props.target ? ((props.current ?? 0) / props.target) * 100 : 0)),
  );
  return (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 11,
          color: "var(--fg-mute)",
          marginBottom: 4,
        }}
      >
        <span>{props.label ?? "Progress"}</span>
        <span className="tnum">{Math.round(pct)}%</span>
      </div>
      <div
        style={{
          height: 4,
          background: "var(--bg-sunken)",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <div style={{ width: `${pct}%`, height: "100%", background: "var(--accent)" }} />
      </div>
      {(props.current !== undefined || props.target !== undefined) && (
        <Caption>
          {props.current ?? 0} / {props.target ?? "?"}
        </Caption>
      )}
    </>
  );
}

function Funnel({ props }: { props: FunnelProps }) {
  const stages = props.stages ?? [];
  if (stages.length === 0) return <Caption>No funnel stages yet.</Caption>;
  const max = Math.max(...stages.map((s) => s.count), 1);
  return (
    <>
      {props.label && <Caption>{props.label}</Caption>}
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
        {stages.map((s, i) => {
          const w = Math.max(10, Math.round((s.count / max) * 100));
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  fontSize: 11,
                  color: "var(--fg-mute)",
                  width: 80,
                  flexShrink: 0,
                }}
              >
                {s.name}
              </span>
              <div
                style={{
                  flex: 1,
                  height: 10,
                  background: "var(--bg-sunken)",
                  borderRadius: 2,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{ width: `${w}%`, height: "100%", background: "var(--accent)" }}
                />
              </div>
              <span
                className="tnum"
                style={{ fontSize: 11, color: "var(--fg)", width: 30, textAlign: "right" }}
              >
                {s.count}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}

function Summary({ props }: { props: SummaryProps }) {
  return (
    <div style={{ fontSize: "var(--t-sm)", color: "var(--fg-mute)", lineHeight: 1.5 }}>
      {props.body ?? props.label ?? ""}
    </div>
  );
}

function FallbackJson({ card }: { card: InsightCard }) {
  // Unknown cardType — keep the dev JSON dump so backend changes are
  // visible without crashing the page. Remove when every type has a
  // renderer above.
  return (
    <pre
      style={{
        fontSize: 11,
        color: "var(--fg-mute)",
        margin: 0,
        whiteSpace: "pre-wrap",
        fontFamily: "var(--font-mono)",
      }}
    >
      {JSON.stringify(card.props, null, 2)}
    </pre>
  );
}

// ── Public component ─────────────────────────────────────

export default function InsightCardView({ card }: { card: InsightCard }) {
  const p = card.props as Record<string, unknown>;
  let body: React.ReactNode;
  switch (card.cardType) {
    case "phase-tracker":
      body = <PhaseTracker props={p as PhaseTrackerProps} />;
      break;
    case "streak":
      body = <StreakCard props={p as StreakProps} />;
      break;
    case "checklist":
      body = <Checklist props={p as ChecklistProps} />;
      break;
    case "countdown":
      body = <Countdown props={p as CountdownProps} />;
      break;
    case "progress-bar":
      body = <ProgressBar props={p as ProgressBarProps} />;
      break;
    case "funnel":
      body = <Funnel props={p as FunnelProps} />;
      break;
    case "summary":
      body = <Summary props={p as SummaryProps} />;
      break;
    // "tracker-table" and "heatmap" don't have renderers yet — fall through
    // to the debug JSON so they're visible but not broken.
    default:
      body = <FallbackJson card={card} />;
  }
  return <CardFrame card={card}>{body}</CardFrame>;
}
