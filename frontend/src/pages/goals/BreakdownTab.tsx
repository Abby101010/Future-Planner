/* BreakdownTab — Goal Plan "Breakdown" tab: hierarchical tree view.
 *
 * Per contract (lines 155-161): reads view:goal-breakdown?goalId=X and can
 * trigger POST /ai/goal-breakdown for a fresh generation. Absorbs what was
 * previously pages/goals/GoalBreakdownPage.tsx.
 */

import { useMemo, useState } from "react";
import { useQuery } from "../../hooks/useQuery";
import { useCommand } from "../../hooks/useCommand";
import { postJson } from "../../services/transport";
import Button from "../../components/primitives/Button";
import Icon from "../../components/primitives/Icon";
import Pill from "../../components/primitives/Pill";

interface BreakdownTask {
  id: string;
  title: string;
  completed?: boolean;
  duration?: number;
  estimatedDurationMinutes?: number;
}
interface BreakdownDay {
  id?: string;
  date?: string;
  dayName?: string;
  tasks?: BreakdownTask[];
}
interface BreakdownWeek {
  id: string;
  label?: string;
  days?: BreakdownDay[];
  /** True for weeks the planner hasn't filled in yet. UI hides the
   *  expand chevron and renders a muted "locked" pill. */
  locked?: boolean;
}
interface BreakdownMonth {
  id: string;
  label?: string;
  weeks?: BreakdownWeek[];
}
interface BreakdownYear {
  id: string;
  label?: string;
  months?: BreakdownMonth[];
}
interface GoalBreakdownShape {
  id?: string;
  goalSummary?: string;
  totalEstimatedHours?: number;
  yearlyBreakdown?: BreakdownYear[];
}
interface GoalBreakdownView {
  breakdown?: GoalBreakdownShape;
  goalBreakdown?: GoalBreakdownShape;
}

export interface BreakdownTabProps {
  goalId: string;
  goalTitle: string;
}

