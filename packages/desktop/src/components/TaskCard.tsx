import { useState, useEffect } from "react";
import { Check, Clock, Play, Pause, AlarmClock, SkipForward } from "lucide-react";
import { useT } from "../i18n";
import type { DailyTask } from "@northstar/core";

interface Props {
  task: DailyTask;
  isOneThing: boolean;
  onToggle: () => void;
  onSnooze: () => void;
  onSkip: () => void;
  onStartTimer: () => void;
  onStopTimer: () => void;
  index: number;
}

function formatElapsed(secs: number) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function TaskCard({
  task,
  isOneThing,
  onToggle,
  onSnooze,
  onSkip,
  onStartTimer,
  onStopTimer,
  index,
}: Props) {
  const [elapsed, setElapsed] = useState(0);
  const isTimerRunning = !!task.startedAt;
  const t = useT();

  useEffect(() => {
    if (!task.startedAt) {
      setElapsed(0);
      return;
    }
    const start = new Date(task.startedAt).getTime();
    const tick = () => setElapsed(Math.round((Date.now() - start) / 1000));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [task.startedAt]);

  const isSkipped = !!task.skipped;

  return (
    <div
      className={`task-card ${task.completed ? "completed" : ""} ${isOneThing ? "one-thing" : ""} ${isSkipped ? "skipped" : ""} ${isTimerRunning ? "timer-active" : ""}`}
      style={{ animationDelay: `${index * 0.04}s` }}
    >
      <div
        className={`task-checkbox ${task.completed ? "checked" : ""}`}
        onClick={onToggle}
      >
        {task.completed && <Check size={14} />}
      </div>

      <div className="task-content">
        <div className="task-title-row">
          <span className="task-title">{task.title}</span>
          {isOneThing && <span className="badge badge-accent">{t.dashboard.priority}</span>}
          {isSkipped && <span className="badge badge-red">{t.dashboard.skipped}</span>}
        </div>
        <p className="task-description">{task.description}</p>
        <div className="task-meta">
          <span className="task-duration">
            <Clock size={11} />
            {task.actualMinutes
              ? `${task.actualMinutes}/${task.durationMinutes}m`
              : `${task.durationMinutes}m`}
          </span>
          <span className="task-meta-sep" />
          <span className="task-meta-label">{task.category}</span>
          {isTimerRunning && (
            <span className="task-timer-badge">
              <Play size={10} />
              {formatElapsed(elapsed)}
            </span>
          )}
        </div>

        {!task.completed && !isSkipped && (
          <div className="task-actions">
            {isTimerRunning ? (
              <button className="btn btn-ghost btn-xs task-action-btn" onClick={onStopTimer}>
                <Pause size={12} /> {t.dashboard.stop}
              </button>
            ) : (
              <button className="btn btn-ghost btn-xs task-action-btn" onClick={onStartTimer}>
                <Play size={12} /> {t.dashboard.timer}
              </button>
            )}
            <button className="btn btn-ghost btn-xs task-action-btn" onClick={onSnooze}>
              <AlarmClock size={12} /> {t.dashboard.snooze}
            </button>
            <button className="btn btn-ghost btn-xs task-action-btn task-action-skip" onClick={onSkip}>
              <SkipForward size={12} /> {t.dashboard.skip}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
