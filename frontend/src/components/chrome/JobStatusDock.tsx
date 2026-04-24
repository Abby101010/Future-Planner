/* JobStatusDock — bottom-left toast stack tracking async jobs.
 *
 * Polls `GET /commands/job-status/:jobId` every 2s until the job reaches a
 * terminal status (contract line 249). Jobs are registered through the
 * module-level `startJob(id, label)` helper — any command handler that
 * returns `{jobId, async:true}` should call this. */

import { useEffect, useState } from "react";
import { getJson } from "../../services/transport";
import Pill from "../primitives/Pill";

interface Job {
  id: string;
  label: string;
  status: "running" | "done" | "error";
  progress: number;
}

const jobsStore: Job[] = [];
const listeners = new Set<(js: Job[]) => void>();

function emit() {
  for (const fn of listeners) fn(jobsStore.slice());
}

export function startJob(id: string, label: string): void {
  const existing = jobsStore.find((j) => j.id === id);
  if (existing) return;
  jobsStore.unshift({ id, label, status: "running", progress: 0 });
  emit();
  pollJob(id);
}

async function pollJob(id: string) {
  const deadline = Date.now() + 5 * 60 * 1000; // 5-minute safety timeout
  while (Date.now() < deadline) {
    try {
      // Backend returns { ok: true, job: { id, type, status, result, error } }
      // (see backend/src/routes/commands.ts:93-102). Unwrap the envelope.
      const res = await getJson<{
        ok?: boolean;
        job?: { status?: string; state?: string; progress?: number };
        // Fallback shapes for older handlers that didn't nest under `job`.
        state?: string;
        status?: string;
        progress?: number;
      }>(`/commands/job-status/${id}`);
      const jobBody = res?.job ?? res;
      const raw = (jobBody?.state ?? jobBody?.status ?? "").toLowerCase();
      const status: Job["status"] =
        raw === "done" || raw === "completed" || raw === "succeeded"
          ? "done"
          : raw === "error" || raw === "failed" || raw === "cancelled"
            ? "error"
            : "running";
      const progress = typeof jobBody?.progress === "number" ? jobBody.progress : 0;
      const idx = jobsStore.findIndex((j) => j.id === id);
      if (idx >= 0) {
        jobsStore[idx] = { ...jobsStore[idx], status, progress };
        emit();
        if (status !== "running") {
          setTimeout(() => {
            const i = jobsStore.findIndex((j) => j.id === id);
            if (i >= 0) {
              jobsStore.splice(i, 1);
              emit();
            }
          }, 3500);
          return;
        }
      }
    } catch {
      /* transient failure; keep polling */
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  // Timeout: mark error + auto-dismiss.
  const idx = jobsStore.findIndex((j) => j.id === id);
  if (idx >= 0) {
    jobsStore[idx] = { ...jobsStore[idx], status: "error" };
    emit();
    setTimeout(() => {
      const i = jobsStore.findIndex((j) => j.id === id);
      if (i >= 0) {
        jobsStore.splice(i, 1);
        emit();
      }
    }, 3500);
  }
}

export default function JobStatusDock() {
  const [jobs, setJobs] = useState<Job[]>([]);
  useEffect(() => {
    const fn = (js: Job[]) => setJobs(js);
    listeners.add(fn);
    fn(jobsStore.slice());
    return () => {
      listeners.delete(fn);
    };
  }, []);
  if (jobs.length === 0) return null;
  return (
    <aside
      data-testid="job-status-dock"
      style={{
        position: "fixed",
        left: 20,
        bottom: 20,
        zIndex: 55,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        maxWidth: 340,
      }}
    >
      {jobs.map((j) => (
        <div
          key={j.id}
          data-testid={`job-${j.id}`}
          style={{
            background: "var(--bg-elev)",
            border: "1px solid var(--border)",
            borderRadius: "var(--r-md)",
            boxShadow: "var(--shadow-2)",
            padding: "10px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 6,
            animation: "ns-slide-up .2s ease",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                minWidth: 0,
                flex: 1,
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: j.status === "done" ? "var(--success)" : j.status === "error" ? "var(--danger)" : "var(--accent)",
                  flexShrink: 0,
                  animation: j.status === "running" ? "ns-pulse 1.2s infinite" : "none",
                }}
              />
              <div
                style={{
                  fontSize: "var(--t-sm)",
                  fontWeight: 500,
                  color: "var(--fg)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {j.label}
              </div>
            </div>
            <Pill mono tone={j.status === "done" ? "success" : j.status === "error" ? "danger" : "warn"}>
              {j.status}
            </Pill>
          </div>
          <div
            style={{
              height: 3,
              background: "var(--bg-sunken)",
              borderRadius: 2,
              overflow: "hidden",
              position: "relative",
            }}
          >
            {j.status === "running" && j.progress <= 0 ? (
              // Server doesn't report a numeric progress, so show an
              // indeterminate shimmer band to signal "still working".
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  height: "100%",
                  width: "40%",
                  background:
                    "linear-gradient(90deg, transparent 0%, var(--accent) 50%, transparent 100%)",
                  animation: "ns-indeterminate 1.2s ease-in-out infinite",
                }}
              />
            ) : (
              <div
                style={{
                  height: "100%",
                  width: `${
                    j.status === "done"
                      ? 100
                      : j.status === "error"
                        ? 100
                        : Math.min(100, Math.max(0, j.progress))
                  }%`,
                  background: j.status === "error" ? "var(--danger)" : "var(--accent)",
                  transition: "width .25s",
                }}
              />
            )}
          </div>
          <div
            style={{
              fontSize: 10,
              color: "var(--fg-faint)",
              fontFamily: "var(--font-mono)",
            }}
          >
            GET /commands/job-status/{j.id}
          </div>
        </div>
      ))}
    </aside>
  );
}
