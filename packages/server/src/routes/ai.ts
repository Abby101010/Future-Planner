/* NorthStar server — AI routes
 *
 * HTTP mirror of the ai:* IPC channels. Each route forwards to handleAIRequest
 * with the corresponding RequestType. The loadData callback returns the user's
 * app_store snapshot so handlers that read user settings / goals / logs can
 * still access them.
 *
 * Scoping: every route closes over req.userId when building loadData so each
 * handler invocation sees that user's data and only that user's data.
 */

import { Router } from "express";
import { handleAIRequest, type RequestType } from "../ai/router";
import { query } from "../db/pool";
import { asyncHandler } from "../middleware/errorHandler";
import { loadMemory, buildMemoryContext } from "../memory";
import { getClient } from "../ai/client";
import {
  buildHomeChatRequest,
  parseHomeChatIntent,
} from "@northstar/core";
import type { AIPayloadMap } from "@northstar/core";

export const aiRouter = Router();

/**
 * Pick the buildMemoryContext "context type" for an AI channel. Mirrors
 * the choices made by the local Electron coordinator. Channels not in
 * this map get the "general" directive.
 */
const CONTEXT_TYPE_BY_CHANNEL: Record<
  string,
  "planning" | "daily" | "recovery" | "general"
> = {
  "daily-tasks": "daily",
  recovery: "recovery",
  reallocate: "daily",
  "pace-check": "daily",
  "goal-breakdown": "planning",
  "generate-goal-plan": "planning",
  "goal-plan-edit": "planning",
  "goal-plan-chat": "planning",
  "analyze-quick-task": "daily",
  "home-chat": "general",
  onboarding: "general",
  "classify-goal": "general",
  "analyze-monthly-context": "planning",
};

/**
 * Build a synchronous loadData() for a given user. The AI handlers were
 * written against an Electron context that returned the snapshot
 * synchronously from an in-memory JSON cache. We replicate that contract
 * by pre-loading the user's app_store rows before calling the handler,
 * then handing out a closure that returns the cached object.
 */
async function buildLoadData(
  userId: string,
): Promise<() => Record<string, unknown>> {
  const rows = await query<{ key: string; value: unknown }>(
    "select key, value from app_store where user_id = $1",
    [userId],
  );
  const snapshot: Record<string, unknown> = {};
  for (const row of rows) {
    snapshot[row.key] = row.value;
  }
  return () => snapshot;
}

function makeAIRoute(channel: string, type: RequestType) {
  aiRouter.post(
    `/${channel}`,
    asyncHandler(async (req, res) => {
      const loadData = await buildLoadData(req.userId);
      const payload = (req.body ?? {}) as Record<string, unknown>;
      // Slice 3a: load the user's memory store and build a personalization
      // block to inject into the AI prompt. This is the line that turns
      // captured signals into AI-visible context. Channels with no useful
      // memory mapping fall back to "general".
      const memory = await loadMemory(req.userId);
      const ctxType = CONTEXT_TYPE_BY_CHANNEL[channel] ?? "general";
      const memoryContext = buildMemoryContext(memory, ctxType);
      const result = await handleAIRequest(type, payload, loadData, memoryContext);
      res.json(result);
    }),
  );
}

// Register all 13 ai:* channels as POST /ai/<channel>
makeAIRoute("onboarding", "onboarding");
makeAIRoute("goal-breakdown", "goal-breakdown");
makeAIRoute("reallocate", "reallocate");
makeAIRoute("daily-tasks", "daily-tasks");
makeAIRoute("recovery", "recovery");
makeAIRoute("pace-check", "pace-check");
makeAIRoute("classify-goal", "classify-goal");
makeAIRoute("goal-plan-chat", "goal-plan-chat");
makeAIRoute("generate-goal-plan", "generate-goal-plan");
makeAIRoute("goal-plan-edit", "goal-plan-edit");
makeAIRoute("analyze-quick-task", "analyze-quick-task");
makeAIRoute("analyze-monthly-context", "analyze-monthly-context");
makeAIRoute("home-chat", "home-chat");

// news-briefing is deferred to phase 1b — it depends on the coordinator
// + research agent which we chose to skip for MVP. For now return a
// clear "not implemented" response rather than crashing.
aiRouter.post("/news-briefing", (_req, res) => {
  res.json({
    ok: false,
    error: "news-briefing is not available in the phase 1 cloud deployment",
  });
});

// ── SSE streaming: home-chat ─────────────────────────────
//
// Server-Sent Events endpoint that streams home-chat reply text as it
// arrives from Claude and then emits a single terminal event with the
// parsed intent. Wire format:
//
//   event: delta
//   data: {"text": "partial chunk"}
//
//   event: done
//   data: {"reply": "full text", "intent": {...}|null}
//
//   event: error
//   data: {"error": "..."}
//
// The blocking POST /ai/home-chat endpoint is preserved so clients can
// migrate at their own pace.
aiRouter.post(
  "/home-chat/stream",
  asyncHandler(async (req, res) => {
    const loadData = await buildLoadData(req.userId);
    const client = getClient(loadData);
    if (!client) {
      res.status(500).json({ ok: false, error: "AI client unavailable" });
      return;
    }

    const payload = (req.body ?? {}) as AIPayloadMap["home-chat"];
    const memory = await loadMemory(req.userId);
    const memoryContext = buildMemoryContext(memory, "general");
    const request = buildHomeChatRequest(payload, memoryContext);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const stream = client.messages.stream({
        model: request.model,
        max_tokens: request.maxTokens,
        system: request.system,
        messages: request.messages as Parameters<
          typeof client.messages.create
        >[0]["messages"],
      });

      let fullText = "";
      stream.on("text", (chunk: string) => {
        fullText += chunk;
        send("delta", { text: chunk });
      });

      await stream.finalMessage();
      const trimmed = fullText.trim();
      const intent = parseHomeChatIntent(trimmed, payload.userInput);
      send("done", { reply: trimmed, intent });
    } catch (err) {
      send("error", {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      res.end();
    }
  }),
);
