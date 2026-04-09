/* ──────────────────────────────────────────────────────────
   NorthStar — Monthly Context component
   Shows current month's life context and allows editing
   ────────────────────────────────────────────────────────── */

import { useState } from "react";
import { CalendarDays, Loader2, Send, Pencil, Trash2 } from "lucide-react";
import useStore from "../store/useStore";
import type { MonthlyContext as MonthlyContextType } from "../types";
import "./MonthlyContext.css";

const INTENSITY_LABELS: Record<string, { label: string; color: string }> = {
  free: { label: "Free", color: "var(--green)" },
  light: { label: "Light", color: "var(--green-light, #8bc34a)" },
  normal: { label: "Normal", color: "var(--accent)" },
  busy: { label: "Busy", color: "var(--orange, #ff9800)" },
  intense: { label: "Intense", color: "var(--red, #f44336)" },
};

export default function MonthlyContext() {
  const { getCurrentMonthContext, setMonthlyContext, removeMonthlyContext } = useStore();
  const [description, setDescription] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentMonth = new Date().toISOString().substring(0, 7);
  const ctx = getCurrentMonthContext();

  const monthLabel = new Date(currentMonth + "-15T12:00:00").toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  const handleSubmit = async () => {
    if (!description.trim()) return;
    setIsAnalyzing(true);
    setError(null);

    try {
      const result = await window.electronAPI.invoke("monthly-context:analyze", {
        month: currentMonth,
        description: description.trim(),
      }) as {
        intensity?: string;
        intensityReasoning?: string;
        capacityMultiplier?: number;
        maxDailyTasks?: number;
        error?: string;
      };

      if (result && !result.error) {
        const newCtx: MonthlyContextType = {
          month: currentMonth,
          description: description.trim(),
          intensity: (result.intensity || "normal") as MonthlyContextType["intensity"],
          intensityReasoning: result.intensityReasoning || "",
          capacityMultiplier: result.capacityMultiplier ?? 1.0,
          maxDailyTasks: result.maxDailyTasks ?? 3,
          updatedAt: new Date().toISOString(),
        };

        setMonthlyContext(newCtx);

        // Persist to database
        await window.electronAPI.invoke("monthly-context:upsert", {
          month: newCtx.month,
          description: newCtx.description,
          intensity: newCtx.intensity,
          intensityReasoning: newCtx.intensityReasoning,
          capacityMultiplier: newCtx.capacityMultiplier,
          maxDailyTasks: newCtx.maxDailyTasks,
        });

        setDescription("");
        setIsEditing(false);
      } else {
        setError(result?.error || "Failed to analyze context");
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleDelete = async () => {
    removeMonthlyContext(currentMonth);
    try {
      await window.electronAPI.invoke("monthly-context:delete", { month: currentMonth });
    } catch { /* ignore */ }
    setIsEditing(false);
  };

  const intensityInfo = ctx ? INTENSITY_LABELS[ctx.intensity] || INTENSITY_LABELS.normal : null;

  // Show existing context
  if (ctx && !isEditing) {
    return (
      <div className="monthly-context-card card">
        <div className="monthly-context-header">
          <div className="monthly-context-title">
            <CalendarDays size={16} />
            <span>{monthLabel}</span>
          </div>
          <div className="monthly-context-actions">
            <button
              className="monthly-context-action-btn"
              onClick={() => {
                setDescription(ctx.description);
                setIsEditing(true);
              }}
              title="Edit"
            >
              <Pencil size={14} />
            </button>
            <button
              className="monthly-context-action-btn monthly-context-delete"
              onClick={handleDelete}
              title="Remove"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
        <div className="monthly-context-body">
          <div
            className="monthly-context-intensity-badge"
            style={{ background: intensityInfo?.color }}
          >
            {intensityInfo?.label}
          </div>
          <p className="monthly-context-description">{ctx.description}</p>
          {ctx.intensityReasoning && (
            <p className="monthly-context-reasoning">{ctx.intensityReasoning}</p>
          )}
          <div className="monthly-context-stats">
            <span>Max {ctx.maxDailyTasks} tasks/day</span>
            <span>{Math.round(ctx.capacityMultiplier * 100)}% capacity</span>
          </div>
        </div>
      </div>
    );
  }

  // Show input form
  return (
    <div className="monthly-context-card card">
      <div className="monthly-context-header">
        <div className="monthly-context-title">
          <CalendarDays size={16} />
          <span>{monthLabel}</span>
        </div>
      </div>
      <p className="monthly-context-prompt">
        {isEditing
          ? "Update what this month looks like for you:"
          : "What does this month look like? (exams, vacation, busy period...)"}
      </p>
      {error && <p className="monthly-context-error">{error}</p>}
      <div className="monthly-context-input-row">
        <input
          className="input monthly-context-input"
          type="text"
          placeholder="e.g., Finals week, then vacation starting the 20th"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && description.trim()) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          disabled={isAnalyzing}
        />
        <button
          className="btn btn-primary btn-sm"
          onClick={handleSubmit}
          disabled={!description.trim() || isAnalyzing}
        >
          {isAnalyzing ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
        </button>
      </div>
      {isEditing && (
        <button
          className="monthly-context-cancel"
          onClick={() => {
            setIsEditing(false);
            setDescription("");
          }}
        >
          Cancel
        </button>
      )}
    </div>
  );
}
