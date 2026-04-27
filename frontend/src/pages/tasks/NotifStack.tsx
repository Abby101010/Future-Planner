/* NotifStack — transient pending-triage / reschedule / nudge cards.
 *
 * These are NOT titled sections per the redesign; they appear in the right
 * gutter on wide screens and inline at the top on narrow (< 1200px). Every
 * button wires to the contract endpoint for the corresponding bucket.
 */

import { useEffect, useState, type ReactNode } from "react";
import Button from "../../components/primitives/Button";
import Icon, { type IconName } from "../../components/primitives/Icon";
import type {
  UIPendingTask,
  UIProposal,
  UIPendingReschedule,
  UINudge,
} from "./tasksTypes";

type Tone = "gold" | "navy" | "mist";

const TONES: Record<Tone, { bg: string; border: string; accent: string; icon: IconName }> = {
  gold: { bg: "var(--gold-faint)", border: "var(--gold-line-faint)", accent: "var(--accent)", icon: "sparkle" },
  navy: { bg: "var(--navy-tint)", border: "var(--border)", accent: "var(--navy-mid)", icon: "clock" },
  mist: { bg: "var(--bg-elev)", border: "var(--border)", accent: "var(--navy-deep)", icon: "bell" },
};

function NotifCard({
  kind,
  title,
  body,
  tone = "gold",
  onDismiss,
  children,
  testId,
}: {
  kind: string;
  title?: string;
  body?: ReactNode;
  tone?: Tone;
  onDismiss?: () => void;
  children?: ReactNode;
  testId?: string;
}) {
  const t = TONES[tone];
  return (
    <div
      data-testid={testId}
      style={{
        background: t.bg,
        border: `1px solid ${t.border}`,
        borderRadius: "var(--r-md)",
        boxShadow: "var(--shadow-2)",
        padding: "11px 13px",
        width: "100%",
        minWidth: 0,
        maxWidth: 320,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        animation: "ns-slide-up .22s ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 9 }}>
        <Icon name={t.icon} size={12} style={{ color: t.accent, marginTop: 3, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 3, flexWrap: "wrap" }}>
            <div
              style={{
                fontSize: 9,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "var(--fg-faint)",
                fontWeight: 600,
                whiteSpace: "nowrap",
              }}
            >
              {kind}
            </div>
            {title && (
              <div
                style={{
                  fontSize: "var(--t-xs)",
                  color: "var(--fg-mute)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  minWidth: 0,
                }}
              >
                · {title}
              </div>
            )}
          </div>
          <div style={{ fontSize: "var(--t-xs)", color: "var(--fg)", lineHeight: 1.5 }}>{body}</div>
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            style={{
              border: 0,
              background: "transparent",
              cursor: "pointer",
              color: "var(--fg-faint)",
              padding: 2,
              flexShrink: 0,
              marginTop: -2,
            }}
          >
            <Icon name="x" size={12} />
          </button>
        )}
      </div>
      {children && <div style={{ display: "flex", gap: 6, paddingLeft: 21, flexWrap: "wrap" }}>{children}</div>}
    </div>
  );
}

export interface NotifStackProps {
  pending: UIPendingTask[];
  proposals: UIProposal[];
  reschedules: UIPendingReschedule[];
  nudges: UINudge[];
  inline?: boolean;
  onConfirmPending: (id: string) => void;
  onRejectPending: (id: string) => void;
  onAcceptProposal: (id: string) => void;
  onSnoozeProposal: (id: string) => void;
  onDismissProposal: (id: string) => void;
  onAcceptReschedule: (taskId: string, targetDate: string) => void;
  onSnoozeReschedule: (taskId: string) => void;
  onDismissReschedule: (taskId: string) => void;
  /** Bulk-confirm all pending reschedules. Each task moves to its OWN
   *  suggestedDate (preserved per-task), not a shared bulk target. */
  onConfirmAllReschedules: () => void;
  /** Open chat seeded with the overdue list so the user can override
   *  individual items via natural language (manage-task intents). */
  onChatAboutReschedules: () => void;
  onDeferOverflow: () => void;
  onDismissNudge: (id: string) => void;
}

