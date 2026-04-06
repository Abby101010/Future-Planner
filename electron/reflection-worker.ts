/* ──────────────────────────────────────────────────────────
   NorthStar — Background Reflection Worker
   
   Runs the AI-powered reflection engine off the main thread
   using Electron's utilityProcess (or Node worker_threads
   if running as a standalone server).
   
   This prevents the 2-5 second Claude API call from blocking
   the Electron main process / UI.
   
   Communication: IPC messages between main ↔ worker
   
   Messages IN  (main → worker):
     { type: "reflect", trigger: string, apiKey: string, memoryPath: string }
     { type: "auto-reflect-check" }
   
   Messages OUT (worker → main):
     { type: "reflect-result", success: boolean, newInsights: number, proactiveQuestion: string|null }
     { type: "reflect-error", error: string }
     { type: "should-reflect", shouldReflect: boolean }
   ────────────────────────────────────────────────────────── */

// This file is loaded as a utility process / worker.
// It imports the heavy reflection logic so the main thread stays responsive.

import { parentPort } from "node:worker_threads";

// We need a way to communicate — worker_threads uses parentPort
const port = parentPort;

if (!port) {
  console.error("[Worker] No parentPort — must be run as a worker thread");
  process.exit(1);
}

// Lazy-load heavy modules only when needed
let _reflectionModule: typeof import("./reflection") | null = null;
let _memoryModule: typeof import("./memory") | null = null;

async function getReflection() {
  if (!_reflectionModule) {
    _reflectionModule = await import("./reflection");
  }
  return _reflectionModule;
}

async function getMemory() {
  if (!_memoryModule) {
    _memoryModule = await import("./memory");
  }
  return _memoryModule;
}

port.on("message", async (msg: { type: string; [key: string]: unknown }) => {
  try {
    switch (msg.type) {
      case "reflect": {
        const { trigger, apiKey } = msg as { type: string; trigger: string; apiKey: string };
        if (!apiKey) {
          port!.postMessage({ type: "reflect-error", error: "No API key" });
          return;
        }

        const Anthropic = (await import("@anthropic-ai/sdk")).default;
        const client = new Anthropic({ apiKey });
        const reflection = await getReflection();
        const result = await reflection.runReflection(client, trigger);

        port!.postMessage({
          type: "reflect-result",
          success: result.success,
          newInsights: result.newInsights,
          proactiveQuestion: result.proactiveQuestion,
        });
        break;
      }

      case "auto-reflect-check": {
        const reflection = await getReflection();
        const shouldReflect = reflection.shouldAutoReflect();
        port!.postMessage({ type: "should-reflect", shouldReflect });
        break;
      }

      case "capture-signal": {
        const { signalType, context, value } = msg as {
          type: string; signalType: string; context: string; value: string;
        };
        const reflection = await getReflection();
        reflection.captureSignal(signalType as Parameters<typeof reflection.captureSignal>[0], context, value);
        port!.postMessage({ type: "signal-captured" });
        break;
      }

      case "capture-task-timing": {
        const { taskCategory, taskTitle, estimatedMinutes, actualMinutes } = msg as {
          type: string; taskCategory: string; taskTitle: string;
          estimatedMinutes: number; actualMinutes: number;
        };
        const reflection = await getReflection();
        reflection.captureTaskTiming(taskCategory, taskTitle, estimatedMinutes, actualMinutes);
        port!.postMessage({ type: "timing-captured" });
        break;
      }

      case "generate-nudges": {
        const reflection = await getReflection();
        const { tasks, proactiveQuestion } = msg as {
          type: string; tasks: Parameters<typeof reflection.generateNudges>[0];
          proactiveQuestion: string | null;
        };
        const nudges = reflection.generateNudges(tasks, proactiveQuestion);
        port!.postMessage({ type: "nudges-result", nudges });
        break;
      }

      default:
        port!.postMessage({ type: "error", error: `Unknown message type: ${msg.type}` });
    }
  } catch (err) {
    port!.postMessage({
      type: "reflect-error",
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

port.postMessage({ type: "ready" });
