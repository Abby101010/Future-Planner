/* PendingGoalCard — inline confirmation card rendered inside FloatingChat
 * when the AI emits an `intent.kind === "goal"` in its streaming reply.
 *
 * Keeps the goal in FE-local state until the user clicks "Create goal";
 * only then is it POSTed to `command:create-goal`. This mirrors the old
 * planner's behavior (dispatchChatIntent returns the "pending-goal"
 * signal — we capture intent.entity here and let the user review + edit
 * before committing).
 */

import { useState } from "react";
import type { Goal } from "@starward/core";
import Icon from "../primitives/Icon";
import Pill from "../primitives/Pill";
import Button from "../primitives/Button";

export interface PendingGoalCardProps {
  goal: Partial<Goal>;
  onConfirm: () => void;
  onReject: () => void;
  onUpdate: (updates: Partial<Goal>) => void;
}

export default function PendingGoalCard({
  goal,
  onConfirm,
  onReject,
  onUpdate,
}: PendingGoalCardProps) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState(goal.title ?? "");
  const [editingDesc, setEditingDesc] = useState(false);
  const [editDesc, setEditDesc] = useState(goal.description ?? "");

  const goalTypeLabel =
    goal.goalType === "big"
      ? "Long-term"
      : goal.goalType === "repeating"
        ? "Repeating"
        : "Everyday";

  const importanceLabel =
    goal.importance === "critical"
      ? "Critical"
      : goal.importance === "high"
        ? "High"
        : goal.importance === "low"
          ? "Low"
          : "Medium";

  return (
    <div
      data-testid="pending-goal-card"
      style={{
        alignSelf: "stretch",
        background: "var(--gold-faint)",
        border: "1px solid var(--gold-line-faint)",
        borderLeft: "3px solid var(--accent)",
        borderRadius: "var(--r-md)",
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        animation: "ns-slide-up .18s ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Icon name="target" size={14} style={{ color: "var(--accent)" }} />
        <span
          style={{
            fontSize: 10,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--accent)",
            fontWeight: 600,
          }}
        >
          New goal · review
        </span>
      </div>

      {/* Title — click to edit */}
      {editingTitle ? (
        <input
          autoFocus
          data-testid="pending-goal-title-input"
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          onBlur={() => {
            if (editTitle.trim()) onUpdate({ title: editTitle.trim() });
            setEditingTitle(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              if (editTitle.trim()) onUpdate({ title: editTitle.trim() });
              setEditingTitle(false);
            }
            if (e.key === "Escape") setEditingTitle(false);
          }}
          style={{
            padding: "6px 8px",
            fontSize: "var(--t-md)",
            border: "1px solid var(--accent)",
            borderRadius: 4,
            background: "var(--bg)",
            fontFamily: "inherit",
            fontWeight: 500,
          }}
        />
      ) : (
        <div
          data-testid="pending-goal-title"
          onClick={() => {
            setEditTitle(goal.title ?? "");
            setEditingTitle(true);
          }}
          title="Click to edit"
          style={{
            fontSize: "var(--t-md)",
            fontWeight: 600,
            color: "var(--fg)",
            display: "flex",
            alignItems: "center",
            gap: 6,
            cursor: "text",
          }}
        >
          {goal.title || "(no title)"}
          <Icon
            name="edit"
            size={11}
            style={{ color: "var(--fg-faint)", opacity: 0.6 }}
          />
        </div>
      )}

      {/* Description */}
      {editingDesc ? (
        <textarea
          autoFocus
          data-testid="pending-goal-desc-input"
          rows={2}
          value={editDesc}
          onChange={(e) => setEditDesc(e.target.value)}
          onBlur={() => {
            onUpdate({ description: editDesc.trim() });
            setEditingDesc(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onUpdate({ description: editDesc.trim() });
              setEditingDesc(false);
            }
            if (e.key === "Escape") setEditingDesc(false);
          }}
          style={{
            padding: "6px 8px",
            fontSize: "var(--t-sm)",
            border: "1px solid var(--accent)",
            borderRadius: 4,
            background: "var(--bg)",
            fontFamily: "inherit",
            resize: "vertical",
          }}
        />
      ) : goal.description ? (
        <div
          data-testid="pending-goal-desc"
          onClick={() => {
            setEditDesc(goal.description ?? "");
            setEditingDesc(true);
          }}
          title="Click to edit"
          style={{
            fontSize: "var(--t-sm)",
            color: "var(--fg-mute)",
            lineHeight: 1.5,
            cursor: "text",
          }}
        >
          {goal.description}
        </div>
      ) : null}

      {/* Meta chips */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <Pill tone="gold">{goalTypeLabel}</Pill>
        <Pill>{importanceLabel}</Pill>
        {goal.targetDate && (
          <Pill mono>
            {typeof goal.targetDate === "string"
              ? goal.targetDate.slice(0, 10)
              : String(goal.targetDate)}
          </Pill>
        )}
      </div>

      {/* Actions */}
      <div
        style={{
          display: "flex",
          gap: 6,
          justifyContent: "flex-end",
          paddingTop: 2,
        }}
      >
        <Button
          size="sm"
          tone="ghost"
          onClick={onReject}
          data-testid="pending-goal-reject"
        >
          Not now
        </Button>
        <Button
          size="sm"
          tone="primary"
          icon="check"
          onClick={onConfirm}
          data-api="POST /commands/create-goal"
          data-testid="pending-goal-confirm"
          disabled={!goal.title?.trim()}
        >
          Create goal
        </Button>
      </div>
    </div>
  );
}
