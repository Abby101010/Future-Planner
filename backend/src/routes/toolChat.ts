/* NorthStar server — Tool-use pilot route (Phase 5, additive)
 *
 * POST /ai-tools/chat
 *   body: { message: string, context?: "planning" | "daily" | "general" }
 *
 * Opt-in endpoint that drives the Anthropic tool_use loop with the
 * read-only tools registered in src/tools/definitions.ts. Shipped
 * alongside existing /ai/chat routes — nothing in routes/ai.ts is
 * modified. Clients adopt by calling this URL; all existing flows keep
 * using their current endpoints.
 */

import { Router } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import { getClient } from "../ai/client";
import { loadMemory, buildMemoryContext } from "../memory";
import { getModelForTier } from "@northstar/core";
import { runToolLoop } from "../tools";

export const toolChatRouter = Router();

const TOOL_CHAT_SYSTEM = `You are NorthStar's tool-using assistant.

You have read-only tools for the user's goals, tasks, and personalization
memory. Use them proactively:
- If the user asks anything about *their* situation ("what's on my plate",
  "my goals", "do I have time for X"), call the relevant tool before
  answering.
- Prefer get_today_overview for day-level questions. Prefer
  get_upcoming_tasks with a date range for multi-day planning. Prefer
  get_user_goals for strategic questions. Prefer get_memory_facts when
  personalising tone/intensity.
- Chain tools when one isn't enough. Cap yourself at ~3 tool calls per
  reply; don't over-fetch.
- If a tool returns {"error": ...}, mention the degradation briefly and
  answer with what you have.
- After fetching, respond in plain conversational prose. Be concise and
  specific; cite concrete titles/dates from tool results rather than
  vague summaries.

You do NOT have write tools. If the user asks you to change something
(create a task, mark complete, edit a goal), explain which UI surface
does that — do not pretend you performed the action.`;

toolChatRouter.post(
  "/chat",
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) {
      res.status(400).json({ error: "message is required" });
      return;
    }
    const contextType = (["planning", "daily", "general"] as const).includes(
      body.context as "planning" | "daily" | "general",
    )
      ? (body.context as "planning" | "daily" | "general")
      : "general";

    const client = getClient();
    if (!client) {
      res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
      return;
    }

    const memory = await loadMemory(req.userId);
    const memoryContext = await buildMemoryContext(memory, contextType);
    const systemWithMemory = memoryContext
      ? `${TOOL_CHAT_SYSTEM}\n\n${memoryContext}`
      : TOOL_CHAT_SYSTEM;

    const result = await runToolLoop({
      client,
      userId: req.userId,
      model: getModelForTier("medium"),
      system: systemWithMemory,
      userMessage: message,
    });

    res.json({
      reply: result.finalText,
      iterations: result.iterations,
      stopReason: result.stopReason,
      toolCalls: result.toolCalls.map((c) => ({
        name: c.name,
        ms: c.ms,
      })),
    });
  }),
);
