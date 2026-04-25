/* MonthlyIntensityCard — month-start busyness nudge.
 *
 * Three local states share one component:
 *   - rest: a small pill ("BUSY · 2/day") when a context exists.
 *     Clicking flips to editing.
 *   - editing: free-text input ("How busy are you this month?…").
 *     Submit fires `monthlyContextRepo.analyze` → confirming.
 *   - confirming: shows the AI-classified intensity + reasoning +
 *     editable cap. Save dispatches `command:save-monthly-context`,
 *     onSaved() refetches, and the card collapses to rest.
 *
 * Trigger:
 *   `view:dashboard.needsMonthlyContext === true` on the first day
 *   the user opens the app in a new month, or whenever no context
 *   exists for `current month`. Tasks page renders us regardless of
 *   trigger when a context already exists (rest mode pill).
 *
 * Source-of-truth contract:
 *   - Card calls `monthly-context:analyze` (existing AI handler) for
 *     NLP — no FE NLP. Mapping intensity → multiplier/maxDailyTasks
 *     lives server-side in handleAnalyzeMonthlyContext.
 *   - Save uses `command:save-monthly-context` — same path the
 *     Settings editor uses. Invalidation map fires view:tasks +
 *     view:dashboard + view:planning so the card dismisses and
 *     `lightTriage` picks up the new cap on its next pass.
 */

import { useState } from "react";
import type { MonthlyContext } from "@starward/core";
import { useCommand } from "../../hooks/useCommand";
import { monthlyContextRepo, type MonthlyContextAnalysis } from "../../repositories";
import Button from "../../components/primitives/Button";

export interface MonthlyIntensityCardProps {
  /** Current month's context if any. null → start in editing/empty mode. */
  current: MonthlyContext | null;
  /** YYYY-MM. The view emits this; we don't recompute client-side. */
  monthKey: string;
  /** Caller refetches view:tasks + view:dashboard. */
  onSaved: () => void;
}

type Mode = "rest" | "editing" | "confirming";

const INTENSITIES = ["free", "light", "normal", "busy", "intense"] as const;
type Intensity = (typeof INTENSITIES)[number];

/** Default mapping mirrors the server-side enum
 *  (backend/core/src/ai/prompts/analysis.ts). Used only when the user
 *  manually overrides the intensity in the confirm step — the AI
 *  result already comes with its own multiplier+cap. */
const INTENSITY_DEFAULTS: Record<Intensity, { multiplier: number; max: number }> = {
  free: { multiplier: 1.5, max: 5 },
  light: { multiplier: 1.2, max: 4 },
  normal: { multiplier: 1.0, max: 3 },
  busy: { multiplier: 0.6, max: 2 },
  intense: { multiplier: 0.3, max: 1 },
};

const INTENSITY_LABEL: Record<Intensity, string> = {
  free: "FREE",
  light: "LIGHT",
  normal: "NORMAL",
  busy: "BUSY",
  intense: "INTENSE",
};

function intensityColor(i: Intensity): string {
  switch (i) {
    case "intense":
      return "var(--danger)";
    case "busy":
      return "var(--accent)";
    case "free":
    case "light":
      return "var(--success, var(--accent))";
    default:
      return "var(--fg-mute)";
  }
}

