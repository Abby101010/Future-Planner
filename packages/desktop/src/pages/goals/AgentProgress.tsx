/* ──────────────────────────────────────────────────────────
   NorthStar — AgentProgress Component
   Shows live reasoning/research process from multi-agent system.

   Post-phase-13 the legacy Electron IPC bridge is gone. Progress
   streams will be wired over WS in phase 8 — until then this
   component only renders via the job-based polling mode.
   ────────────────────────────────────────────────────────── */

import { useEffect, useState, useRef, useCallback } from "react";
import {
  Search,
  Brain,
  Sparkles,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Globe,
  Target,
  Zap,
} from "lucide-react";
import type { AgentProgressEvent, AgentId, AgentStatus } from "@northstar/core";
import { wsClient, type EventPayloads } from "../../services/wsClient";
import { useT } from "../../i18n";
import "./AgentProgress.css";

interface AgentProgressProps {
  /** Whether to show the component */
  visible: boolean;
  /** Optional title override */
  title?: string;
}

/** Map agent IDs to display info — monochrome for minimalist theme */
function getAgentInfo(agentId: AgentId, t: ReturnType<typeof useT>) {
  switch (agentId) {
    case "coordinator":
      return { label: t.agents.coordinator, icon: Brain };
    case "research":
      return { label: t.agents.research, icon: Search };
    case "planner":
      return { label: t.agents.planner, icon: Target };
    case "task":
      return { label: t.agents.task, icon: Zap };
    case "news":
      return { label: t.agents.news, icon: Globe };
    case "gatekeeper":
      return { label: "Gatekeeper", icon: Search };
    case "timeEstimator":
      return { label: "Time Estimator", icon: Zap };
    case "scheduler":
      return { label: "Scheduler", icon: Target };
  }
}

/** Map status to icon */
function getStatusIcon(status: AgentStatus) {
  switch (status) {
    case "thinking": return Loader2;
    case "searching": return Search;
    case "analyzing": return Brain;
    case "generating": return Sparkles;
    case "done": return CheckCircle2;
    case "error": return AlertCircle;
    default: return Loader2;
  }
}

function mapPhaseToStatus(phase: string): AgentStatus {
  switch (phase) {
    case "routing": case "starting": case "parallel": return "thinking";
    case "running": return "analyzing";
    case "complete": case "done": return "done";
    case "error": return "error";
    default: return "thinking";
  }
}

export default function AgentProgress({ visible, title }: AgentProgressProps) {
  const [events, setEvents] = useState<AgentProgressEvent[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const t = useT();

  const handleProgress = useCallback((data: EventPayloads["agent:progress"]) => {
    const event: AgentProgressEvent = {
      agentId: data.agentId as AgentId,
      status: mapPhaseToStatus(data.phase),
      message: data.message ?? "",
      timestamp: new Date().toISOString(),
      progress: data.percent,
    };
    setEvents((prev) => [...prev, event]);
  }, []);

  useEffect(() => {
    if (!visible) return;
    setEvents([]);
    return wsClient.subscribe("agent:progress", handleProgress);
  }, [visible, handleProgress]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events]);

  if (!visible || events.length === 0) return null;

  // Get overall progress from the last coordinator event
  const lastCoordinator = [...events].reverse().find(e => e.agentId === "coordinator");
  const overallProgress = lastCoordinator?.progress ?? 0;
  const isDone = lastCoordinator?.status === "done";
  const hasError = events.some(e => e.status === "error");

  return (
    <div className={`agent-progress ${isDone ? "agent-progress--done" : ""} ${hasError ? "agent-progress--error" : ""}`}>
      {/* Header with overall progress */}
      <div className="agent-progress__header">
        <div className="agent-progress__title">
          <Sparkles size={14} />
          <span>{title || t.agents.title}</span>
        </div>
        <div className="agent-progress__bar-wrapper">
          <div
            className="agent-progress__bar"
            style={{ width: `${overallProgress}%` }}
          />
        </div>
      </div>

      {/* Event stream */}
      <div className="agent-progress__events" ref={scrollRef}>
        {events.map((event, i) => {
          const agent = getAgentInfo(event.agentId, t) ?? { label: event.agentId, color: "#888" };
          const StatusIcon = getStatusIcon(event.status);
          const isActive = event.status !== "done" && event.status !== "error" && event.status !== "idle";

          return (
            <div
              key={i}
              className={`agent-progress__event ${event.status === "error" ? "agent-progress__event--error" : ""} ${event.status === "done" ? "agent-progress__event--done" : ""}`}
            >
              <div className="agent-progress__event-icon">
                <StatusIcon
                  size={12}
                  className={isActive ? "agent-progress__spin" : ""}
                />
              </div>
              <div className="agent-progress__event-content">
                <span className="agent-progress__event-agent">
                  {agent.label}
                </span>
                <span className="agent-progress__event-msg">
                  {event.message}
                </span>
                {event.detail && (
                  <div className="agent-progress__event-detail">
                    {event.detail}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
