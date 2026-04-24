/* PlanningPage — designed all-goals overview (canonical card-grid variant).
 *
 * Per contract:
 *   - GET /view/planning on mount
 *   - POST /commands/create-goal / update-goal / delete-goal / pause-goal /
 *          resume-goal / adjust-all-overloaded-plans
 *   - Open a goal → navigate to goal-plan-${id}
 *
 * Prototype archive + reorder affordances DROPPED (commands not in contract).
 */

import { useState } from "react";
import useStore from "../../store/useStore";
import { useQuery } from "../../hooks/useQuery";
import { useCommand } from "../../hooks/useCommand";
import type { AppView } from "@starward/core";
import TopBar from "../../components/primitives/TopBar";
import Button from "../../components/primitives/Button";
import Card from "../../components/primitives/Card";
import Banner from "../../components/primitives/Banner";
import Icon from "../../components/primitives/Icon";
import { startJob } from "../../components/chrome/JobStatusDock";
import GoalCard from "./GoalCard";
import type { PlanningGoal } from "./planningTypes";
import type { Pace } from "./PaceBadge";

interface PlanningView {
  goals?: Array<Partial<PlanningGoal> & { id: string; title: string; status?: string }>;
}

function toPace(value: unknown, status?: string): Pace {
  if (status === "paused") return "paused";
  if (value === "on-track" || value === "ahead" || value === "behind" || value === "paused") {
    return value;
  }
  return "on-track";
}

function normalize(raw: Partial<PlanningGoal> & { id: string; title: string; status?: string }): PlanningGoal {
  return {
    id: raw.id,
    title: raw.title,
    status: raw.status ?? "active",
    description: raw.description,
    horizon: raw.horizon,
    icon: raw.icon ?? "◎",
    pct: raw.pct,
    nextMilestone: raw.nextMilestone,
    nextDue: raw.nextDue ?? null,
    pace: toPace(raw.pace, raw.status),
    paceDelta: raw.paceDelta,
    tasksThisWeek: raw.tasksThisWeek,
    openTasks: raw.openTasks,
    // Pass through the inFlight descriptor from view:planning unchanged
    // (annotated per-goal in backend/src/views/planningView.ts). When
    // present, GoalCard → PaceBadge swaps in a "Planning…" pill.
    inFlight: raw.inFlight ?? null,
  };
}

