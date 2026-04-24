/* ──────────────────────────────────────────────────────────
   Starward server — Anthropic client factory

   Reads the API key EXCLUSIVELY from the ANTHROPIC_API_KEY
   environment variable. There is no per-user settings fallback —
   the cloud backend is the single authority for which key is used.
   ────────────────────────────────────────────────────────── */

import Anthropic from "@anthropic-ai/sdk";

export function getClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[ai] ANTHROPIC_API_KEY is not set on the server");
    return null;
  }
  return new Anthropic({ apiKey });
}