/** Single consolidated card replacing N individual reschedule cards.
 *  Each task moves to ITS OWN suggestedDate (preserved by the per-task
 *  command:reschedule-task call in TasksPage), not a shared bulk
 *  target — that preserves the BE's load-balancing in
 *  pickSuggestedDate. Don't "simplify" to a single bulk targetDate or
 *  the lightest-day signal is lost.  */
function BulkRescheduleCard({
  reschedules,
  onConfirmAll,
  onReviewIndividually,
  onChat,
}: {
  reschedules: UIPendingReschedule[];
  onConfirmAll: () => void;
  onReviewIndividually: () => void;
  onChat: () => void;
}) {
  const dateCounts = reschedules.reduce<Record<string, { label: string; count: number }>>(
    (acc, r) => {
      const k = r.suggestedDate;
      if (!acc[k]) acc[k] = { label: r.suggestedDateLabel, count: 0 };
      acc[k].count++;
      return acc;
    },
    {},
  );
  const distinctDates = Object.keys(dateCounts);
  const headline =
    distinctDates.length === 1
      ? `Move ${reschedules.length} items to ${dateCounts[distinctDates[0]].label}`
      : `Move ${reschedules.length} items to their suggested dates`;

  // Up to 5 sample titles for the body — keeps the card scannable.
  const sample = reschedules.slice(0, 5).map((r) => r.title);
  const remaining = reschedules.length - sample.length;

  return (
    <NotifCard
      testId="tasks-reschedule-bulk"
      kind={`Bulk reschedule (${reschedules.length})`}
      tone="navy"
      title={headline}
      body={
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {sample.map((t, i) => (
            <span
              key={i}
              style={{
                color: "var(--fg-mute)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              · {t}
            </span>
          ))}
          {remaining > 0 && (
            <span style={{ color: "var(--fg-faint)" }}>+ {remaining} more…</span>
          )}
        </div>
      }
    >
      <Button
        size="xs"
        tone="primary"
        onClick={onConfirmAll}
        data-api="POST /commands/reschedule-task (loop)"
        data-testid="tasks-reschedule-bulk-confirm"
      >
        Confirm all
      </Button>
      <Button
        size="xs"
        tone="ghost"
        onClick={onReviewIndividually}
        data-testid="tasks-reschedule-bulk-review"
      >
        Review individually
      </Button>
      <Button
        size="xs"
        tone="ghost"
        onClick={onChat}
        data-testid="tasks-reschedule-bulk-chat"
      >
        Discuss in chat
      </Button>
    </NotifCard>
  );
}

export default function NotifStack({
  pending,
  proposals,
  reschedules,
  nudges,
  inline = false,
  onConfirmPending,
  onRejectPending,
  onAcceptProposal,
  onSnoozeProposal,
  onDismissProposal,
  onAcceptReschedule,
  onSnoozeReschedule,
  onDismissReschedule,
  onConfirmAllReschedules,
  onChatAboutReschedules,
  onDeferOverflow,
  onDismissNudge,
}: NotifStackProps) {
  // Reschedule presentation: when there are 2+ overdue tasks queued
  // for reschedule, render a single bulk-confirm card by default.
  // Click "Review individually" to fall through to the per-card path
  // (which is also what happens when count === 1).
  const [reviewMode, setReviewMode] = useState(false);
  // Auto-reset reviewMode once the queue empties so the next cohort
  // of overdue tasks lands back on the bulk card.
  useEffect(() => {
    if (reschedules.length === 0 && reviewMode) setReviewMode(false);
  }, [reschedules.length, reviewMode]);
  const showBulk = reschedules.length >= 2 && !reviewMode;
  const total =
    pending.length + proposals.length + reschedules.length + nudges.length;
  if (total === 0) return null;

  const containerStyle: React.CSSProperties = inline
    ? {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
        gap: 10,
        marginBottom: 8,
      }
    : {
        position: "fixed",
        top: 112,
        right: 16,
        zIndex: 45,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        pointerEvents: "auto",
        maxHeight: "calc(100vh - 140px)",
        overflowY: "auto",
      };

  return (
    <aside data-testid="tasks-notif-stack" style={containerStyle}>
      {pending.map((p) => (
        <NotifCard
          key={p.id}
          testId={`tasks-pending-${p.id}`}
          kind="Pending triage"
          tone="gold"
          body={
            <span style={{ fontStyle: "italic" }}>
              "{p.userInput ?? p.title ?? ""}"
            </span>
          }
          onDismiss={() => onRejectPending(p.id)}
        >
          <Button
            size="xs"
            tone="primary"
            onClick={() => onConfirmPending(p.id)}
            data-api="POST /commands/confirm-pending-task"
            data-testid={`tasks-pending-confirm-${p.id}`}
          >
            Confirm
          </Button>
          <Button
            size="xs"
            tone="ghost"
            onClick={() => onRejectPending(p.id)}
            data-api="POST /commands/reject-pending-task"
            data-testid={`tasks-pending-reject-${p.id}`}
          >
            Reject
          </Button>
        </NotifCard>
      ))}
      {proposals.map((p) => (
        <NotifCard
          key={p.id}
          testId={`tasks-proposal-${p.id}`}
          kind="Pending reschedule"
          title={p.title}
          tone="navy"
          body={p.reason}
          onDismiss={() => onDismissProposal(p.id)}
        >
          <Button
            size="xs"
            tone="primary"
            onClick={() => onAcceptProposal(p.id)}
            data-api="POST /commands/accept-task-proposal"
            data-testid={`tasks-proposal-accept-${p.id}`}
          >
            Accept
          </Button>
          <Button
            size="xs"
            tone="ghost"
            onClick={() => onSnoozeProposal(p.id)}
            data-api="POST /commands/snooze-reschedule"
            data-testid={`tasks-proposal-snooze-${p.id}`}
          >
            Snooze
          </Button>
          <Button
            size="xs"
            tone="ghost"
            onClick={onDeferOverflow}
            data-api="POST /commands/defer-overflow"
            data-testid="tasks-defer-overflow"
          >
            Defer all
          </Button>
        </NotifCard>
      ))}
      {showBulk && (
        <BulkRescheduleCard
          reschedules={reschedules}
          onConfirmAll={onConfirmAllReschedules}
          onReviewIndividually={() => setReviewMode(true)}
          onChat={onChatAboutReschedules}
        />
      )}
      {!showBulk && reschedules.map((r) => {
        const overdueLabel =
          r.daysOverdue === 1
            ? "1 day overdue"
            : `${r.daysOverdue} days overdue`;
        const body = (
          <>
            <span>{overdueLabel}</span>
            {r.agedOut && (
              <span style={{ color: "var(--fg-faint)" }}> · aged</span>
            )}
            {r.goalTitle && (
              <span style={{ color: "var(--fg-mute)" }}> · from {r.goalTitle}</span>
            )}
          </>
        );
        return (
          <NotifCard
            key={`rs-${r.taskId}`}
            testId={`tasks-reschedule-${r.taskId}`}
            kind="Reschedule"
            title={r.title}
            tone="navy"
            body={body}
            onDismiss={() => onDismissReschedule(r.taskId)}
          >
            <Button
              size="xs"
              tone="primary"
              onClick={() => onAcceptReschedule(r.taskId, r.suggestedDate)}
              data-api="POST /commands/reschedule-task"
              data-testid={`tasks-reschedule-accept-${r.taskId}`}
            >
              Move to {r.suggestedDateLabel}
            </Button>
            <Button
              size="xs"
              tone="ghost"
              onClick={() => onSnoozeReschedule(r.taskId)}
              data-api="POST /commands/snooze-reschedule"
              data-testid={`tasks-reschedule-snooze-${r.taskId}`}
            >
              Snooze 1 day
            </Button>
            <Button
              size="xs"
              tone="ghost"
              onClick={() => onDismissReschedule(r.taskId)}
              data-api="POST /commands/dismiss-reschedule"
              data-testid={`tasks-reschedule-drop-${r.taskId}`}
            >
              Drop
            </Button>
          </NotifCard>
        );
      })}
      {nudges.map((n) => (
        <NotifCard
          key={n.id}
          testId={`tasks-nudge-${n.id}`}
          kind="Nudge"
          tone="gold"
          body={n.text}
          onDismiss={() => onDismissNudge(n.id)}
        />
      ))}
    </aside>
  );
}
