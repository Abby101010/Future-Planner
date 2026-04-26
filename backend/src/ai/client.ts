/* ──────────────────────────────────────────────────────────
   Starward server — Anthropic client factory

   Reads the API key EXCLUSIVELY from the ANTHROPIC_API_KEY
   environment variable. There is no per-user settings fallback —
   the cloud backend is the single authority for which key is used.

   The returned client is wrapped by `wrapClientWithLogging` so every
   messages.create / messages.stream completion lands a row in the
   `llm_calls` table. The wrap is transparent to callers (shape-
   compatible Proxy) but lets `services/llmUsageLogger` capture
   tokens, model, cost, and any context set via withLlmCallContext.
   ────────────────────────────────────────────────────────── */

import Anthropic from "@anthropic-ai/sdk";
import { wrapClientWithLogging } from "../services/llmUsageLogger";

export function getClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[ai] ANTHROPIC_API_KEY is not set on the server");
    return null;
  }
  return wrapClientWithLogging(new Anthropic({ apiKey }));
}
