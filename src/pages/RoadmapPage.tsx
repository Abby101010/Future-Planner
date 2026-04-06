/* ──────────────────────────────────────────────────────────
   NorthStar — Roadmap page (milestone timeline view)
   ────────────────────────────────────────────────────────── */

import {
  CheckCircle,
  Circle,
  Clock,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Shield,
  Target,
  Lightbulb,
} from "lucide-react";
import { useState } from "react";
import useStore from "../store/useStore";
import type { Milestone } from "../types";
import "./RoadmapPage.css";

export default function RoadmapPage() {
  const { roadmap, setView } = useStore();

  if (!roadmap) {
    return (
      <div className="roadmap-empty">
        <p>No roadmap yet.</p>
        <button className="btn btn-primary" onClick={() => setView("onboarding")}>
          Create your roadmap
        </button>
      </div>
    );
  }

  return (
    <div className="roadmap-page">
      <div className="roadmap-scroll">
        {/* Header */}
        <header className="roadmap-header animate-fade-in">
          <h2>{roadmap.goalSummary}</h2>
          <div className="roadmap-meta">
            <span className="badge badge-accent">
              {roadmap.confidenceLevel} confidence
            </span>
            <span className="roadmap-meta-item">
              <Clock size={14} />
              {roadmap.totalEstimatedHours} hours total
            </span>
            <span className="roadmap-meta-item">
              <Target size={14} />
              Target: {formatDate(roadmap.projectedCompletion)}
            </span>
          </div>
        </header>

        {/* Philosophy */}
        <div className="roadmap-philosophy card animate-fade-in">
          <Lightbulb size={16} className="philosophy-icon" />
          <p>{roadmap.planPhilosophy}</p>
        </div>

        {/* Milestones timeline */}
        <div className="milestones-timeline">
          {roadmap.milestones.map((milestone, i) => (
            <MilestoneCard
              key={milestone.id}
              milestone={milestone}
              index={i}
              isLast={i === roadmap.milestones.length - 1}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Milestone card ──

function MilestoneCard({
  milestone,
  index,
  isLast,
}: {
  milestone: Milestone;
  index: number;
  isLast: boolean;
}) {
  const [expanded, setExpanded] = useState(index === 0);

  return (
    <div
      className={`milestone-card animate-slide-up ${milestone.completed ? "completed" : ""}`}
      style={{ animationDelay: `${index * 0.1}s` }}
    >
      {/* Timeline dot and line */}
      <div className="milestone-timeline">
        <div className={`milestone-dot ${milestone.completed ? "done" : ""}`}>
          {milestone.completed ? (
            <CheckCircle size={20} />
          ) : (
            <Circle size={20} />
          )}
        </div>
        {!isLast && <div className="milestone-line" />}
      </div>

      {/* Content */}
      <div className="milestone-content card">
        <div
          className="milestone-header"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="milestone-title-area">
            <h3>
              <span className="milestone-num">M{milestone.id}</span>
              {milestone.title}
            </h3>
            <p className="milestone-desc">{milestone.description}</p>
            <div className="milestone-meta">
              <span className="badge badge-accent">
                Due {formatDate(milestone.targetDate)}
              </span>
              {milestone.completed && (
                <span className="badge badge-green">✓ Completed</span>
              )}
            </div>
          </div>
          <button className="btn btn-icon btn-ghost">
            {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          </button>
        </div>

        {expanded && (
          <div className="milestone-details animate-fade-in">
            {/* Reasoning */}
            <div className="milestone-reasoning">
              <Lightbulb size={14} />
              <p>{milestone.reasoning}</p>
            </div>

            {/* Done criteria */}
            <div className="milestone-criteria">
              <h4>
                <Target size={14} />
                Done when
              </h4>
              <p>{milestone.doneCriteria}</p>
            </div>

            {/* Risk + contingency */}
            <div className="milestone-risk-row">
              <div className="milestone-risk">
                <h4>
                  <AlertTriangle size={14} />
                  Key Risk
                </h4>
                <p>{milestone.keyRisk}</p>
              </div>
              <div className="milestone-contingency">
                <h4>
                  <Shield size={14} />
                  Contingency
                </h4>
                <p>{milestone.contingency}</p>
              </div>
            </div>

            {/* Weekly breakdown */}
            {milestone.monthlyGoals.map((mg) => (
              <div key={mg.month} className="monthly-goal">
                <h4>Month {mg.month}: {mg.title}</h4>
                <div className="weeks-list">
                  {mg.weeklyTasks.map((wt) => (
                    <div key={wt.week} className="week-item">
                      <span className="week-label">Week {wt.week}</span>
                      <span className="week-focus">{wt.focus}</span>
                      {wt.dailyActions.length > 0 && (
                        <div className="daily-actions">
                          {wt.dailyActions.map((da, i) => (
                            <div key={i} className="daily-action">
                              <span className="da-day">{da.day}</span>
                              <span className="da-action">{da.action}</span>
                              <span className="da-time">{da.durationMinutes}m</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}