export default function MonthlyIntensityCard({
  current,
  monthKey,
  onSaved,
}: MonthlyIntensityCardProps) {
  const { run, running } = useCommand();
  const [mode, setMode] = useState<Mode>(current ? "rest" : "editing");
  const [description, setDescription] = useState(current?.description ?? "");
  const [analysis, setAnalysis] = useState<MonthlyContextAnalysis | null>(null);
  const [intensity, setIntensity] = useState<Intensity>(
    (current?.intensity as Intensity) ?? "normal",
  );
  const [error, setError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  async function analyze() {
    if (!description.trim()) return;
    setError(null);
    setAnalyzing(true);
    try {
      const result = await monthlyContextRepo.analyze({
        month: monthKey,
        description: description.trim(),
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setAnalysis(result);
      if (result.intensity && (INTENSITIES as readonly string[]).includes(result.intensity)) {
        setIntensity(result.intensity as Intensity);
      }
      setMode("confirming");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAnalyzing(false);
    }
  }

  async function save() {
    setError(null);
    const defaults = INTENSITY_DEFAULTS[intensity];
    const ctx: MonthlyContext = {
      month: monthKey,
      description: description.trim() || (current?.description ?? ""),
      intensity,
      intensityReasoning: analysis?.intensityReasoning ?? current?.intensityReasoning ?? "",
      capacityMultiplier: analysis?.capacityMultiplier ?? defaults.multiplier,
      maxDailyTasks: analysis?.maxDailyTasks ?? defaults.max,
      updatedAt: new Date().toISOString(),
    };
    try {
      await run("command:save-monthly-context" as never, { context: ctx });
      onSaved();
      setMode("rest");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const cap = current?.maxDailyTasks ?? analysis?.maxDailyTasks ?? INTENSITY_DEFAULTS[intensity].max;
  const restIntensity = (current?.intensity as Intensity | undefined) ?? intensity;

  if (mode === "rest" && current) {
    return (
      <button
        data-testid="monthly-intensity-pill"
        onClick={() => {
          setDescription(current.description ?? "");
          setMode("editing");
        }}
        title={current.intensityReasoning || "Click to edit this month's busyness"}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "3px 8px",
          fontSize: "var(--t-2xs)",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          fontWeight: 600,
          color: intensityColor(restIntensity),
          border: `1px solid ${intensityColor(restIntensity)}`,
          background: "transparent",
          borderRadius: 4,
          cursor: "pointer",
        }}
      >
        <span>{INTENSITY_LABEL[restIntensity]}</span>
        <span style={{ opacity: 0.5 }}>·</span>
        <span className="tnum">{cap}/day</span>
      </button>
    );
  }

  return (
    <section
      data-testid="monthly-intensity-card"
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--r-md)",
        padding: 18,
        background: "var(--bg-soft)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span
            style={{
              fontSize: "var(--t-2xs)",
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--fg-faint)",
              fontWeight: 600,
            }}
          >
            {monthKey} · monthly busyness
          </span>
          <span style={{ fontSize: "var(--t-md)", color: "var(--fg)", fontWeight: 600 }}>
            {mode === "confirming" ? "Confirm this month's load" : "How busy are you this month?"}
          </span>
        </div>
        {current && (
          <Button
            size="xs"
            tone="ghost"
            onClick={() => setMode("rest")}
            data-testid="monthly-intensity-cancel"
          >
            Cancel
          </Button>
        )}
      </header>

      {mode === "editing" && (
        <>
          <textarea
            data-testid="monthly-intensity-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="exams, vacation week 3, light month, deadline crunch…"
            rows={2}
            style={{
              border: "1px solid var(--border)",
              borderRadius: "var(--r-sm)",
              padding: "8px 10px",
              fontSize: "var(--t-sm)",
              fontFamily: "inherit",
              background: "var(--bg)",
              color: "var(--fg)",
              resize: "vertical",
            }}
          />
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Button
              size="sm"
              tone="primary"
              onClick={analyze}
              disabled={analyzing || !description.trim()}
              data-api="POST /monthly-context/analyze"
              data-testid="monthly-intensity-analyze"
            >
              {analyzing ? "Analyzing…" : "Analyze"}
            </Button>
            <span style={{ fontSize: "var(--t-xs)", color: "var(--fg-faint)" }}>
              We classify the month with AI, then you confirm.
            </span>
          </div>
        </>
      )}

      {mode === "confirming" && (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 10px",
              border: "1px solid var(--border)",
              borderRadius: "var(--r-sm)",
              background: "var(--bg)",
            }}
          >
            <select
              data-testid="monthly-intensity-select"
              value={intensity}
              onChange={(e) => setIntensity(e.target.value as Intensity)}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 3,
                padding: "2px 6px",
                fontSize: "var(--t-sm)",
                background: "var(--bg)",
                color: "var(--fg)",
                fontFamily: "var(--font-mono)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                fontWeight: 600,
              }}
            >
              {INTENSITIES.map((i) => (
                <option key={i} value={i}>
                  {INTENSITY_LABEL[i]}
                </option>
              ))}
            </select>
            <span style={{ fontSize: "var(--t-sm)", color: "var(--fg-mute)" }}>
              {analysis?.maxDailyTasks ?? INTENSITY_DEFAULTS[intensity].max}/day ·{" "}
              capacity{" "}
              {(analysis?.capacityMultiplier ?? INTENSITY_DEFAULTS[intensity].multiplier).toFixed(1)}×
            </span>
          </div>
          {analysis?.intensityReasoning && (
            <p
              style={{
                fontSize: "var(--t-sm)",
                color: "var(--fg-mute)",
                lineHeight: 1.4,
                margin: 0,
              }}
            >
              {analysis.intensityReasoning}
            </p>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <Button
              size="sm"
              tone="primary"
              onClick={save}
              disabled={running}
              data-api="POST /commands/save-monthly-context"
              data-testid="monthly-intensity-save"
            >
              Save
            </Button>
            <Button
              size="sm"
              tone="ghost"
              onClick={() => setMode("editing")}
              disabled={running}
              data-testid="monthly-intensity-edit"
            >
              Edit
            </Button>
          </div>
        </>
      )}

      {error && (
        <div
          data-testid="monthly-intensity-error"
          style={{
            fontSize: 11,
            color: "var(--danger)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {error}
        </div>
      )}
    </section>
  );
}
