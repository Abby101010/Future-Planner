/* PlanTab — Goal Plan "Plan" tab: milestones + pace chart + chat CTA.
 *
 * Contract mapping (prototype → contract):
 *   update-goal-plan-milestone     → command:edit-milestone
 *   reorder-milestones             → DROPPED (not in contract)
 *   amend-goal-plan                → DROPPED (use AI goal-plan-chat/stream)
 *   regenerate-goal-plan (async)   → command:regenerate-goal-plan
 *   adaptive-reschedule (async)    → command:adaptive-reschedule
 *   add-task-to-plan               → command:add-task-to-plan
 *   expand-plan-week               → command:expand-plan-week
 *   confirm-goal-plan              → command:confirm-goal-plan
 *
 * Opens FloatingChat scoped to this goal via Zustand store.
 */

import { useEffect, useState } from "react";
import useStore from "../../store/useStore";
import { useCommand } from "../../hooks/useCommand";
import Button from "../../components/primitives/Button";
import Card from "../../components/primitives/Card";
import Icon from "../../components/primitives/Icon";
import Pill from "../../components/primitives/Pill";
import { startJob } from "../../components/chrome/JobStatusDock";

/** Goal IDs we already auto-fired regenerate-goal-plan for in this session.
 *  Module-scoped so unmount/remount of PlanTab doesn't redispatch the job.
 *  Reset on app reload (the manual-recovery escape hatch). */
const AUTO_TRIGGERED = new Set<string>();

interface Milestone {
  id: string;
  title: string;
  due?: string;
  targetDate?: string;
  status?: "done" | "active" | "upcoming" | "paused" | string;
  pct?: number;
  percent?: number;
}

export interface PlanTabProps {
  goalId: string;
  goalTitle: string;
  goalPct?: number;
  goalPaceDelta?: string;
  goalTargetDate?: string;
  milestones: Milestone[];
  /** Render a chat preview if true. */
  onRefetch: () => void;
}

