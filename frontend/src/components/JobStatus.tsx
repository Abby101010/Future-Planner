/* JobStatus — polls /commands/job-status/:jobId until terminal. */

import { useEffect, useState } from "react";
import { getJson } from "../services/transport";

type JobState = {
  state?: string;
  status?: string;
  error?: string | null;
  [k: string]: unknown;
};

const TERMINAL = new Set(["done", "completed", "failed", "error"]);

export default function JobStatus({ jobId }: { jobId: string }) {
  const [state, setState] = useState<JobState | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      try {
        const res = await getJson<JobState>(`/commands/job-status/${jobId}`);
        if (stopped) return;
        setState(res);
        const s = (res?.state ?? res?.status ?? "").toString().toLowerCase();
        if (!TERMINAL.has(s)) {
          timer = setTimeout(poll, 2000);
        }
      } catch (e) {
        if (stopped) return;
        setErr((e as Error).message);
      }
    }
    void poll();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId]);

  return (
    <span className="job-status" data-testid={`job-status-${jobId}`}>
      job <code>{jobId}</code>: {state ? (state.state ?? state.status ?? "pending") : "…"}
      {err && <span data-testid={`job-status-error-${jobId}`}> — error: {err}</span>}
    </span>
  );
}