export default function PlanningPage() {
  const setView = useStore((s) => s.setView);
  const { data, loading, error, refetch } = useQuery<PlanningView>("view:planning");
  const { run, running } = useCommand();

  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newHorizon, setNewHorizon] = useState("6 months");
  const [cmdError, setCmdError] = useState<string | null>(null);

  const goals: PlanningGoal[] = (data?.goals ?? []).map(normalize);
  const active = goals.filter((g) => g.status === "active").length;
  const paused = goals.filter((g) => g.status === "paused").length;
  const behind = goals.filter((g) => g.pace === "behind").length;

  async function createGoal() {
    if (!newTitle.trim()) return;
    setCmdError(null);
    try {
      // Backend expects args.goal with a pre-generated id (see
      // backend/src/routes/commands/goals.ts:13). FE generates the id.
      const id = (crypto as unknown as { randomUUID?: () => string }).randomUUID?.()
        ?? `goal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const goalTitle = newTitle.trim();
      await run("command:create-goal", {
        goal: {
          id,
          title: goalTitle,
          description: newDescription.trim(),
          horizon: newHorizon,
          status: "active",
        },
      });

      // Two-call sequence: `command:create-goal` is a pure upsert on the
      // backend — it doesn't auto-generate a plan. Enqueue the async job
      // explicitly so the card shows "Planning…" via view:planning's
      // per-goal `inFlight` field and the JobStatusDock tracks progress.
      try {
        const job = await run<{ jobId?: string; async?: boolean }>(
          "command:regenerate-goal-plan",
          { goalId: id },
        );
        if (job?.jobId) startJob(job.jobId, `Generating plan for ${goalTitle}`);
      } catch (jobErr) {
        // Goal is created; plan-enqueue failing is recoverable via the
        // "Regenerate" button on the Goal Plan page. Keep the create.
        console.warn(
          "[PlanningPage] plan enqueue failed after create-goal:",
          jobErr,
        );
      }

      setShowCreate(false);
      setNewTitle("");
      setNewDescription("");
      refetch();
    } catch (e) {
      setCmdError((e as Error).message);
    }
  }

  async function onPause(goalId: string) {
    setCmdError(null);
    try {
      await run("command:pause-goal", { goalId });
      refetch();
    } catch (e) {
      setCmdError((e as Error).message);
    }
  }
  async function onResume(goalId: string) {
    setCmdError(null);
    try {
      await run("command:resume-goal", { goalId });
      refetch();
    } catch (e) {
      setCmdError((e as Error).message);
    }
  }
  async function onDelete(goalId: string) {
    if (!window.confirm("Delete this goal? (can't be undone)")) return;
    setCmdError(null);
    try {
      await run("command:delete-goal", { goalId });
      refetch();
    } catch (e) {
      setCmdError((e as Error).message);
    }
  }
  async function onRebalanceAll() {
    setCmdError(null);
    try {
      await run("command:adjust-all-overloaded-plans", {});
      refetch();
    } catch (e) {
      setCmdError((e as Error).message);
    }
  }

  return (
    <>
      <TopBar
        eyebrow={`${active} active · ${paused} paused · ${behind} behind`}
        title="Planning"
        right={
          <>
            <Button
              size="sm"
              tone="ghost"
              icon="bolt"
              onClick={onRebalanceAll}
              data-api="POST /commands/adjust-all-overloaded-plans"
              data-testid="planning-rebalance"
              disabled={running}
            >
              Rebalance all
            </Button>
            <Button
              size="sm"
              tone="primary"
              icon="plus"
              onClick={() => setShowCreate(true)}
              data-api="POST /commands/create-goal"
              data-testid="planning-create-goal"
            >
              New goal
            </Button>
          </>
        }
      />
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          width: "100%",
          padding: "24px 32px 96px",
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        {loading && !data && (
          <div data-testid="planning-loading" style={{ padding: 40, textAlign: "center", color: "var(--fg-faint)" }}>
            Loading goals…
          </div>
        )}
        {error && (
          <div
            data-testid="planning-error"
            style={{
              padding: 20,
              color: "var(--danger)",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
            }}
          >
            {String(error)}
          </div>
        )}
        {cmdError && (
          <div
            data-testid="planning-cmd-error"
            style={{
              padding: 10,
              color: "var(--danger)",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
            }}
          >
            {cmdError}
          </div>
        )}

        {behind > 0 && (
          <Banner
            tone="pace"
            icon="alert"
            title={`${behind} goal${behind > 1 ? "s are" : " is"} behind pace`}
            body="Rebalance distributes your remaining time across all active goals so nothing runs into the deadline."
            action={
              <Button size="sm" onClick={onRebalanceAll} disabled={running}>
                Rebalance
              </Button>
            }
          />
        )}

        {showCreate && (
          <Card
            eyebrow="New goal"
            action={
              <button
                onClick={() => setShowCreate(false)}
                style={{
                  border: 0,
                  background: "transparent",
                  cursor: "pointer",
                  color: "var(--fg-faint)",
                  padding: 4,
                }}
              >
                <Icon name="x" size={14} />
              </button>
            }
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input
                autoFocus
                data-testid="planning-new-title"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="What's the goal? (e.g. 'Launch my podcast')"
                style={{
                  padding: "10px 12px",
                  fontSize: "var(--t-lg)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--r-md)",
                  background: "var(--bg)",
                }}
              />
              <textarea
                data-testid="planning-new-description"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                rows={2}
                placeholder="Why does this matter? (the 'why' grounds the plan when things get hard)"
                style={{
                  padding: "10px 12px",
                  fontSize: "var(--t-sm)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--r-md)",
                  background: "var(--bg)",
                  resize: "vertical",
                  fontFamily: "inherit",
                }}
              />
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <select
                  data-testid="planning-new-horizon"
                  value={newHorizon}
                  onChange={(e) => setNewHorizon(e.target.value)}
                  style={{
                    padding: "7px 10px",
                    fontSize: "var(--t-sm)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--r-md)",
                    background: "var(--bg)",
                  }}
                >
                  {["3 months", "6 months", "12 months", "2 years"].map((h) => (
                    <option key={h}>{h}</option>
                  ))}
                </select>
                <div style={{ flex: 1 }} />
                <Button tone="ghost" onClick={() => setShowCreate(false)}>
                  Cancel
                </Button>
                <Button
                  tone="primary"
                  icon="plus"
                  onClick={createGoal}
                  data-api="POST /commands/create-goal"
                  data-testid="planning-new-submit"
                  disabled={running || !newTitle.trim()}
                >
                  Create goal
                </Button>
              </div>
            </div>
          </Card>
        )}

        {!loading && !error && goals.length === 0 && (
          <div data-testid="planning-empty" style={{ padding: 40, textAlign: "center", color: "var(--fg-faint)" }}>
            No goals yet. Click <strong>New goal</strong> to start.
          </div>
        )}

        {goals.length > 0 && (
          <div
            data-testid="planning-goal-grid"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
              gap: 16,
            }}
          >
            {goals.map((g) => (
              <GoalCard
                key={g.id}
                goal={g}
                onOpen={(id) => setView(`goal-plan-${id}` as AppView)}
                onPause={onPause}
                onResume={onResume}
                onDelete={onDelete}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