export default function BreakdownTab({ goalId, goalTitle }: BreakdownTabProps) {
  const { data, loading, error, refetch } = useQuery<GoalBreakdownView>("view:goal-breakdown", {
    goalId,
  });
  const { run: _run, running } = useCommand();
  void _run;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [regenError, setRegenError] = useState<string | null>(null);

  const breakdown = data?.breakdown ?? data?.goalBreakdown;
  const years = breakdown?.yearlyBreakdown ?? [];

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  async function regenerate() {
    setRegenError(null);
    try {
      await postJson("/ai/goal-breakdown", { goalId });
      refetch();
    } catch (e) {
      setRegenError((e as Error).message);
    }
  }

  const totalTasks = useMemo(() => {
    let n = 0;
    for (const y of years) {
      for (const m of y.months ?? []) {
        for (const w of m.weeks ?? []) {
          for (const d of w.days ?? []) {
            n += (d.tasks ?? []).length;
          }
        }
      }
    }
    return n;
  }, [years]);

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <div>
          <h3 className="h-headline" style={{ margin: 0, fontSize: "var(--t-xl)" }}>
            Goal breakdown
          </h3>
          <div style={{ fontSize: "var(--t-sm)", color: "var(--fg-mute)", marginTop: 2 }}>
            Drill from the goal into years → months → weeks → days → tasks.{" "}
            {breakdown?.goalSummary && <span>{breakdown.goalSummary}</span>}
          </div>
        </div>
        <Button
          size="sm"
          tone="primary"
          icon="sparkle"
          onClick={regenerate}
          data-api="POST /ai/goal-breakdown"
          data-testid="breakdown-regenerate"
          disabled={running}
        >
          Re-break down
        </Button>
      </div>

      {loading && !data && (
        <div data-testid="breakdown-loading" style={{ padding: 40, textAlign: "center", color: "var(--fg-faint)" }}>
          Loading breakdown…
        </div>
      )}
      {error && (
        <div
          data-testid="breakdown-error"
          style={{ padding: 20, color: "var(--danger)", fontFamily: "var(--font-mono)", fontSize: 11 }}
        >
          {String(error)}
        </div>
      )}
      {regenError && (
        <div
          data-testid="breakdown-regen-error"
          style={{
            padding: 10,
            color: "var(--danger)",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
          }}
        >
          {regenError}
        </div>
      )}

      {!loading && !error && (
        <div
          data-testid="breakdown-tree"
          style={{
            background: "var(--bg-elev)",
            border: "1px solid var(--border)",
            borderRadius: "var(--r-md)",
            padding: 20,
            fontFamily: "var(--font-mono)",
            fontSize: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0" }}>
            <span style={{ width: 14 }} />
            <Icon name="target" size={14} style={{ color: "var(--accent)" }} />
            <span
              style={{
                fontFamily: "var(--font-sans)",
                fontWeight: 600,
                fontSize: "var(--t-md)",
                color: "var(--fg)",
              }}
            >
              {goalTitle}
            </span>
            <Pill mono tone="gold">
              goal
            </Pill>
            {totalTasks > 0 && (
              <span className="tnum" style={{ marginLeft: "auto", color: "var(--fg-faint)" }}>
                {totalTasks} tasks
              </span>
            )}
          </div>

          {years.length === 0 && (
            <div
              data-testid="breakdown-empty"
              style={{ padding: 20, textAlign: "center", color: "var(--fg-faint)" }}
            >
              No breakdown yet. Click <strong>Re-break down</strong> to generate one.
            </div>
          )}

          {years.map((y) => {
            const yKey = `y:${y.id}`;
            const yOpen = expanded.has(yKey);
            return (
              <div key={y.id}>
                <div
                  onClick={() => toggle(yKey)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 0",
                    paddingLeft: 20,
                    cursor: "pointer",
                    borderTop: "1px dashed var(--border-soft)",
                  }}
                >
                  <Icon name={yOpen ? "chevron-down" : "chevron-right"} size={12} />
                  <span style={{ fontFamily: "var(--font-sans)", fontWeight: 500 }}>
                    {y.label ?? y.id}
                  </span>
                  <Pill mono>year</Pill>
                </div>
                {yOpen &&
                  (y.months ?? []).map((m) => {
                    const mKey = `m:${m.id}`;
                    const mOpen = expanded.has(mKey);
                    return (
                      <div key={m.id}>
                        <div
                          onClick={() => toggle(mKey)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "6px 0",
                            paddingLeft: 40,
                            cursor: "pointer",
                            borderTop: "1px dashed var(--border-soft)",
                          }}
                        >
                          <Icon name={mOpen ? "chevron-down" : "chevron-right"} size={12} />
                          <Icon name="calendar" size={13} />
                          <span style={{ fontFamily: "var(--font-sans)", fontWeight: 500 }}>
                            {m.label ?? m.id}
                          </span>
                          <Pill mono>month</Pill>
                        </div>
                        {mOpen &&
                          (m.weeks ?? []).map((w) => {
                            const wKey = `w:${w.id}`;
                            const wOpen = expanded.has(wKey);
                            const isLocked = Boolean(w.locked);
                            return (
                              <div key={w.id}>
                                <div
                                  onClick={isLocked ? undefined : () => toggle(wKey)}
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8,
                                    padding: "6px 0",
                                    paddingLeft: 60,
                                    cursor: isLocked ? "default" : "pointer",
                                    borderTop: "1px dashed var(--border-soft)",
                                    opacity: isLocked ? 0.6 : 1,
                                  }}
                                >
                                  {isLocked ? (
                                    <span style={{ display: "inline-block", width: 12 }} />
                                  ) : (
                                    <Icon
                                      name={wOpen ? "chevron-down" : "chevron-right"}
                                      size={12}
                                    />
                                  )}
                                  <Icon name={isLocked ? "pause" : "tree"} size={13} />
                                  <span style={{ fontFamily: "var(--font-sans)", fontWeight: 500 }}>
                                    {w.label ?? w.id}
                                  </span>
                                  <Pill mono>{isLocked ? "locked" : "week"}</Pill>
                                </div>
                                {!isLocked && wOpen &&
                                  (w.days ?? [])
                                    .filter((d) => (d.tasks ?? []).length > 0)
                                    .map((d) => (
                                      <div key={d.id ?? d.date}>
                                        <div
                                          style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 8,
                                            padding: "4px 0",
                                            paddingLeft: 80,
                                            borderTop: "1px dashed var(--border-soft)",
                                            fontSize: 10,
                                            letterSpacing: "0.08em",
                                            textTransform: "uppercase",
                                            color: "var(--fg-faint)",
                                            fontWeight: 600,
                                          }}
                                        >
                                          <Icon name="calendar" size={11} />
                                          <span className="tnum">{d.date || "—"}</span>
                                          {d.dayName && (
                                            <span style={{ textTransform: "none", fontWeight: 500 }}>
                                              · {d.dayName}
                                            </span>
                                          )}
                                        </div>
                                        {(d.tasks ?? []).map((t) => (
                                          <div
                                            key={t.id}
                                            data-testid={`breakdown-task-${t.id}`}
                                            style={{
                                              display: "flex",
                                              alignItems: "center",
                                              gap: 8,
                                              padding: "4px 0",
                                              paddingLeft: 100,
                                              borderTop: "1px dashed var(--border-soft)",
                                            }}
                                          >
                                            <span
                                              style={{
                                                width: 12,
                                                height: 12,
                                                border: "1.2px solid var(--border-strong)",
                                                borderRadius: "50%",
                                                background: t.completed ? "var(--navy)" : "transparent",
                                              }}
                                            />
                                            <span
                                              style={{
                                                fontSize: "var(--t-sm)",
                                                fontFamily: "var(--font-sans)",
                                                color: t.completed
                                                  ? "var(--fg-faint)"
                                                  : "var(--user-color)",
                                                textDecoration: t.completed ? "line-through" : "none",
                                              }}
                                            >
                                              {t.title}
                                            </span>
                                            <Pill mono>task</Pill>
                                            <span
                                              className="tnum"
                                              style={{
                                                marginLeft: "auto",
                                                color: "var(--fg-faint)",
                                              }}
                                            >
                                              {t.estimatedDurationMinutes ?? t.duration ?? "?"}m
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    ))}
                              </div>
                            );
                          })}
                      </div>
                    );
                  })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
