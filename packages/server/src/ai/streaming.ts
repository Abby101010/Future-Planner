/* NorthStar server — AI streaming wrapper
 *
 * Phase 4b: single chokepoint that converts Anthropic `messages.create`
 * into `messages.stream` and forwards token deltas to the user's
 * WebSocket connections while still returning a parsed, structured
 * result to the caller.
 *
 * Individual handlers stay tiny: they describe the request and the
 * parser, this wrapper owns all of the emit/try/finally bookkeeping.
 */

import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import {
  emitAiStreamStart,
  emitAiTokenDelta,
  emitAiStreamEnd,
} from "../ws";
import { getCurrentUserId } from "../middleware/requestContext";

/** Params accepted by `client.messages.stream(...)`. We re-use the
 *  non-streaming type intentionally — the SDK's `.stream()` method
 *  takes the same shape (minus `stream: true`) and returns a
 *  `MessageStream` object that emits events. */
type StreamableParams = Anthropic.MessageCreateParamsNonStreaming;

export interface RunStreamingHandlerArgs<T> {
  /** High-level kind of stream — e.g. "dailyTasks". Used as the
   *  `kind` on `ai:stream-start` and for logs. */
  handlerKind: string;
  /** The Anthropic SDK client to use. Passed in by the handler so
   *  streaming.ts has no opinion on how the client is constructed. */
  client: Anthropic;
  /** Whether to forward `text` event deltas to the client. Defaults
   *  to true. Set to false for tool-use / JSON-mode handlers where
   *  the text event is not meaningful. */
  forwardTextDeltas?: boolean;
  /** Builds the Anthropic request params. Called once per invocation. */
  createRequest: () => StreamableParams;
  /** Handler-specific parser. Receives the concatenated final text
   *  and the final Message object; returns the handler's structured
   *  result. */
  parseResult: (finalText: string, finalMessage: Anthropic.Message) => T;
}

/**
 * Run an Anthropic call as a stream, forwarding token deltas to the
 * current user's WS connections, and return the handler's parsed
 * result once the stream completes.
 *
 * Invariants:
 *  - `ai:stream-start` fires exactly once, before the SDK call.
 *  - `ai:stream-end` fires exactly once, in a finally block, even on
 *    error. On error, `finishReason` is `"error"` and the original
 *    error is re-thrown.
 *  - The return value is identical to what the old
 *    `messages.create`-based handler produced — streaming is a pure
 *    side channel for the WS transport.
 */
export async function runStreamingHandler<T>(
  args: RunStreamingHandlerArgs<T>,
): Promise<T> {
  const {
    handlerKind,
    client,
    forwardTextDeltas = true,
    createRequest,
    parseResult,
  } = args;

  const streamId = randomUUID();
  const userId = getCurrentUserId();
  if (!userId) {
    // getCurrentUserId already throws when outside a request, but
    // guard anyway so the error is attributable to this wrapper.
    throw new Error(
      `[ai:${handlerKind}] runStreamingHandler called without an active user context`,
    );
  }

  emitAiStreamStart(userId, { streamId, kind: handlerKind });

  let finishReason: string = "end";
  try {
    const params = createRequest();
    const stream = client.messages.stream(params);

    if (forwardTextDeltas) {
      stream.on("text", (delta: string) => {
        if (!delta) return;
        try {
          emitAiTokenDelta(userId, { streamId, delta });
        } catch (err) {
          // Never let a broadcast failure poison the actual AI call.
          console.warn(
            `[ai:${handlerKind}] emitAiTokenDelta failed (non-fatal):`,
            err,
          );
        }
      });
    }

    const finalMessage = await stream.finalMessage();
    const finalText = await stream.finalText();

    finishReason = finalMessage.stop_reason ?? "end";
    return parseResult(finalText, finalMessage);
  } catch (err) {
    finishReason = "error";
    throw err;
  } finally {
    try {
      emitAiStreamEnd(userId, { streamId, finishReason });
    } catch (err) {
      console.warn(
        `[ai:${handlerKind}] emitAiStreamEnd failed (non-fatal):`,
        err,
      );
    }
  }
}
