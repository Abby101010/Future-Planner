/* DashboardTab — Goal Plan "Dashboard" tab: per-goal dashboard.
 *
 * Contract mapping (prototype → contract):
 *   goal/generate-dashboard-insights → command:regenerate-insights
 *   /memory/goal/save-note           → command:update-goal-notes
 *   /memory/goal/delete-note         → command:update-goal-notes with ""
 *   /goal/update-rhythm-cadence      → DROPPED (not in contract)
 *
 * Reads view:goal-dashboard?goalId=X.
 * Absorbs what was previously pages/goals/GoalDashboardPage.tsx.
 */

import { useEffect, useState } from "react";
import { useQuery } from "../../hooks/useQuery";
import { useCommand } from "../../hooks/useCommand";
import useStore from "../../store/useStore";
import type {
  AIObservation,
  DashboardProgressData,
  Goal,
  GoalPlanMilestone,
  InsightCard,
} from "@starward/core";
import Button from "../../components/primitives/Button";
import Pill from "../../components/primitives/Pill";
import Icon from "../../components/primitives/Icon";

interface GoalDashboardActivity {
  date: string;
  completed: boolean;
  reflection: string | null;
}
interface GoalDashboardView {
  goal: Goal | null;
  milestones: GoalPlanMilestone[];
  progress: DashboardProgressData;
  insightCards: InsightCard[];
  recentActivity: GoalDashboardActivity[];
  aiObservations: AIObservation[];
}

export interface DashboardTabProps {
  goalId: string;
}

