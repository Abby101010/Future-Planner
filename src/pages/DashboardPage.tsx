/* ──────────────────────────────────────────────────────────
   NorthStar — Dashboard page (Home)
   Chat-centric interface + Goal entry + Pending queue
   ────────────────────────────────────────────────────────── */

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Check,
  Loader2,
  Target,
  Clock,
  Sparkles,
  RefreshCw,
  Plus,
  MessageCircle,
  X,
  Calendar,
  Send,
  Trash2,
  CheckCircle2,
  XCircle,
  Pencil,
} from "lucide-react";
import useStore from "../store/useStore";
import { useT, getDateLocale } from "../i18n";
import { classifyGoal, generateGoalPlan, analyzeQuickTask, sendHomeChatMessage } from "../services/ai";
import { recordSignal } from "../services/memory";
import AgentProgress from "../components/AgentProgress";
import RichTextToolbar, { IconPicker } from "../components/RichTextToolbar";
import type { GoalImportance, GoalType, Goal, GoalPlanMessage, PendingTask, HomeChatMessage, RepeatSchedule } from "../types";
import "./DashboardPage.css";

export default function DashboardPage() {
  const {
    user,
    goals,
    addGoal,
    removeGoal,
    updateGoal,
    addGoalPlanMessage,
    setGoalPlan,
    todayLog,
    calendarEvents,
    isLoading,
    setLoading,
    error,
    setError,
    setView,
    pendingTasks,
    addPendingTask,
    updatePendingTask,
    removePendingTask,
    confirmPendingTask,
    homeChatMessages,
    addHomeChatMessage,
  } = useStore();

  const t = useT();
  const lang = user?.settings?.language || "en";

  // Goal entry state
  const [goalTitle, setGoalTitle] = useState("");
  const [goalDate, setGoalDate] = useState("");
  const [goalDescription, setGoalDescription] = useState("");
  const [goalIsHabit, setGoalIsHabit] = useState(false);
  const [goalImportance, setGoalImportance] = useState<GoalImportance>("medium");
  const [isClassifying, setIsClassifying] = useState(false);
  const [showGoalForm, setShowGoalForm] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Chat state
  const [chatInput, setChatInput] = useState("");
  const [isChatLoading, setIsChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Agent progress state
  const [showAgentProgress, setShowAgentProgress] = useState(false);

  // Delete goal confirmation state
  const [confirmDeleteGoalId, setConfirmDeleteGoalId] = useState<string | null>(null);

  // Icon picker state
  const [iconPickerGoalId, setIconPickerGoalId] = useState<string | null>(null);

  // Chat input ref for emoji/text insertion
  const chatInputRef = useRef<HTMLInputElement>(null);

  const handleInsertTextToChat = useCallback((text: string) => {
    setChatInput((prev) => prev + text);
    chatInputRef.current?.focus();
  }, []);

  const handleDeleteGoal = useCallback((goalId: string) => {
    removeGoal(goalId);
    setConfirmDeleteGoalId(null);
  }, [removeGoal]);

  // Scroll to bottom when new messages appear
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [homeChatMessages]);

  // Get tasks from allGoalTasks for pending count
  const allGoalTasks = goals.flatMap((g) => {
    const tasks: Array<any> = [];
    if (g.plan && Array.isArray(g.plan.years)) {
      for (const year of g.plan.years) {
        for (const month of year.months) {
          for (const week of month.weeks) {
            if (!week.locked) {
              for (const day of week.days) {
                for (const taskItem of day.tasks) {
                  tasks.push(taskItem);
                }
              }
            }
          }
        }
      }
    }
    if (g.flatPlan) {
      for (const s of g.flatPlan) {
        for (const taskItem of s.tasks) {
          tasks.push(taskItem);
        }
      }
    }
    return tasks;
  });
  const pendingGoalTasks = allGoalTasks.filter((taskItem) => !taskItem.completed);

  // ── Handle chat send ──
  const handleChatSend = useCallback(async () => {
    if (!chatInput.trim() || isChatLoading) return;
    const input = chatInput.trim();
    setChatInput("");
    setIsChatLoading(true);

    // Add user message
    const userMsg: HomeChatMessage = {
      id: `msg-${Date.now()}`,
      role: "user",
      content: input,
      timestamp: new Date().toISOString(),
    };
    addHomeChatMessage(userMsg);

    try {
      // Send to AI for classification
      const chatHistory = homeChatMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const result = await sendHomeChatMessage(
        input,
        chatHistory,
        goals,
        todayLog?.tasks || [],
        calendarEvents
      );

      const replyText = result.reply;

      // Check if AI detected a task
      let isTask = false;
      let taskDescription = "";
      try {
        const parsed = JSON.parse(replyText);
        if (parsed.is_task) {
          isTask = true;
          taskDescription = parsed.task_description || input;
        }
      } catch {
        // Not JSON — it's a regular chat response
      }

      if (isTask) {
        // Create a pending task and analyze it
        const pendingId = `pending-${Date.now()}`;
        const pending: PendingTask = {
          id: pendingId,
          userInput: taskDescription,
          analysis: null,
          status: "analyzing",
          createdAt: new Date().toISOString(),
        };
        addPendingTask(pending);

        // Add assistant message acknowledging the task
        const assistantMsg: HomeChatMessage = {
          id: `msg-${Date.now() + 1}`,
          role: "assistant",
          content: t.home.taskDetected,
          pendingTaskId: pendingId,
          timestamp: new Date().toISOString(),
        };
        addHomeChatMessage(assistantMsg);

        // Analyze in background
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
      } else {
        // Regular chat response
        const assistantMsg: HomeChatMessage = {
          id: `msg-${Date.now() + 1}`,
          role: "assistant",
          content: replyText,
          timestamp: new Date().toISOString(),
        };
        addHomeChatMessage(assistantMsg);
      }
    } catch (err) {
      const errorMsg: HomeChatMessage = {
        id: `msg-${Date.now() + 1}`,
        role: "assistant",
        content: t.home.chatError,
        timestamp: new Date().toISOString(),
      };
      addHomeChatMessage(errorMsg);
    } finally {
      setIsChatLoading(false);
    }
  }, [chatInput, isChatLoading, homeChatMessages, goals, todayLog, calendarEvents, addHomeChatMessage, addPendingTask, updatePendingTask, t]);

  // ── Handle goal submission ──
  const handleGoalSubmit = useCallback(async () => {
    if (!goalTitle.trim()) return;
    setIsClassifying(true);
    setShowAgentProgress(true);
    setError(null);

    try {
      const classification = await classifyGoal(
        goalTitle.trim(),
        goalIsHabit ? "" : goalDate,
        goalImportance,
        goalIsHabit,
        goalDescription.trim()
      );

      const goalType: GoalType = classification.goalType || (classification.scope === "big" ? "big" : "everyday");
      recordSignal("goal_classified", goalType, `${goalTitle.trim()} → ${goalType}`).catch(() => {});

      const newGoal: Goal = {
        id: `goal-${Date.now()}`,
        title: goalTitle.trim(),
        description: goalDescription.trim(),
        targetDate: goalIsHabit ? "" : goalDate || "",
        isHabit: goalIsHabit,
        importance: goalImportance,
        scope: classification.scope,
        goalType,
        status: "pending",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        planChat: [],
        plan: null,
        flatPlan: null,
        planConfirmed: false,
        scopeReasoning: classification.reasoning,
        repeatSchedule: classification.repeatSchedule || null,
        suggestedTimeSlot: classification.suggestedTimeSlot || undefined,
      };

      if (goalType === "repeating") {
        // Repeating goals go directly to active — they appear on the calendar
        newGoal.status = "active";
        newGoal.planConfirmed = true;
        addGoal(newGoal);
      } else if (goalType === "everyday") {
        // Everyday goals get simple task breakdown
        newGoal.status = "active";
        newGoal.planConfirmed = true;
        if (classification.suggestedTasks && classification.suggestedTasks.length > 0) {
          const planSection = {
            id: `section-${Date.now()}`,
            title: goalTitle.trim(),
            content: "",
            order: 1,
            tasks: classification.suggestedTasks.map((task: any, i: number) => ({
              id: `task-${Date.now()}-${i}`,
              title: task.title,
              description: task.description,
              durationMinutes: task.durationMinutes,
              priority: task.priority,
              category: task.category,
              completed: false,
            })),
          };
          newGoal.flatPlan = [planSection];
        }
        addGoal(newGoal);
      } else {
        // Big goals get full plan page
        addGoal(newGoal);
        setLoading(true);
        try {
          const planResult = await generateGoalPlan(
            goalTitle.trim(),
            goalIsHabit ? "" : goalDate,
            goalImportance,
            goalIsHabit,
            goalDescription.trim()
          );
          const aiMsg: GoalPlanMessage = {
            id: `msg-${Date.now()}`,
            role: "assistant",
            content: planResult.reply,
            timestamp: new Date().toISOString(),
          };
          addGoalPlanMessage(newGoal.id, aiMsg);
          if (planResult.plan) {
            setGoalPlan(newGoal.id, planResult.plan);
          }
        } catch {
          // Plan generation failed — user can still chat
        } finally {
          setLoading(false);
        }
        setView(`goal-plan-${newGoal.id}` as any);
      }

      setGoalTitle("");
      setGoalDate("");
      setGoalDescription("");
      setGoalIsHabit(false);
      setGoalImportance("medium");
      setShowGoalForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to classify goal");
    } finally {
      setIsClassifying(false);
      setShowAgentProgress(false);
    }
  }, [goalTitle, goalDate, goalDescription, goalIsHabit, goalImportance, addGoal, addGoalPlanMessage, setGoalPlan, setLoading, setError, setView]);

  // Pending tasks that need attention
  const activePending = pendingTasks.filter((pt) => pt.status === "analyzing" || pt.status === "ready");

  return (
    <div className="dashboard">
      <div className="dashboard-scroll">
        {/* Header */}
        <header className="dashboard-header animate-fade-in">
          <h2>{t.dashboard.headerTitle}</h2>
          {goals.length > 0 && (
            <p className="dashboard-briefing">
              {t.dashboard.goalsCount(goals.length, pendingGoalTasks.length)}
            </p>
          )}
        </header>

        {error && (
          <div className="dashboard-error animate-fade-in">
            <p>{error}</p>
          </div>
        )}

        <AgentProgress visible={showAgentProgress || isClassifying} />

        {/* ── Goal Entry Section ── */}
        <section className="goal-entry-section animate-slide-up">
          {!showGoalForm ? (
            <button
              className="goal-entry-trigger"
              onClick={() => setShowGoalForm(true)}
            >
              <Plus size={18} />
              <span>{t.dashboard.addGoal}</span>
            </button>
          ) : (
            <div className="goal-entry-form card">
              <div className="goal-entry-main-row">
                <input
                  className="input goal-entry-input"
                  type="text"
                  placeholder={t.dashboard.goalPlaceholder}
                  value={goalTitle}
                  onChange={(e) => setGoalTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && goalTitle.trim()) {
                      e.preventDefault();
                      handleGoalSubmit();
                    }
                  }}
                  autoFocus
                />
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleGoalSubmit}
                  disabled={isClassifying || !goalTitle.trim()}
                >
                  {isClassifying ? (
                    <Loader2 size={14} className="spin" />
                  ) : (
                    <Sparkles size={14} />
                  )}
                </button>
              </div>

              <div className="goal-entry-bottom-row">
                <button
                  className="goal-entry-more-btn"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                >
                  {showAdvanced ? "Less options" : "More options"}
                </button>
                <button
                  className="goal-entry-cancel-btn"
                  onClick={() => {
                    setShowGoalForm(false);
                    setShowAdvanced(false);
                    setGoalTitle("");
                    setGoalDate("");
                    setGoalDescription("");
                    setGoalIsHabit(false);
                    setGoalImportance("medium");
                  }}
                >
                  <X size={14} />
                </button>
              </div>

              {showAdvanced && (
                <div className="goal-entry-advanced">
                  <textarea
                    className="input goal-entry-textarea"
                    placeholder={t.dashboard.descriptionPlaceholder}
                    value={goalDescription}
                    onChange={(e) => setGoalDescription(e.target.value)}
                    rows={2}
                  />

                  <div className="goal-entry-row">
                    <div className="goal-entry-field">
                      <div className="timeline-selector">
                        <button
                          className={`timeline-toggle ${!goalIsHabit ? "active" : ""}`}
                          onClick={() => setGoalIsHabit(false)}
                        >
                          <Calendar size={13} /> {t.dashboard.targetDate}
                        </button>
                        <button
                          className={`timeline-toggle ${goalIsHabit ? "active" : ""}`}
                          onClick={() => { setGoalIsHabit(true); setGoalDate(""); }}
                        >
                          <RefreshCw size={13} /> {t.dashboard.habitLabel}
                        </button>
                      </div>
                      {!goalIsHabit && (
                        <input
                          type="date"
                          className="input goal-date-input"
                          value={goalDate}
                          onChange={(e) => setGoalDate(e.target.value)}
                        />
                      )}
                    </div>

                    <div className="goal-entry-field">
                      <div className="importance-selector">
                        {(["low", "medium", "high", "critical"] as GoalImportance[]).map((level) => (
                          <button
                            key={level}
                            className={`importance-btn ${goalImportance === level ? "active" : ""} importance-${level}`}
                            onClick={() => setGoalImportance(level)}
                          >
                            {level}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* ── Big Goals ── */}
        {goals.filter((g) => g.goalType === "big" && g.status !== "archived").length > 0 && (
          <section className="goals-overview animate-slide-up">
            <h3>{t.goalTypes?.bigGoals || "Big Goals"}</h3>
            <div className="goals-grid">
              {goals
                .filter((g) => g.goalType === "big" && g.status !== "archived")
                .map((goal) => {
                  const gTasks: Array<{ completed: boolean }> = [];
                  if (goal.plan && Array.isArray(goal.plan.years)) {
                    for (const yr of goal.plan.years) {
                      for (const mo of yr.months) {
                        for (const wk of mo.weeks) {
                          for (const dy of wk.days) {
                            gTasks.push(...dy.tasks);
                          }
                        }
                      }
                    }
                  }
                  const gCompleted = gTasks.filter((gTask) => gTask.completed).length;
                  const gTotal = gTasks.length;
                  const gPercent = gTotal > 0 ? Math.round((gCompleted / gTotal) * 100) : 0;
                  const isConfirmingDelete = confirmDeleteGoalId === goal.id;
                  return (
                    <div
                      key={goal.id}
                      className="goal-card card goal-card-big"
                      onClick={() => !isConfirmingDelete && setView(`goal-plan-${goal.id}` as any)}
                    >
                      {isConfirmingDelete && (
                        <div className="goal-card-confirm-overlay" onClick={(e) => e.stopPropagation()}>
                          <p>{t.common.delete} "{goal.title}"?</p>
                          <div className="goal-card-confirm-actions">
                            <button className="btn btn-sm btn-danger" onClick={() => handleDeleteGoal(goal.id)}>
                              <Trash2 size={13} /> {t.common.delete}
                            </button>
                            <button className="btn btn-sm btn-ghost" onClick={() => setConfirmDeleteGoalId(null)}>
                              {t.common.cancel}
                            </button>
                          </div>
                        </div>
                      )}
                      <div className="goal-card-top">
                        <button
                          className={`goal-icon-btn ${goal.icon ? "has-icon" : ""}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setIconPickerGoalId(iconPickerGoalId === goal.id ? null : goal.id);
                          }}
                          title="Choose icon"
                        >
                          {goal.icon || "+"}
                        </button>
                        {iconPickerGoalId === goal.id && (
                          <IconPicker
                            currentIcon={goal.icon}
                            onSelect={(icon) => updateGoal(goal.id, { icon })}
                            onClose={() => setIconPickerGoalId(null)}
                          />
                        )}
                        <h4>{goal.title}</h4>
                        <button
                          className="goal-card-close-btn"
                          onClick={(e) => { e.stopPropagation(); setConfirmDeleteGoalId(goal.id); }}
                          title={t.common.delete}
                        >
                          <X size={14} />
                        </button>
                      </div>
                      <div className="goal-card-progress">
                        <div className="goal-card-progress-bar">
                          <div
                            className={`goal-card-progress-fill ${gPercent >= 100 ? "complete" : gPercent >= 50 ? "halfway" : ""}`}
                            style={{ width: `${gPercent}%` }}
                          />
                        </div>
                        <span className="goal-card-progress-text">{gPercent}%</span>
                      </div>
                      {goal.isHabit ? (
                        <span className="goal-card-meta"><RefreshCw size={11} /> {t.common.habit}</span>
                      ) : goal.targetDate ? (
                        <span className="goal-card-meta">
                          {new Date(goal.targetDate).toLocaleDateString(getDateLocale(lang), {
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
            </div>
          </section>
        )}

        {/* ── Everyday Tasks ── */}
        {goals.filter((g) => (g.goalType === "everyday" || (!g.goalType && g.scope === "small")) && g.status !== "archived" && g.status !== "completed").length > 0 && (
          <section className="goals-overview everyday-section animate-slide-up">
            <h3>{t.goalTypes?.everydayTasks || "Everyday Tasks"}</h3>
            <div className="everyday-list">
              {goals
                .filter((g) => (g.goalType === "everyday" || (!g.goalType && g.scope === "small")) && g.status !== "archived" && g.status !== "completed")
                .map((goal) => {
                  const flatTasks = goal.flatPlan?.flatMap((s) => s.tasks) || [];
                  const allDone = flatTasks.length > 0 && flatTasks.every((t) => t.completed);
                  return (
                    <div key={goal.id} className={`everyday-card ${allDone ? "everyday-done" : ""}`}>
                      <div className="everyday-card-header">
                        <span className="everyday-card-title">{goal.title}</span>
                        {goal.suggestedTimeSlot && (
                          <span className="everyday-time-slot">{goal.suggestedTimeSlot}</span>
                        )}
                        <button
                          className="everyday-close-btn"
                          onClick={() => removeGoal(goal.id)}
                        >
                          <X size={13} />
                        </button>
                      </div>
                      {flatTasks.length > 0 && (
                        <div className="everyday-tasks">
                          {flatTasks.map((task) => (
                            <div key={task.id} className={`everyday-task ${task.completed ? "done" : ""}`}>
                              <span className="everyday-task-check">{task.completed ? "✓" : "○"}</span>
                              <span>{task.title}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </section>
        )}

        {/* ── Repeating Events ── */}
        {goals.filter((g) => g.goalType === "repeating" && g.status !== "archived").length > 0 && (
          <section className="goals-overview repeating-section animate-slide-up">
            <h3>{t.goalTypes?.repeatingEvents || "Repeating Events"}</h3>
            <div className="repeating-list">
              {goals
                .filter((g) => g.goalType === "repeating" && g.status !== "archived")
                .map((goal) => {
                  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
                  const schedule = goal.repeatSchedule;
                  return (
                    <div key={goal.id} className="repeating-card">
                      <div className="repeating-card-header">
                        <span className="repeating-card-title">{goal.title}</span>
                        <button
                          className="everyday-close-btn"
                          onClick={() => removeGoal(goal.id)}
                        >
                          <X size={13} />
                        </button>
                      </div>
                      {schedule && (
                        <div className="repeating-schedule">
                          <span className="repeating-days">
                            {schedule.daysOfWeek.map((d) => dayNames[d]).join(", ")}
                          </span>
                          {schedule.timeOfDay && <span className="repeating-time">{schedule.timeOfDay}</span>}
                          <span className="repeating-duration">{schedule.durationMinutes}m</span>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </section>
        )}

        {/* ── Pending Tasks Queue ── */}
        {activePending.length > 0 && (
          <section className="pending-section animate-slide-up">
            <h3>{t.home.pendingTitle}</h3>
            <p className="pending-subtitle">{t.home.pendingSubtitle}</p>
            <div className="pending-list">
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
          </section>
        )}

        {/* ── Chat Section ── */}
        <section className="home-chat-section animate-slide-up">
          {homeChatMessages.length > 0 && (
            <div className="home-chat-messages">
              {homeChatMessages.map((msg) => (
                <div key={msg.id} className={`home-chat-msg home-chat-msg-${msg.role}`}>
                  <div className="home-chat-msg-content">
                    {msg.content}
                  </div>
                </div>
              ))}
              {isChatLoading && (
                <div className="home-chat-msg home-chat-msg-assistant">
                  <div className="home-chat-msg-content home-chat-typing">
                    <Loader2 size={14} className="spin" />
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
          )}

          <div className="home-chat-input-area">
            <RichTextToolbar
              onInsertText={handleInsertTextToChat}
              compact
            />
            <div className="home-chat-input-row">
              <input
                ref={chatInputRef}
                className="input home-chat-input"
                type="text"
                placeholder={t.home.chatPlaceholder}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && chatInput.trim()) {
                    e.preventDefault();
                    handleChatSend();
                  }
                }}
                disabled={isChatLoading}
              />
              <button
                className="btn btn-primary home-chat-send"
                onClick={handleChatSend}
                disabled={isChatLoading || !chatInput.trim()}
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        </section>
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
          🧠 {a.cognitiveWeight}/5
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
          ⚠️ {t.home.conflicts}: {a.conflictsWithExisting.join(", ")}
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
