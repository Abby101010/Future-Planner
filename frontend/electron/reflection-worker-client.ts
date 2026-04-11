/* ──────────────────────────────────────────────────────────
   NorthStar — Reflection worker client (main-process side)

   Lazily spawns reflection-worker.ts in a worker thread on
   first use, and exposes a small typed promise-based API to
   the rest of the main process.

   Why a worker:
     runReflection() makes a 2-5 second Claude API call. Doing
     that on the Electron main thread freezes the UI for those
     seconds. The worker runs the same code in its own V8
     isolate so the main process stays responsive.

   Why only `reflect` is routed here:
     The other reflection.ts functions (captureSignal,
     captureTaskTiming, generateNudges, shouldAutoReflect) are
     synchronous and microsecond-cheap. The IPC round-trip
     would cost more than running them inline.

   State sync caveat:
     The worker writes new memory facts/preferences through
     its own copy of memory.ts → SQLite. After the worker
     reports done, the main process must call loadMemory() to
     refresh its in-memory cache. The IPC handler does this.
   ────────────────────────────────────────────────────────── */

import { Worker } from "node:worker_threads";
import path from "node:path";

export interface ReflectResult {
  success: boolean;
  newInsights: number;
  proactiveQuestion: string | null;
}

let _worker: Worker | null = null;
let _readyPromise: Promise<void> | null = null;

// Single-flight queue. Reflection runs are infrequent (every few minutes
// at most), so serializing them avoids needing to correlate request IDs
// with the worker's id-less message protocol.
let _inFlight: Promise<unknown> = Promise.resolve();

function workerPath(): string {
  // In dev (vite-plugin-electron), the compiled worker lives next to main.js
  // at dist-electron/reflection-worker.js. In a packaged app it's in the
  // same place inside the asar bundle.
  // __dirname here is dist-electron/ at runtime.
  return path.join(__dirname, "reflection-worker.js");
}

function getWorker(): { worker: Worker; ready: Promise<void> } {
  if (_worker && _readyPromise) {
    return { worker: _worker, ready: _readyPromise };
  }

  const w = new Worker(workerPath());
  _worker = w;

  _readyPromise = new Promise<void>((resolve, reject) => {
    const onMessage = (msg: { type?: string }) => {
      if (msg && msg.type === "ready") {
        w.off("message", onMessage);
        w.off("error", onError);
        resolve();
      }
    };
    const onError = (err: Error) => {
      w.off("message", onMessage);
      w.off("error", onError);
      reject(err);
    };
    w.on("message", onMessage);
    w.on("error", onError);
  });

  w.on("error", (err) => {
    console.error("[ReflectionWorker] error:", err);
  });

  w.on("exit", (code) => {
    console.log(`[ReflectionWorker] exited with code ${code}`);
    _worker = null;
    _readyPromise = null;
  });

  return { worker: w, ready: _readyPromise };
}

/**
 * Run a full Claude-powered reflection in the worker thread.
 * Resolves with the reflection result; rejects if the worker
 * reports an error.
 *
 * Calls are serialized — if a reflect is in flight, the next
 * call waits for it to finish before starting.
 */
export function reflectInWorker(
  trigger: string,
  apiKey: string,
): Promise<ReflectResult> {
  const run = async (): Promise<ReflectResult> => {
    const { worker, ready } = getWorker();
    await ready;

    return await new Promise<ReflectResult>((resolve, reject) => {
      const onMessage = (msg: {
        type?: string;
        success?: boolean;
        newInsights?: number;
        proactiveQuestion?: string | null;
        error?: string;
      }) => {
        if (!msg || !msg.type) return;
        if (msg.type === "reflect-result") {
          worker.off("message", onMessage);
          resolve({
            success: !!msg.success,
            newInsights: msg.newInsights ?? 0,
            proactiveQuestion: msg.proactiveQuestion ?? null,
          });
        } else if (msg.type === "reflect-error") {
          worker.off("message", onMessage);
          reject(new Error(msg.error || "reflect failed"));
        }
      };
      worker.on("message", onMessage);
      worker.postMessage({ type: "reflect", trigger, apiKey });
    });
  };

  // Chain onto the in-flight queue so reflects run one at a time.
  const next = _inFlight.then(run, run);
  _inFlight = next.catch(() => undefined);
  return next;
}

/**
 * Terminate the worker (called from app.before-quit). Safe to
 * call when no worker has been spawned.
 */
export async function terminateReflectionWorker(): Promise<void> {
  if (!_worker) return;
  const w = _worker;
  _worker = null;
  _readyPromise = null;
  try {
    await w.terminate();
  } catch (err) {
    console.warn("[ReflectionWorker] terminate failed:", err);
  }
}

