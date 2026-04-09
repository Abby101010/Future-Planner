/* ──────────────────────────────────────────────────────────
   NorthStar — Dashboard page (Home)
   Minimalistic single-query interface: input at top,
   AI response beneath, pending tasks below.
   ────────────────────────────────────────────────────────── */

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Check,
  Loader2,
  Clock,
  Send,
  Calendar,
  CheckCircle2,
  XCircle,
  Pencil,
} from "lucide-react";
import useStore from "../store/useStore";
import { useT } from "../i18n";
import { analyzeQuickTask, sendHomeChatMessage } from "../services/ai";
import type { PendingTask, HomeChatMessage } from "../types";
import "./DashboardPage.css";

export default function DashboardPage() {
  const {
    goals,
    todayLog,
    calendarEvents,
    pendingTasks,
    addPendingTask,
    updatePendingTask,
    removePendingTask,
    confirmPendingTask,
    homeChatMessages,
    addHomeChatMessage,
    clearHomeChat,
  } = useStore();

  const t = useT();

  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [aiResponse, setAiResponse] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Clear previous conversation on mount
  useEffect(() => {
    clearHomeChat();
  }, [clearHomeChat]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || isLoading) return;
    const query = input.trim();
    setInput("");
    setIsLoading(true);
    setAiResponse(null);

    try {
      const result = await sendHomeChatMessage(
        query,
        [],
        goals,
        todayLog?.tasks || [],
        calendarEvents
      );

      const replyText = result.reply;

      // Check if AI detected a task or context change
      let isTask = false;
      let taskDescription = "";
      let displayText = replyText;

      try {
        const parsed = JSON.parse(replyText);
        if (parsed.is_task) {
          isTask = true;
          taskDescription = parsed.task_description || query;
          displayText = t.home.taskDetected;
        } else if (parsed.context_change) {
          displayText = parsed.suggestion
            ? `I noticed a change in your situation. ${parsed.suggestion}\n\nYou can update your monthly context in the Planning tab.`
            : "It sounds like things have changed. Update your monthly context in the Planning tab.";
        }
      } catch {
        // Not JSON — regular response
      }

      setAiResponse(displayText);

      if (isTask) {
        const pendingId = `pending-${Date.now()}`;
        const pending: PendingTask = {
          id: pendingId,
          userInput: taskDescription,
          analysis: null,
          status: "analyzing",
          createdAt: new Date().toISOString(),
        };
        addPendingTask(pending);

        try {
          const analysis = await analyzeQuickTask(
            taskDescription,
            todayLog?.tasks || [],
            goals,
            calendarEvents
          );
          updatePendingTask(pendingId, {
            status: "ready",
            analysis: {
              title: analysis.title,
              description: analysis.description,
              suggestedDate: analysis.suggested_date,
              durationMinutes: analysis.duration_minutes,
              cognitiveWeight: analysis.cognitive_weight,
              priority: analysis.priority,
              category: analysis.category,
              reasoning: analysis.reasoning,
              conflictsWithExisting: analysis.conflicts_with_existing,
            },
          });
        } catch {
          updatePendingTask(pendingId, { status: "rejected" });
        }
      }
    } catch {
      setAiResponse(t.home.chatError);
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, goals, todayLog, calendarEvents, addPendingTask, updatePendingTask, t]);

  const activePending = pendingTasks.filter((pt) => pt.status === "analyzing" || pt.status === "ready");

  return (
    <div className="dashboard">
      <div className="dashboard-home">
        {/* ── Input at top ── */}
        <div className="home-input-section">
          <div className="home-input-row">
            <input
              ref={inputRef}
              className="home-input"
              type="text"
              placeholder="Ask anything, add a task, or check your progress..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && input.trim()) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              disabled={isLoading}
            />
            <button
              className="btn btn-primary home-send-btn"
              onClick={handleSend}
              disabled={isLoading || !input.trim()}
            >
              {isLoading ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
            </button>
          </div>
        </div>

        {/* ── AI Response ── */}
        {(aiResponse || isLoading) && (
          <div className="home-response-section">
            {isLoading && !aiResponse ? (
              <div className="home-response-loading">
                <Loader2 size={18} className="spin" />
                <span>Thinking...</span>
              </div>
            ) : aiResponse ? (
              <div className="home-response-content">
                {aiResponse}
              </div>
            ) : null}
          </div>
        )}

        {/* ── Pending Tasks ── */}
        {activePending.length > 0 && (
          <div className="home-pending-section">
            {activePending.map((pt) => (
              <PendingTaskCard
                key={pt.id}
                pendingTask={pt}
                onConfirm={() => confirmPendingTask(pt.id)}
                onReject={() => removePendingTask(pt.id)}
                onUpdateAnalysis={(updates) => {
                  if (pt.analysis) {
                    updatePendingTask(pt.id, {
                      analysis: { ...pt.analysis, ...updates },
                    });
                  }
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Pending Task Card ──

function PendingTaskCard({
  pendingTask,
  onConfirm,
  onReject,
  onUpdateAnalysis,
}: {
  pendingTask: PendingTask;
  onConfirm: () => void;
  onReject: () => void;
  onUpdateAnalysis: (updates: Partial<NonNullable<PendingTask["analysis"]>>) => void;
}) {
  const t = useT();
  const [editingDesc, setEditingDesc] = useState(false);
  const [editDesc, setEditDesc] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState("");

  if (pendingTask.status === "analyzing") {
    return (
      <div className="pending-card pending-card-analyzing">
        <div className="pending-card-header">
          <Loader2 size={14} className="spin" />
          <span className="pending-card-input">"{pendingTask.userInput}"</span>
        </div>
        <p className="pending-card-status">{t.home.analyzing}</p>
      </div>
    );
  }

  if (!pendingTask.analysis) return null;
  const a = pendingTask.analysis;

  const weightColors: Record<number, string> = {
    1: "badge-weight-1", 2: "badge-weight-2", 3: "badge-weight-3",
    4: "badge-weight-4", 5: "badge-weight-5",
  };

  return (
    <div className="pending-card pending-card-ready">
      <div className="pending-card-header">
        <CheckCircle2 size={14} className="pending-ready-icon" />
        {editingTitle ? (
          <input
            className="input pending-edit-input pending-edit-title"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onBlur={() => {
              if (editTitle.trim()) onUpdateAnalysis({ title: editTitle.trim() });
              setEditingTitle(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (editTitle.trim()) onUpdateAnalysis({ title: editTitle.trim() });
                setEditingTitle(false);
              }
              if (e.key === "Escape") setEditingTitle(false);
            }}
            autoFocus
          />
        ) : (
          <span
            className="pending-card-title pending-editable"
            onClick={() => { setEditTitle(a.title); setEditingTitle(true); }}
            title="Click to edit"
          >
            {a.title}
            <Pencil size={11} className="pending-edit-icon" />
          </span>
        )}
      </div>
      {a.description && (
        editingDesc ? (
          <textarea
            className="input pending-edit-input pending-edit-desc"
            value={editDesc}
            onChange={(e) => setEditDesc(e.target.value)}
            onBlur={() => {
              onUpdateAnalysis({ description: editDesc.trim() });
              setEditingDesc(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onUpdateAnalysis({ description: editDesc.trim() });
                setEditingDesc(false);
              }
              if (e.key === "Escape") setEditingDesc(false);
            }}
            rows={2}
            autoFocus
          />
        ) : (
          <p
            className="pending-card-desc pending-editable"
            onClick={() => { setEditDesc(a.description); setEditingDesc(true); }}
            title="Click to edit"
          >
            {a.description}
            <Pencil size={11} className="pending-edit-icon" />
          </p>
        )
      )}
      <div className="pending-card-meta">
        <span className="badge badge-accent">{a.category}</span>
        <span className={`badge ${weightColors[a.cognitiveWeight] || ""}`}>
          {a.cognitiveWeight}/5
        </span>
        <span className="pending-card-duration">
          <Clock size={12} /> {a.durationMinutes}m
        </span>
        <span className="pending-card-date">
          <Calendar size={12} /> {a.suggestedDate}
        </span>
      </div>
      {a.conflictsWithExisting.length > 0 && (
        <p className="pending-card-conflict">
          {t.home.conflicts}: {a.conflictsWithExisting.join(", ")}
        </p>
      )}
      <div className="pending-card-actions">
        <button className="btn btn-primary btn-sm" onClick={onConfirm}>
          <Check size={14} /> {t.home.confirmTask}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onReject}>
          <XCircle size={14} /> {t.home.rejectTask}
        </button>
      </div>
    </div>
  );
}