export default function PlanTab({
  goalId,
  goalPct,
  goalPaceDelta,
  goalTargetDate,
  milestones,
  onRefetch,
}: PlanTabProps) {
  const { run, running } = useCommand();
  const setChatOpen = useStore((s) => s.setChatOpen);
  const setChatModeOverride = useStore((s) => s.setChatModeOverride);
  const [editing, setEditing] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newDate, setNewDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function regenerate() {
    setError(null);
    try {
      const r = await run<{ jobId?: string; async?: boolean }>(
        "command:regenerate-goal-plan",
        { goalId },
      );
      if (r?.jobId) startJob(r.jobId, `Regenerating plan for ${goalId}`);
      onRefetch();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // Auto-fire regenerate when this goal lands here without milestones.
  // Once per goal per session — failure surfaces in `error` and the user
  // can reload the app or amend the goal via chat to retry. The initial
  // create-goal flow already enqueues a regenerate-goal-plan job, so
  // this primarily covers recovery from prior failed jobs.
  useEffect(() => {
    if (milestones.length > 0) return;
    if (AUTO_TRIGGERED.has(goalId)) return;
    AUTO_TRIGGERED.add(goalId);
    void regenerate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goalId, milestones.length]);

  async function adaptive() {
    setError(null);
    try {
      const r = await run<{ jobId?: string; async?: boolean }>(
        "command:adaptive-reschedule",
        {},
      );
      if (r?.jobId) startJob(r.jobId, "Adaptive reschedule");
      onRefetch();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function confirmPlan() {
    setError(null);
    try {
      await run("command:confirm-goal-plan", { goalId });
      onRefetch();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function openChat() {
    // Goal Plan page auto-routes chat to goal-plan mode (the view is
    // `goal-plan-<id>`). Just clear any prior "general" override so the
    // banner shows + plan-edit prompt is used.
    setChatModeOverride(null);
    setChatOpen(true);
  }

  async function saveMilestone(m: Milestone) {
    setError(null);
    try {
      await run("command:edit-milestone", {
        milestoneId: m.id,
        newTitle: newTitle.trim() || undefined,
        newDate: newDate.trim() || undefined,
      });
      setEditing(null);
      setNewTitle("");
      setNewDate("");
      onRefetch();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const doneCount = milestones.filter((m) => m.status === "done").length;
  const activeCount = milestones.filter((m) => m.status === "active").length;
  const upcomingCount = milestones.filter((m) => m.status !== "done" && m.status !== "active").length;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1.6fr 1fr",
        gap: 28,
        alignItems: "flex-start",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }}>
        <section
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 20,
            paddingBottom: 14,
            borderBottom: "1px solid var(--border-soft)",
          }}
        >
          <div>
            <div
              style={{
                fontSize: 10,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: "var(--fg-faint)",
                fontWeight: 600,
              }}
            >
              Plan timeline
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginTop: 4 }}>
              <span className="num-gold" style={{ fontSize: 32, lineHeight: 1 }}>
                {goalPct ?? 0}%
              </span>
              <span style={{ fontSize: "var(--t-sm)", color: "var(--fg-mute)" }}>
                complete
                {goalPaceDelta && (
                  <>
                    {" · "}
                    <span style={{ color: "var(--danger)" }}>{goalPaceDelta} off pace</span>
                  </>
                )}
                {goalTargetDate && (
                  <>
                    {" · lands "}
                    <span className="tnum">{goalTargetDate}</span>
                  </>
                )}
              </span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Button
              size="sm"
              tone="ghost"
              icon="bolt"
              onClick={adaptive}
              data-api="POST /commands/adaptive-reschedule"
              data-testid="plan-adaptive-reschedule"
              disabled={running}
            >
              Adaptive reshuffle
            </Button>
            <Button
              size="sm"
              tone="ghost"
              icon="chat"
              onClick={openChat}
              data-api="POST /ai/goal-plan-chat/stream"
              data-testid="plan-open-chat"
            >
              Amend (chat)
            </Button>
            <Button
              size="sm"
              tone="ghost"
              icon="check"
              onClick={confirmPlan}
              data-api="POST /commands/confirm-goal-plan"
              data-testid="plan-confirm"
              disabled={running}
            >
              Confirm
            </Button>
          </div>
        </section>

        {error && (
          <div
            data-testid="plan-error"
            style={{ color: "var(--danger)", fontSize: 11, fontFamily: "var(--font-mono)" }}
          >
            {error}
          </div>
        )}

        <section>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              marginBottom: 10,
            }}
          >
            <div>
              <h3 className="h-headline" style={{ margin: 0, fontSize: "var(--t-xl)" }}>
                Milestones
              </h3>
              <div style={{ fontSize: 10, color: "var(--fg-faint)", marginTop: 2 }}>
                {doneCount} done · {activeCount} active · {upcomingCount} upcoming
              </div>
            </div>
          </div>

          <div
            data-testid="plan-milestones"
            style={{
              border: "1px solid var(--border)",
              borderRadius: "var(--r-md)",
              background: "var(--bg-elev)",
              overflow: "hidden",
            }}
          >
            {milestones.length === 0 && (
              <div style={{ padding: 20, textAlign: "center", color: "var(--fg-faint)" }}>
                {running || AUTO_TRIGGERED.has(goalId)
                  ? "Generating plan… this can take 30–60 seconds."
                  : error
                    ? `Plan generation failed: ${error}. Reload to retry, or amend via chat.`
                    : "Generation in progress…"}
              </div>
            )}
            {milestones.map((m, idx) => {
              const done = m.status === "done";
              const active = m.status === "active";
              const isEditing = editing === m.id;
              const pct = m.pct ?? m.percent ?? 0;
              const due = m.due ?? m.targetDate ?? "";
              return (
                <div
                  key={m.id}
                  data-testid={`plan-milestone-${m.id}`}
                  className="ns-row"
                  style={{
                    padding: "14px 16px",
                    borderBottom:
                      idx < milestones.length - 1 ? "1px solid var(--border-soft)" : "none",
                    display: "grid",
                    gridTemplateColumns: "22px 1fr auto",
                    gap: 12,
                    alignItems: "center",
                  }}
                >
                  <span
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: "50%",
                      border: done
                        ? "1.5px solid var(--success)"
                        : active
                          ? "1.5px solid var(--accent)"
                          : "1.5px solid var(--border-strong)",
                      background: done
                        ? "var(--success)"
                        : active
                          ? "var(--gold-faint)"
                          : "transparent",
                      color: "var(--white)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {done && <Icon name="check" size={11} stroke={2.5} />}
                    {active && (
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          background: "var(--accent)",
                        }}
                      />
                    )}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    {isEditing ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <input
                          autoFocus
                          data-testid={`plan-milestone-title-${m.id}`}
                          value={newTitle}
                          onChange={(e) => setNewTitle(e.target.value)}
                          placeholder={m.title}
                          style={{
                            padding: "4px 8px",
                            fontSize: "var(--t-md)",
                            border: "1px solid var(--border-strong)",
                            borderRadius: 3,
                          }}
                        />
                        <div style={{ display: "flex", gap: 6 }}>
                          <input
                            data-testid={`plan-milestone-date-${m.id}`}
                            type="date"
                            value={newDate}
                            onChange={(e) => setNewDate(e.target.value)}
                            style={{
                              padding: "4px 8px",
                              fontSize: "var(--t-sm)",
                              border: "1px solid var(--border-strong)",
                              borderRadius: 3,
                            }}
                          />
                          <Button
                            size="xs"
                            tone="primary"
                            onClick={() => saveMilestone(m)}
                            data-api="POST /commands/edit-milestone"
                            data-testid={`plan-milestone-save-${m.id}`}
                          >
                            Save
                          </Button>
                          <Button
                            size="xs"
                            tone="ghost"
                            onClick={() => {
                              setEditing(null);
                              setNewTitle("");
                              setNewDate("");
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div
                        onClick={() => {
                          setEditing(m.id);
                          setNewTitle(m.title);
                          setNewDate(due && due.length >= 10 ? due.slice(0, 10) : "");
                        }}
                        style={{
                          fontSize: "var(--t-md)",
                          fontWeight: 500,
                          color: done ? "var(--fg-faint)" : "var(--user-color)",
                          textDecoration: done ? "line-through" : "none",
                          cursor: "text",
                        }}
                      >
                        {m.title}
                      </div>
                    )}
                    {!isEditing && (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          marginTop: 4,
                          fontSize: 10,
                        }}
                      >
                        {due && (
                          <span className="tnum" style={{ color: "var(--fg-faint)" }}>
                            {due}
                          </span>
                        )}
                        {!done && (
                          <>
                            <span style={{ color: "var(--fg-faint)" }}>·</span>
                            <div
                              style={{
                                width: 120,
                                height: 3,
                                background: "var(--bg-sunken)",
                                borderRadius: 2,
                              }}
                            >
                              <div
                                style={{
                                  width: `${pct}%`,
                                  height: "100%",
                                  background: "var(--accent)",
                                  borderRadius: 2,
                                }}
                              />
                            </div>
                            <span className="tnum" style={{ color: "var(--fg-faint)" }}>
                              {pct}%
                            </span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  <div>
                    <Pill mono>{m.status ?? "—"}</Pill>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <AddTaskToPlan goalId={goalId} onDone={onRefetch} />
      </div>

      <aside>
        <Card
          eyebrow="Goal chat"
          title="Amend the plan in words"
          action={
            <Button size="xs" icon="chat" onClick={openChat} data-testid="plan-chat-open">
              Open full
            </Button>
          }
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              minHeight: 180,
              fontSize: "var(--t-sm)",
              color: "var(--fg-mute)",
              lineHeight: 1.55,
            }}
          >
            Open the floating chat to ask Starward to reshuffle, compress, or extend milestones
            in natural language. The chat routes to{" "}
            <code>/ai/goal-plan-chat/stream</code> and persists plan patches.
          </div>
        </Card>
      </aside>
    </div>
  );
}

function AddTaskToPlan({ goalId, onDone }: { goalId: string; onDone: () => void }) {
  const { run, running } = useCommand();
  const [date, setDate] = useState("");
  const [title, setTitle] = useState("");
  const [minutes, setMinutes] = useState("30");
  const [weight, setWeight] = useState("3");
  const [weekId, setWeekId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function addTask() {
    setError(null);
    try {
      await run("command:add-task-to-plan", {
        goalId,
        date,
        title,
        durationMinutes: Number(minutes) || 30,
        cognitiveWeight: Number(weight) || 3,
      });
      setDate("");
      setTitle("");
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function expandWeek() {
    if (!weekId.trim()) return;
    setError(null);
    try {
      await run("command:expand-plan-week", { goalId, weekId });
      setWeekId("");
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <details data-testid="plan-add-task-details" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary
        style={{
          cursor: "pointer",
          fontSize: "var(--t-xs)",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--fg-faint)",
          fontWeight: 600,
          padding: "6px 0",
        }}
      >
        <Icon name="plus" size={11} /> Add task / expand week
      </summary>
      <div style={{ padding: "8px 0", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <input
            data-testid="plan-add-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Task title"
            style={{ flex: 1, padding: "5px 8px", border: "1px solid var(--border)", borderRadius: 4, fontSize: "var(--t-sm)" }}
          />
          <input
            data-testid="plan-add-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={{ padding: "5px 8px", border: "1px solid var(--border)", borderRadius: 4, fontSize: "var(--t-sm)" }}
          />
          <input
            data-testid="plan-add-minutes"
            type="number"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            style={{ width: 80, padding: "5px 8px", border: "1px solid var(--border)", borderRadius: 4, fontSize: "var(--t-sm)" }}
            placeholder="min"
          />
          <input
            data-testid="plan-add-weight"
            type="number"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            style={{ width: 70, padding: "5px 8px", border: "1px solid var(--border)", borderRadius: 4, fontSize: "var(--t-sm)" }}
            placeholder="wt"
          />
          <Button
            size="sm"
            tone="primary"
            onClick={addTask}
            data-api="POST /commands/add-task-to-plan"
            data-testid="plan-add-task-run"
            disabled={running || !title.trim() || !date}
          >
            Add to plan
          </Button>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            data-testid="plan-expand-week-id"
            value={weekId}
            onChange={(e) => setWeekId(e.target.value)}
            placeholder="weekId (e.g. week-2024-04-22)"
            style={{ flex: 1, padding: "5px 8px", border: "1px solid var(--border)", borderRadius: 4, fontSize: "var(--t-sm)" }}
          />
          <Button
            size="sm"
            tone="ghost"
            onClick={expandWeek}
            data-api="POST /commands/expand-plan-week"
            data-testid="plan-expand-week-run"
            disabled={running || !weekId.trim()}
          >
            Expand week
          </Button>
        </div>
        {error && <div style={{ color: "var(--danger)", fontSize: 10 }}>{error}</div>}
      </div>
    </details>
  );
}
