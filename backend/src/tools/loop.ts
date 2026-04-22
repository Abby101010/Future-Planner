/* NorthStar server — Tool-use orchestration loop (Phase 5, additive)
 *
 * Drives a multi-turn conversation with Anthropic in which the model may
 * invoke one or more server-side tools before returning a final text
 * response. The tool definitions + impls come from ./definitions.ts.
 *
 * Loop:
 *   1. Send messages + tools to client.messages.create.
 *   2. If stop_reason === "tool_use": for every tool_use block, run the
 *      matching impl, and append a `user` turn with tool_result blocks.
 *   3. Re-call messages.create. Repeat until stop_reason === "end_turn"
 *      or the safety cap of MAX_ITERATIONS is reached.
 *
 * Bounded: at most MAX_ITERATIONS tool rounds per call. Each tool impl
 * is wrapped in safeError so a failing tool surfaces as a structured
 * `{error: ...}` result the model can recover from without aborting.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type {
  MessageParam,
  ContentBlockParam,
  ToolUseBlock,
  Tool,
} from "@anthropic-ai/sdk/resources/messages";
import { getToolDefinitions, getToolImpl } from "./definitions";

const MAX_ITERATIONS = 6;

export interface RunToolLoopInput {
  client: Anthropic;
  userId: string;
  model: string;
  system: string;
  userMessage: string;
  /** Override tools (default: all registered tools). */
  tools?: Tool[];
  /** Soft cap on output tokens per turn. */
  maxTokensPerTurn?: number;
}

export interface ToolCallTrace {
  name: string;
  input: Record<string, unknown>;
  output: unknown;
  ms: number;
}

export interface RunToolLoopResult {
  finalText: string;
  iterations: number;
  toolCalls: ToolCallTrace[];
  stopReason: string;
}

export async function runToolLoop(input: RunToolLoopInput): Promise<RunToolLoopResult> {
  const tools = input.tools ?? getToolDefinitions();
  const maxTokens = input.maxTokensPerTurn ?? 2048;
  const messages: MessageParam[] = [
    { role: "user", content: input.userMessage },
  ];
  const toolCalls: ToolCallTrace[] = [];
  let iterations = 0;
  let lastStopReason = "unknown";

  while (iterations < MAX_ITERATIONS) {
    iterations++;
    const response = await input.client.messages.create({
      model: input.model,
      max_tokens: maxTokens,
      system: input.system,
      tools,
      messages,
    });
    lastStopReason = response.stop_reason ?? "unknown";

    if (response.stop_reason !== "tool_use") {
      const text = response.content
        .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return {
        finalText: text,
        iterations,
        toolCalls,
        stopReason: lastStopReason,
      };
    }

    // Record the assistant turn so the next request has the full history.
    messages.push({ role: "assistant", content: response.content });

    // Run every tool_use block in sequence (order preserved).
    const toolUseBlocks = response.content.filter(
      (b): b is ToolUseBlock => b.type === "tool_use",
    );

    const toolResultBlocks: ContentBlockParam[] = [];
    for (const block of toolUseBlocks) {
      const impl = getToolImpl(block.name);
      const start = Date.now();
      let output: unknown;
      let isError = false;
      if (!impl) {
        output = { error: `unknown tool: ${block.name}` };
        isError = true;
      } else {
        try {
          output = await impl(
            (block.input as Record<string, unknown>) ?? {},
            input.userId,
          );
        } catch (err) {
          output = { error: err instanceof Error ? err.message : String(err) };
          isError = true;
        }
      }
      const ms = Date.now() - start;
      toolCalls.push({
        name: block.name,
        input: (block.input as Record<string, unknown>) ?? {},
        output,
        ms,
      });
      toolResultBlocks.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify(output).slice(0, 8000),
        is_error: isError,
      });
    }

    messages.push({ role: "user", content: toolResultBlocks });
  }

  // Hit iteration cap — return whatever we have.
  return {
    finalText: "[tool-loop] exceeded max iterations without final answer",
    iterations,
    toolCalls,
    stopReason: lastStopReason,
  };
}
