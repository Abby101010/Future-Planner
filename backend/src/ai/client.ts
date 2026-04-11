/* ──────────────────────────────────────────────────────────
   NorthStar server — Anthropic client factory

   Unlike the Electron version, this client reads the API key
   EXCLUSIVELY from the ANTHROPIC_API_KEY environment variable.
   There is no per-user settings fallback — the cloud backend
   is the single authority for which key is used.

   The `loadData` parameter is kept for API compatibility with
   the copied handlers (which take `loadData` in their signatures)
   but its value is ignored for key resolution.
   ────────────────────────────────────────────────────────── */

import Anthropic from "@anthropic-ai/sdk";

export function getClient(
  _loadData: () => Record<string, unknown>,
): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[ai] ANTHROPIC_API_KEY is not set on the server");
    return null;
  }
  return new Anthropic({ apiKey });
}
