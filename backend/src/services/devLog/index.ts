/* ──────────────────────────────────────────────────────────
   Starward — Dev-mode action log: facade

   Single import surface for the rest of the server. When
   gated off, every export is a no-op — the writer module
   isn't loaded at all.
   ────────────────────────────────────────────────────────── */

import type { DevLogEntryInput } from "@starward/core";
import type { DevLogWriter } from "./writer";

export const DEV_LOG_ENABLED =
  process.env.NODE_ENV !== "production" &&
  process.env.NORTHSTAR_DEV_LOGGING === "1";

/** Opt-in flag to skip truncation in details payloads. */
export const DEV_LOG_FULL_PAYLOADS =
  DEV_LOG_ENABLED && process.env.NORTHSTAR_DEV_LOGGING_FULL === "1";

let writer: DevLogWriter | null = null;

export async function initDevLog(): Promise<void> {
  if (!DEV_LOG_ENABLED || writer) return;
  // Dynamic import keeps the writer module out of the load graph
  // when the feature is disabled.
  const mod = await import("./writer");
  writer = new mod.DevLogWriter({ fullPayloads: DEV_LOG_FULL_PAYLOADS });
  await writer.init();
  console.log(`[dev-log] writing to ${writer.currentFilePath}`);
}

/** Fire-and-forget. Returns the new entry's logId, or "" when disabled.
 *  Pass `presetLogId` when the caller already reserved an ID. */
export function emitDevLog(input: DevLogEntryInput, presetLogId?: string): string {
  if (!writer) return "";
  return writer.enqueue(input, presetLogId);
}

export async function shutdownDevLog(): Promise<void> {
  if (!writer) return;
  await writer.shutdown();
  writer = null;
}

export function devLogFilePath(): string {
  return writer?.currentFilePath ?? "";
}
