/* GoalPlanPage — designed per-goal page with 3 tabs (Plan / Breakdown / Dashboard).
 *
 * Per contract (lines 145-175): this page absorbs the per-goal Breakdown
 * (line 155) and Dashboard (line 163) sub-sections. Reads view:goal-plan;
 * tabs lazy-load view:goal-breakdown and view:goal-dashboard as needed.
 */

import { useState } from "react";
import useStore from "../../store/useStore";
import { useQuery } from "../../hooks/useQuery";
import { useCommand } from "../../hooks/useCommand";
import TopBar from "../../components/primitives/TopBar";
import Button from "../../components/primitives/Button";
import Tabs from "../../components/primitives/Tabs";
import PlanTab from "./PlanTab";
import BreakdownTab from "./BreakdownTab";
import DashboardTab from "./DashboardTab";

interface GoalPlanMilestone {
  id: string;
  title: string;
  due?: string;
  targetDate?: string;
  status?: string;
  pct?: number;
  percent?: number;
}

interface GoalPlanView {
  goal?: {
    id: string;
    title: string;
    icon?: string;
    horizon?: string;
    targetDate?: string;
    startedAt?: string;
  };
  milestones?: GoalPlanMilestone[];
  progress?: { percent?: number; paceDelta?: string };
  paceMismatch?: unknown;
}

export default function GoalPlanPage({ goalId }: { goalId: string }) {
  const setView = useStore((s) => s.setView);
  const { data, loading, error, refetch } = useQuery<GoalPlanView>("view:goal-plan", { goalId });
  const { run, running } = useCommand();
  const [tab, setTab] = useState<"plan" | "breakdown" | "dashboard">("plan");
  const [cmdError, setCmdError] = useState<string | null>(null);

  const goal = data?.goal;
  const title = goal?.title ?? goalId;
  const milestones = (data?.milestones ?? []) as GoalPlanMilestone[];

  async function onPause() {
    setCmdError(null);
    try {
      await run("command:pause-goal", { id: goalId });
      refetch();
    } catch (e) {
      setCmdError((e as Error).message);
    }
  }
  async function onDelete() {
    if (!window.confirm("Delete this goal?")) return;
    setCmdError(null);
    try {
      await run("command:delete-goal", { id: goalId });
      setView("planning");
    } catch (e) {
      setCmdError((e as Error).message);
    }
  }

  return (
    <>
      <TopBar
        breadcrumbs={[{ label: "Planning", onClick: () => setView("planning") }, { label: title }]}
        eyebrow={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            {goal?.icon && <span style={{ fontSize: 14 }}>{goal.icon}</span>}
            {goal?.horizon ?? ""}
            {goal?.startedAt && <> · started {goal.startedAt}</>}
          </span>
        }
        title={title}
        right={
          <>
            <Button
              size="sm"
              tone="ghost"
              icon="arrow-left"
              onClick={() => setView("planning")}
              data-testid="goal-plan-back"
            >
              Planning
            </Button>
            <Button
              size="sm"
              tone="ghost"
              icon="pause"
              onClick={onPause}
              data-api="POST /commands/pause-goal"
              data-testid="goal-plan-pause"
              disabled={running}
            >
              Pause
            </Button>
            <Button
              size="sm"
              tone="danger"
              icon="trash"
              onClick={onDelete}
              data-api="POST /commands/delete-goal"
              data-testid="goal-plan-delete"
              disabled={running}
            >
              Delete
            </Button>
          </>
        }
      />

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "plan", label: "Plan", icon: "planning" },
          { id: "breakdown", label: "Breakdown", icon: "tree", badge: milestones.length },
          { id: "dashboard", label: "Dashboard", icon: "target" },
        ]}
      />

      <div style={{ maxWidth: 1280, margin: "0 auto", width: "100%", padding: "24px 32px 96px" }}>
        {loading && !data && (
          <div data-testid="goal-plan-loading" style={{ padding: 40, textAlign: "center", color: "var(--fg-faint)" }}>
            Loading goal…
          </div>
        )}
        {error && (
          <div
            data-testid="goal-plan-error"
            style={{ padding: 20, color: "var(--danger)", fontFamily: "var(--font-mono)", fontSize: 11 }}
          >
            {String(error)}
          </div>
        )}
        {cmdError && (
          <div
            data-testid="goal-plan-cmd-error"
            style={{ padding: 10, color: "var(--danger)", fontFamily: "var(--font-mono)", fontSize: 11 }}
          >
            {cmdError}
          </div>
        )}

        {tab === "plan" && (
          <PlanTab
            goalId={goalId}
            goalTitle={title}
            goalPct={data?.progress?.percent}
            goalPaceDelta={data?.progress?.paceDelta}
            goalTargetDate={goal?.targetDate}
            milestones={milestones}
            onRefetch={refetch}
          />
        )}
        {tab === "breakdown" && <BreakdownTab goalId={goalId} goalTitle={title} />}
        {tab === "dashboard" && <DashboardTab goalId={goalId} />}
      </div>
    </>
  );
}
