/* TaskRow — one task in the Tasks list.
 * Inline actions: toggle, skip, reschedule, delete.
 * "More" menu: set-task-time-block, set-task-project-tag, estimate, can't-complete,
 * submit-priority-feedback. All map to contract commands. */

import { useState } from "react";
import Button from "../../components/primitives/Button";
import Icon, { type IconName } from "../../components/primitives/Icon";
import Pill, { type PillTone } from "../../components/primitives/Pill";
import CognitiveLoadPill from "./CognitiveLoadPill";
import type { UITask } from "./tasksTypes";

function RowAct({
  icon,
  title,
  onClick,
  tone,
  "data-api": dataApi,
  "data-testid": dataTestid,
}: {
  icon: IconName;
  title: string;
  onClick: () => void;
  tone?: "danger";
  "data-api"?: string;
  "data-testid"?: string;
}) {
  const hoverColor = tone === "danger" ? "var(--danger)" : "var(--navy-deep)";
  return (
    <button
      onClick={onClick}
      title={title}
      data-api={dataApi}
      data-testid={dataTestid}
      style={{
        width: 26,
        height: 26,
        border: 0,
        background: "transparent",
        color: "var(--fg-faint)",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 4,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--bg-soft)";
        e.currentTarget.style.color = hoverColor;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = "var(--fg-faint)";
      }}
    >
      <Icon name={icon} size={13} />
    </button>
  );
}

const WEIGHT_TONE: Record<string, PillTone> = {
  must: "warn",
  should: "info",
  nice: "base",
};

export interface TaskRowProps {
  task: UITask;
  onToggle: (id: string) => void;
  onSkip: (id: string) => void;
  onReschedule: (id: string, newDate: string) => void;
  onDelete: (id: string) => void;
  onCantComplete: (id: string) => void;
  onSetTimeBlock: (id: string, block: string) => void;
  onSetProjectTag: (id: string, tag: string) => void;
  onEstimate: (id: string) => void;
  onPriorityFeedback: (id: string, feedback: string) => void;
}

