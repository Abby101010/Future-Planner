/* ──────────────────────────────────────────────────────────
   NorthStar — Anthropic client factory

   Resolves the API key from user settings first, then .env
   as a fallback. Returns null if no key is configured so
   callers can surface a clear "set your key" error to the
   user instead of crashing.
   ────────────────────────────────────────────────────────── */

import Anthropic from "@anthropic-ai/sdk";

export function getClient(
  loadData: () => Record<string, unknown>,
): Anthropic | null {
  // Prefer the key the user saved in Settings/Onboarding over any env var.
  // This prevents a stale .env key from silently overriding the user's choice.
  let apiKey: string | undefined;
  const data = loadData();
  const user = data.user as Record<string, unknown> | undefined;
  const settings = user?.settings as Record<string, unknown> | undefined;
  apiKey = settings?.apiKey as string | undefined;

  if (apiKey) {
    console.log(
      "[ai-handler] API key from user settings:",
      `${apiKey.substring(0, 10)}...`,
    );
  } else {
    apiKey = process.env.ANTHROPIC_API_KEY || undefined;
    if (apiKey) {
      console.log("[ai-handler] API key from env variable");
    }
  }

  if (!apiKey) {
    console.log("[ai-handler] No API key found");
    return null;
  }
  return new Anthropic({ apiKey });
}
