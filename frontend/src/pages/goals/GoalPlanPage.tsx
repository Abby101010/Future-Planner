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
import PlanningInFlight from "./PlanningInFlight";

interface GoalPlanMilestone {
  id: string;
  title: string;
  due?: string;
  targetDate?: string;
  status?: string;
  pct?: number;
  percent?: number;
}

interface InFlightDescriptor {
  jobId: string;
  status: "pending" | "running";
  startedAt: string;
}

/** Mirrors backend/src/views/goalPlanView.ts GoalPlanView. Three states
 *  are observable here; see the JSDoc on the backend interface for a
 *  full explanation. The FE chooses its render branch by checking
 *  `data.plan` and `data.inFlight`:
 *
 *    loading  — `data == null` (HTTP fetch in flight)
 *    generating — `data.inFlight != null` (optionally plan == null)
 *    ready    — `data.plan != null`
 *    empty    — `data.plan == null && data.inFlight == null` (never requested)
 */
interface GoalPlanView {
  goal?: {
    id: string;
    title: string;
    icon?: string;
    horizon?: string;
    targetDate?: string;
    startedAt?: string;
  };
  plan?: unknown;
  milestones?: GoalPlanMilestone[];
  progress?: { percent?: number; paceDelta?: string };
  paceMismatch?: unknown;
  inFlight?: InFlightDescriptor | null;
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
  // The page has four distinct render states. Keep this flag explicit so
  // every branch below is unambiguous; see the GoalPlanView JSDoc above.
  //   data.inFlight != null && !data.plan → show PlanningInFlight
  //   data.inFlight != null &&  data.plan → show plan WITH "Regenerating" badge
  //   data.plan               != null     → show plan normally
  //   otherwise                           → empty-state (existing milestone list empty)
  const inFlight = data?.inFlight ?? null;
  const isGeneratingFirstPlan = !!inFlight && !data?.plan && milestones.length === 0;

  async function onPause() {
    setCmdError(null);
    try {
      await run("command:pause-goal", { goalId });
      refetch();
    } catch (e) {
      setCmdError((e as Error).message);
    }
  }
  async function onDelete() {
    if (!window.confirm("Delete this goal?")) return;
    setCmdError(null);
    try {
      await run("command:delete-goal", { goalId });
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

      {/* Tabs only rendered once a plan exists; while generating the first
          plan, the tabs would point at empty content (Breakdown: nothing
          to show; Dashboard: 0% everything). Hiding them keeps the user
          focused on the in-flight state. */}
      {!isGeneratingFirstPlan && (
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "plan", label: "Plan", icon: "planning" },
            { id: "breakdown", label: "Breakdown", icon: "tree", badge: milestones.length },
            { id: "dashboard", label: "Dashboard", icon: "target" },
          ]}
        />
      )}

      <div
        data-state={
          loading && !data
            ? "loading"
            : error
              ? "error"
              : isGeneratingFirstPlan
                ? "planning-inflight"
                : data?.plan
                  ? "ready"
                  : "empty"
        }
        style={{ maxWidth: 1280, margin: "0 auto", width: "100%", padding: "24px 32px 96px" }}
      >
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

        {/* First-plan-generating branch: render the full skeleton instead
            of the empty PlanTab. When the WS view:invalidate fires on
            job completion, useQuery refetches and this condition flips
            false, falling through to the normal tab content. */}
        {!loading && !error && isGeneratingFirstPlan && inFlight && (
          <PlanningInFlight
            startedAt={inFlight.startedAt}
            status={inFlight.status}
            horizon={goal?.horizon}
          />
        )}

        {!isGeneratingFirstPlan && tab === "plan" && (
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
        {!isGeneratingFirstPlan && tab === "breakdown" && (
          <BreakdownTab goalId={goalId} goalTitle={title} />
        )}
        {!isGeneratingFirstPlan && tab === "dashboard" && <DashboardTab goalId={goalId} />}
      </div>
    </>
  );
}