export default function TaskRow({
  task,
  onToggle,
  onSkip,
  onReschedule,
  onDelete,
  onCantComplete,
  onSetTimeBlock,
  onSetProjectTag,
  onEstimate,
  onPriorityFeedback,
}: TaskRowProps) {
  const [open, setOpen] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const done = !!(task.done ?? task.completed);
  const duration = task.duration ?? task.estimatedDurationMinutes ?? 0;
  const scheduled = task.scheduled ?? task.scheduledStartIso;
  const goalLabel = task.goal ?? task.goalTitle;
  const tag = task.tag ?? task.projectTag;

  return (
    <div
      data-testid={`task-row-${task.id}`}
      className="ns-row"
      style={{
        display: "grid",
        gridTemplateColumns: "22px 1fr auto",
        alignItems: "start",
        gap: 16,
        padding: "18px 0",
        borderBottom: "1px solid var(--border-soft)",
        opacity: done ? 0.45 : 1,
      }}
    >
      <button
        onClick={() => onToggle(task.id)}
        title="Toggle"
        data-api="POST /commands/toggle-task"
        data-testid={`task-toggle-${task.id}`}
        style={{
          width: 20,
          height: 20,
          marginTop: 3,
          borderRadius: "50%",
          border: done ? "1.5px solid var(--navy)" : "1.5px solid var(--border-strong)",
          background: done ? "var(--navy)" : "transparent",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--white)",
          flexShrink: 0,
          padding: 0,
        }}
      >
        {done && <Icon name="check" size={11} stroke={2.4} />}
      </button>

      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: "var(--t-lg)",
            fontWeight: 500,
            color: "var(--user-color)",
            textDecoration: done ? "line-through" : "none",
            lineHeight: 1.35,
          }}
        >
          {task.title}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginTop: 6,
            fontSize: "var(--t-xs)",
            color: "var(--fg-faint)",
            flexWrap: "wrap",
          }}
        >
          {goalLabel && (
            <>
              <span style={{ color: "var(--user-color-mute)" }}>{goalLabel}</span>
              <span style={{ opacity: 0.4 }}>·</span>
            </>
          )}
          {duration > 0 && <span className="tnum">{duration}m</span>}
          {scheduled && (
            <>
              <span style={{ opacity: 0.4 }}>·</span>
              <span className="tnum">{scheduled}</span>
            </>
          )}
          {task.weight && <Pill tone={WEIGHT_TONE[task.weight] ?? "base"}>{task.weight}</Pill>}
          {task.timeBlock && <Pill>{task.timeBlock}</Pill>}
          <CognitiveLoadPill
            load={task.cognitiveLoad}
            taskId={task.id}
            onOverridden={() => {
              /* view invalidation fires via WS — no manual refetch
                 needed. The pill re-renders automatically once the
                 view query updates. */
            }}
          />
          {tag && <Pill tone="gold" icon="tag">{tag}</Pill>}
          <button
            onClick={() => setOpen((o) => !o)}
            style={{
              border: 0,
              background: "transparent",
              color: "var(--fg-faint)",
              cursor: "pointer",
              fontSize: 10,
              padding: 0,
              textDecoration: "underline",
            }}
          >
            {open ? "less" : "more"}
          </button>
        </div>
        {open && (
          <div
            data-testid={`task-more-${task.id}`}
            style={{
              marginTop: 10,
              padding: 12,
              background: "var(--bg-soft)",
              borderRadius: 4,
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
            }}
          >
            <Button
              size="xs"
              icon="clock"
              onClick={() => onSetTimeBlock(task.id, "morning")}
              data-api="POST /commands/set-task-time-block"
              data-testid={`task-time-block-${task.id}`}
            >
              Time block
            </Button>
            <Button
              size="xs"
              icon="tag"
              onClick={() => onSetProjectTag(task.id, "deep-work")}
              data-api="POST /commands/set-task-project-tag"
              data-testid={`task-project-tag-${task.id}`}
            >
              Project tag
            </Button>
            <Button
              size="xs"
              icon="bolt"
              onClick={() => onEstimate(task.id)}
              data-api="POST /commands/estimate-task-durations"
              data-testid={`task-estimate-${task.id}`}
            >
              Estimate duration
            </Button>
            <Button
              size="xs"
              icon="alert"
              onClick={() => onCantComplete(task.id)}
              data-api="POST /commands/cant-complete-task"
              data-testid={`task-cant-complete-${task.id}`}
            >
              Can't complete
            </Button>
            <Button
              size="xs"
              icon="edit"
              onClick={() => onPriorityFeedback(task.id, "too-low")}
              data-api="POST /commands/submit-priority-feedback"
              data-testid={`task-priority-feedback-${task.id}`}
            >
              Priority feedback
            </Button>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                data-testid={`task-reschedule-date-${task.id}`}
                type="date"
                value={rescheduleDate}
                onChange={(e) => setRescheduleDate(e.target.value)}
                style={{
                  padding: "3px 6px",
                  fontSize: "var(--t-xs)",
                  border: "1px solid var(--border)",
                  borderRadius: 3,
                }}
              />
              <Button
                size="xs"
                icon="clock"
                onClick={() => rescheduleDate && onReschedule(task.id, rescheduleDate)}
                data-api="POST /commands/reschedule-task"
                data-testid={`task-reschedule-run-${task.id}`}
                disabled={!rescheduleDate}
              >
                Reschedule
              </Button>
            </div>
          </div>
        )}
      </div>

      <div
        className="ns-row-trail"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          flexShrink: 0,
          paddingTop: 2,
        }}
      >
        <RowAct
          icon="skip"
          title="Skip — carry forward"
          onClick={() => onSkip(task.id)}
          data-api="POST /commands/skip-task"
          data-testid={`task-skip-${task.id}`}
        />
        <RowAct
          icon="trash"
          title="Delete"
          tone="danger"
          onClick={() => onDelete(task.id)}
          data-api="POST /commands/delete-task"
          data-testid={`task-delete-${task.id}`}
        />
      </div>
    </div>
  );
}
