/* ──────────────────────────────────────────────────────────
   NorthStar — AgentProgress Component
   Shows live reasoning/research process from multi-agent system.

   Supports two modes:
   1. Legacy: listens to "agent:progress" IPC events (fragile)
   2. Job-based: polls job:status for progress_log (resilient)
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
// TODO(phase8): wire plan-job tracking via WS
const getJobStatus = async (
  _jobId: string,
): Promise<{
  status: string;
  progress: number;
  progress_log: unknown[];
  result: unknown;
  error: string | null;
} | null> => null;
import { useT } from "../i18n";
import "./AgentProgress.css";

interface AgentProgressProps {
  /** Whether to show the component */
  visible: boolean;
  /** Optional title override */
  title?: string;
  /** Job ID to poll for progress (resilient mode) */
  jobId?: string | null;
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

export default function AgentProgress({ visible, title, jobId }: AgentProgressProps) {
  const [events, setEvents] = useState<AgentProgressEvent[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const t = useT();

  // Mode 1: Job-based polling (resilient — survives focus loss)
  useEffect(() => {
    if (!visible || !jobId) return;

    setEvents([]);
    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;

      const status = await getJobStatus(jobId);
      if (cancelled) return;

      if (status) {
        const log = (status.progress_log || []) as AgentProgressEvent[];
        setEvents(log);

        // Keep polling if job is still active
        if (status.status === "pending" || status.status === "running") {
          setTimeout(poll, 1000);
        }
      } else {
        // Job not found yet, retry
        setTimeout(poll, 1000);
      }
    };

    poll();

    return () => { cancelled = true; };
  }, [visible, jobId]);

  // Mode 2: Legacy IPC event listener (fallback for non-job-based calls)
  useEffect(() => {
    if (!visible || jobId) return; // skip if using job-based mode

    setEvents([]);

    const handler = (...args: unknown[]) => {
      const event = args[0] as AgentProgressEvent;
      setEvents((prev) => [...prev, event]);
    };

    const unsubscribe = window.electronAPI.on("agent:progress", handler);

    return () => {
      // Properly remove the IPC listener so we don't leak events across mounts
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, [visible, jobId]);

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
          const agent = getAgentInfo(event.agentId, t);
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