export default function DashboardTab({ goalId }: DashboardTabProps) {
  const { data, loading, error, refetch } = useQuery<GoalDashboardView>("view:goal-dashboard", {
    goalId,
  });
  const { run, running } = useCommand();
  const setChatOpen = useStore((s) => s.setChatOpen);
  const setChatChannel = useStore((s) => s.setChatChannel);
  const setChatGoalId = useStore((s) => s.setChatGoalId);

  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [reflection, setReflection] = useState("");
  const [cmdError, setCmdError] = useState<string | null>(null);

  useEffect(() => {
    if (data?.goal) {
      setTitle(data.goal.title ?? "");
      setNotes((data.goal as unknown as { userNotes?: string }).userNotes ?? "");
    }
  }, [data?.goal?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveTitle() {
    if (!title.trim()) return;
    setCmdError(null);
    try {
      await run("command:edit-goal-title", { goalId, newTitle: title });
      refetch();
    } catch (e) {
      setCmdError((e as Error).message);
    }
  }

  async function saveNotes() {
    setCmdError(null);
    try {
      await run("command:update-goal-notes", { goalId, notes });
      refetch();
    } catch (e) {
      setCmdError((e as Error).message);
    }
  }

  async function addReflection() {
    if (!reflection.trim()) return;
    setCmdError(null);
    try {
      await run("command:add-goal-reflection", { goalId, reflection });
      setReflection("");
      refetch();
    } catch (e) {
      setCmdError((e as Error).message);
    }
  }

  async function regenerateInsights() {
    setCmdError(null);
    try {
      await run("command:regenerate-insights", { goalId });
      refetch();
    } catch (e) {
      setCmdError((e as Error).message);
    }
  }

  function openChat() {
    setChatChannel("goal-plan");
    setChatGoalId(goalId);
    setChatOpen(true);
  }

  const progress = data?.progress;
  const milestones = data?.milestones ?? [];
  const insightCards = data?.insightCards ?? [];
  const activity = data?.recentActivity ?? [];
  const observations = data?.aiObservations ?? [];
  const projectedCompletion = progress?.projectedCompletion ?? "";

  return (
    <div
      data-testid="dashboard-tab"
      style={{
        display: "grid",
        gridTemplateColumns: "1.6fr 1fr",
        gap: 24,
        alignItems: "flex-start",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }}>
        {loading && !data && (
          <div data-testid="dashboard-loading" style={{ color: "var(--fg-faint)" }}>
            Loading dashboard…
          </div>
        )}
        {error && (
          <div
            data-testid="dashboard-error"
            style={{ color: "var(--danger)", fontFamily: "var(--font-mono)", fontSize: 11 }}
          >
            {String(error)}
          </div>
        )}
        {cmdError && (
          <div
            data-testid="dashboard-cmd-error"
            style={{ color: "var(--danger)", fontFamily: "var(--font-mono)", fontSize: 11 }}
          >
            {cmdError}
          </div>
        )}

        <section>
          <div
            style={{
              fontSize: 9,
              letterSpacing: "0.18em",
              color: "var(--fg-faint)",
              textTransform: "uppercase",
              fontWeight: 600,
              marginBottom: 6,
            }}
          >
            Goal title
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              data-testid="dashboard-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              style={{
                flex: 1,
                padding: "8px 10px",
                border: "1px solid var(--border)",
                borderRadius: 4,
                fontSize: "var(--t-md)",
                background: "var(--bg)",
              }}
            />
            <Button
              size="sm"
              tone="primary"
              onClick={saveTitle}
              data-api="POST /commands/edit-goal-title"
              data-testid="dashboard-title-save"
              disabled={running || !title.trim()}
            >
              Save
            </Button>
          </div>
        </section>

        {progress && (
          <section>
            <div
              style={{
                fontSize: 9,
                letterSpacing: "0.18em",
                color: "var(--fg-faint)",
                textTransform: "uppercase",
                fontWeight: 600,
                marginBottom: 6,
              }}
            >
              Overview
            </div>
            <div
              data-testid="dashboard-progress"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: 12,
              }}
            >
              {[
                { label: "Complete", val: `${Math.round(progress.percent)}%`, sub: progress.status },
                {
                  label: "Tasks done",
                  val: `${progress.completedTasks}/${progress.totalTasks}`,
                  sub: "",
                },
                {
                  label: "Milestones",
                  val: `${progress.currentMilestoneIndex + 1}/${progress.totalMilestones}`,
                  sub: "current",
                },
                { label: "Projected", val: projectedCompletion || "—", sub: "" },
              ].map((k) => (
                <div
                  key={k.label}
                  style={{
                    background: "var(--bg-elev)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--r-md)",
                    padding: 14,
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      letterSpacing: "0.12em",
                      color: "var(--fg-faint)",
                      textTransform: "uppercase",
                      fontWeight: 600,
                    }}
                  >
                    {k.label}
                  </div>
                  <div
                    className="num-gold tnum"
                    style={{ fontSize: 22, lineHeight: 1.1, marginTop: 4 }}
                  >
                    {k.val}
                  </div>
                  {k.sub && (
                    <div
                      className="tnum"
                      style={{ fontSize: 10, color: "var(--fg-faint)", marginTop: 2 }}
                    >
                      {k.sub}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {milestones.length > 0 && (
          <section>
            <div
              style={{
                fontSize: 9,
                letterSpacing: "0.18em",
                color: "var(--fg-faint)",
                textTransform: "uppercase",
                fontWeight: 600,
                marginBottom: 6,
              }}
            >
              Milestones
            </div>
            <div
              data-testid="dashboard-milestones"
              style={{
                background: "var(--bg-elev)",
                border: "1px solid var(--border)",
                borderRadius: "var(--r-md)",
                padding: 14,
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              {milestones.map((m) => (
                <div
                  key={m.id}
                  data-testid={`dashboard-milestone-${m.id}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "14px 1fr 90px",
                    gap: 10,
                    alignItems: "center",
                    padding: "4px 0",
                  }}
                >
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      background: "var(--border-strong)",
                    }}
                  />
                  <span style={{ fontSize: "var(--t-sm)", color: "var(--user-color)" }}>
                    {m.title}
                  </span>
                  <span
                    className="tnum"
                    style={{ fontSize: 10, color: "var(--fg-faint)", textAlign: "right" }}
                  >
                    {(m as unknown as { targetDate?: string }).targetDate ?? ""}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        <section>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              marginBottom: 6,
            }}
          >
            <div
              style={{
                fontSize: 9,
                letterSpacing: "0.18em",
                color: "var(--fg-faint)",
                textTransform: "uppercase",
                fontWeight: 600,
              }}
            >
              Insights
            </div>
            <Button
              size="xs"
              tone="ghost"
              icon="sparkle"
              onClick={regenerateInsights}
              data-api="POST /commands/regenerate-insights"
              data-testid="dashboard-regenerate-insights"
              disabled={running}
            >
              Regenerate
            </Button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {insightCards.length === 0 && (
              <div
                style={{
                  padding: 20,
                  textAlign: "center",
                  color: "var(--fg-faint)",
                  background: "var(--bg-elev)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--r-md)",
                }}
              >
                No insights yet. Click Regenerate.
              </div>
            )}
            {insightCards.map((c) => (
              <div
                key={c.id}
                data-testid={`dashboard-insight-${c.id}`}
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
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "var(--t-sm)", fontWeight: 600, color: "var(--fg)" }}>
                    {c.title}
                  </div>
                  <pre
                    style={{
                      fontSize: 11,
                      color: "var(--fg-mute)",
                      marginTop: 3,
                      whiteSpace: "pre-wrap",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {JSON.stringify(c.props, null, 2)}
                  </pre>
                </div>
                <Pill mono>{c.cardType}</Pill>
              </div>
            ))}
          </div>
        </section>

        {activity.length > 0 && (
          <section>
            <div
              style={{
                fontSize: 9,
                letterSpacing: "0.18em",
                color: "var(--fg-faint)",
                textTransform: "uppercase",
                fontWeight: 600,
                marginBottom: 6,
              }}
            >
              Recent activity
            </div>
            <div
              data-testid="dashboard-activity"
              style={{
                background: "var(--bg-elev)",
                border: "1px solid var(--border)",
                borderRadius: "var(--r-md)",
                padding: 14,
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              {activity.map((a, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    gap: 8,
                    fontSize: "var(--t-sm)",
                    color: a.completed ? "var(--success)" : "var(--fg-mute)",
                  }}
                >
                  <span className="tnum">{a.date}</span>
                  <span>{a.completed ? "✓" : "—"}</span>
                  {a.reflection && <span style={{ color: "var(--fg-mute)" }}>{a.reflection}</span>}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      <aside style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <section>
          <div
            style={{
              fontSize: 9,
              letterSpacing: "0.18em",
              color: "var(--fg-faint)",
              textTransform: "uppercase",
              fontWeight: 600,
              marginBottom: 6,
            }}
          >
            Notes
          </div>
          <div
            style={{
              background: "var(--bg-elev)",
              border: "1px solid var(--border)",
              borderRadius: "var(--r-md)",
              padding: 12,
            }}
          >
            <textarea
              data-testid="dashboard-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="Capture a thought on this goal…"
              style={{
                width: "100%",
                border: "1px solid var(--border)",
                borderRadius: 4,
                padding: "8px 10px",
                fontSize: "var(--t-sm)",
                fontFamily: "inherit",
                resize: "vertical",
              }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
              <Button
                size="xs"
                tone="primary"
                icon="check"
                onClick={saveNotes}
                data-api="POST /commands/update-goal-notes"
                data-testid="dashboard-notes-save"
                disabled={running}
              >
                Save notes
              </Button>
            </div>
          </div>
        </section>

        <section>
          <div
            style={{
              fontSize: 9,
              letterSpacing: "0.18em",
              color: "var(--fg-faint)",
              textTransform: "uppercase",
              fontWeight: 600,
              marginBottom: 6,
            }}
          >
            Reflection
          </div>
          <div
            style={{
              background: "var(--bg-elev)",
              border: "1px solid var(--border)",
              borderRadius: "var(--r-md)",
              padding: 12,
            }}
          >
            <textarea
              data-testid="dashboard-reflection"
              value={reflection}
              onChange={(e) => setReflection(e.target.value)}
              rows={3}
              placeholder="What went well / what's blocking you today?"
              style={{
                width: "100%",
                border: "1px solid var(--border)",
                borderRadius: 4,
                padding: "8px 10px",
                fontSize: "var(--t-sm)",
                fontFamily: "inherit",
                resize: "vertical",
              }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
              <Button
                size="xs"
                tone="primary"
                icon="plus"
                onClick={addReflection}
                data-api="POST /commands/add-goal-reflection"
                data-testid="dashboard-reflection-add"
                disabled={running || !reflection.trim()}
              >
                Add
              </Button>
            </div>
          </div>
        </section>

        {observations.length > 0 && (
          <section>
            <div
              style={{
                fontSize: 9,
                letterSpacing: "0.18em",
                color: "var(--fg-faint)",
                textTransform: "uppercase",
                fontWeight: 600,
                marginBottom: 6,
              }}
            >
              AI observations
            </div>
            <div
              data-testid="dashboard-observations"
              style={{
                background: "var(--bg-elev)",
                border: "1px solid var(--border)",
                borderRadius: "var(--r-md)",
                padding: 12,
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              {observations.map((o) => (
                <div key={o.id} style={{ fontSize: "var(--t-sm)" }}>
                  <Pill mono>{o.tone}</Pill> {o.text}
                </div>
              ))}
            </div>
          </section>
        )}

        <section>
          <div
            style={{
              fontSize: 9,
              letterSpacing: "0.18em",
              color: "var(--fg-faint)",
              textTransform: "uppercase",
              fontWeight: 600,
              marginBottom: 6,
            }}
          >
            Goal-scoped chat
          </div>
          <div
            style={{
              background: "var(--bg-elev)",
              border: "1px solid var(--border)",
              borderRadius: "var(--r-md)",
              padding: 12,
            }}
          >
            <Button
              size="sm"
              tone="primary"
              icon="chat"
              onClick={openChat}
              data-api="POST /ai/goal-plan-chat/stream"
              data-testid="dashboard-chat-open"
              style={{ width: "100%", justifyContent: "center" }}
            >
              Chat about this goal
            </Button>
          </div>
        </section>
      </aside>
    </div>
  );
}
