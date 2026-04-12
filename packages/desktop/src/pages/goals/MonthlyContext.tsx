/* ──────────────────────────────────────────────────────────
   NorthStar — Monthly Context component
   Shows current month's life context and allows editing.

   Phase 6a: prop-driven. Parents pass in the current month's
   context (from `view:planning` or `view:dashboard`) plus
   callbacks for save/delete. This component owns only the
   ephemeral form state and the AI analyze round-trip.
   ────────────────────────────────────────────────────────── */

import { useState } from "react";
import { CalendarDays, Loader2, Send, Pencil, Trash2 } from "lucide-react";
import type { MonthlyContext as MonthlyContextType } from "@northstar/core";
import { monthlyContextRepo } from "../../repositories";
import "./MonthlyContext.css";

const INTENSITY_LABELS: Record<string, { label: string; color: string }> = {
  free: { label: "Free", color: "var(--green)" },
  light: { label: "Light", color: "var(--green-light, #8bc34a)" },
  normal: { label: "Normal", color: "var(--accent)" },
  busy: { label: "Busy", color: "var(--orange, #ff9800)" },
  intense: { label: "Intense", color: "var(--red, #f44336)" },
};

interface Props {
  context: MonthlyContextType | null;
  onSave: (context: MonthlyContextType) => void | Promise<void>;
  onDelete: (month: string) => void | Promise<void>;
}

export default function MonthlyContext({ context, onSave, onDelete }: Props) {
  const [description, setDescription] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentMonth = new Date().toISOString().substring(0, 7);
  const ctx = context;

  const monthLabel = new Date(currentMonth + "-15T12:00:00").toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  const handleSubmit = async () => {
    if (!description.trim()) return;
    setIsAnalyzing(true);
    setError(null);

    try {
      const result = await monthlyContextRepo.analyze({
        month: currentMonth,
        description: description.trim(),
      });

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

        await onSave(newCtx);

        setDescription("");
        setIsEditing(false);
      } else {
        const errMsg = result?.error || "Failed to analyze context";
        setError(/credit balance|billing|too low/i.test(errMsg)
          ? "AI features are temporarily unavailable. Please check your API billing."
          : errMsg);
      }
    } catch (err) {
      const errMsg = String(err);
      setError(/credit balance|billing|too low/i.test(errMsg)
        ? "AI features are temporarily unavailable. Please check your API billing."
        : errMsg);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleDelete = async () => {
    await onDelete(currentMonth);
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
