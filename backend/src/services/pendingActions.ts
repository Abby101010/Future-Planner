/* Starward server — Pending-actions intake from chat
 *
 * The chat handlers (`/ai/home-chat/stream`, `/ai/chat/stream`,
 * `/ai/goal-plan-chat/stream`) call this to route AI-proposed intents
 * into the `pending_actions` table instead of returning them in the
 * SSE done payload for the FE to auto-dispatch.
 *
 * Default behavior is cards-required: every intent the AI emits goes
 * through this gate. Emergency opt-out is `STARWARD_CHAT_AUTO_DISPATCH=1`
 * — when set, the chat handler skips this service and returns intents
 * inline (the legacy behavior). The opt-out exists for rollback during
 * incident response, not as a normal operating mode.
 *
 * For each pending action created, a `proactive` nudge is also written
 * with a human-readable body so v0.1.32 users see the AI's proposal in
 * the existing NotifStack even before the next FE release renders
 * proper Accept/Reject cards.
 */

import { randomUUID } from "node:crypto";
import * as repos from "../repositories";

/** Env-var read at module load. Set STARWARD_CHAT_AUTO_DISPATCH=1 to
 *  bypass cards and return intents inline (emergency rollback). Anything
 *  else → cards required. */
export function isAutoDispatchEnabled(): boolean {
  const flag = (process.env.STARWARD_CHAT_AUTO_DISPATCH ?? "").toLowerCase();
  return flag === "1" || flag === "true";
}

/** Loose intent shape — every chat handler emits its own variant. We
 *  read kind + a payload-like sub-object and let the dispatcher resolve
 *  the rest at accept-time. */
interface RawIntent {
  kind?: string;
  type?: string; // some handlers use `type` instead of `kind`
  action?: string;
  [key: string]: unknown;
}

/** Best-effort human-readable summary so the user (and the AI's next
 *  turn) can see what was proposed without parsing JSON. Per-kind
 *  formatting where it adds clarity; falls back to a generic shape. */
function summarize(intent: RawIntent): string {
  const kind = (intent.kind ?? intent.type ?? "action") as string;
  const action = intent.action as string | undefined;
  switch (kind) {
    case "manage-task": {
      const a = action ?? "modify";
      const taskId = intent.taskId as string | undefined;
      const targetDate = intent.rescheduleDate as string | undefined;
      if (a === "complete") return `Mark task ${taskId ?? ""} as completed`;
      if (a === "skip") return `Skip task ${taskId ?? ""}`;
      if (a === "delete") return `Delete task ${taskId ?? ""}`;
      if (a === "reschedule" && targetDate)
        return `Reschedule task ${taskId ?? ""} to ${targetDate}`;
      return `${a} task ${taskId ?? ""}`;
    }
    case "manage-reminder": {
      const a = action ?? "modify";
      const term = (intent.term as string | undefined) ?? "";
      return `${a} reminder${term ? `: "${term}"` : ""}`;
    }
    case "goal":
    case "create-goal":
    case "pending-goal": {
      // The home-chat handler emits `{kind:"goal", entity:{title,...}}`;
      // earlier shapes used `{kind:"create-goal", title:...}`. Read the
      // title from either layout so the proactive nudge body and any
      // FE card surface a sensible label.
      const entity = intent.entity as { title?: string } | undefined;
      const title = entity?.title ?? (intent.title as string | undefined) ?? "(unnamed)";
      return `Create goal: "${title}"`;
    }
    case "research":
      return `Research topic: "${(intent.topic as string | undefined) ?? ""}"`;
    default:
      return `${kind}${action ? `:${action}` : ""}`;
  }
}

export interface IntakeResult {
  proposedCount: number;
  pendingActionIds: string[];
}

/**
 * Convert an array of AI-emitted intents into pending_actions rows
 * plus matching proactive nudges. Returns the IDs created so the
 * caller (chat handler) can include them in the SSE done payload as
 * `pendingActionIds: string[]` — the FE can use them to render cards
 * on next refetch.
 *
 * Caller is responsible for SKIPPING this entirely when
 * `isAutoDispatchEnabled()` returns true. This service does the
 * intake unconditionally — the env-var check lives at the call site
 * to keep the SSE done payload shape decision in one place.
 */
export async function intakeIntentsAsPendingActions(
  intents: unknown[] | null | undefined,
  sessionId?: string | null,
): Promise<IntakeResult> {
  const result: IntakeResult = { proposedCount: 0, pendingActionIds: [] };
  if (!intents || !Array.isArray(intents) || intents.length === 0) return result;

  for (const raw of intents) {
    if (!raw || typeof raw !== "object") continue;
    const intent = raw as RawIntent;
    const kind = (intent.kind ?? intent.type) as string | undefined;
    if (!kind) continue;

    const id = `pa-${randomUUID()}`;
    const summary = summarize(intent);

    try {
      await repos.pendingActions.insert({
        id,
        intentKind: kind,
        intentPayload: intent as Record<string, unknown>,
        proposedSummary: summary,
        sessionId: sessionId ?? null,
      });
      result.pendingActionIds.push(id);
      result.proposedCount++;

      // Soft transparency for FE versions that don't yet render cards.
      // The proactive nudge body describes the proposal; the user can
      // see what the AI wanted to do without opening dev tools.
      try {
        await repos.nudges.insert({
          id: `pending-action:${id}`,
          kind: "proactive",
          title: "AI proposal",
          body: `${summary}. Confirm via the chat panel or the Tasks page.`,
          priority: 60,
          context: `pending-action:${id}`,
          extra: { pendingActionId: id, intentKind: kind },
        });
      } catch (err) {
        console.warn("[pending-actions] proactive nudge insert failed:", err);
      }
    } catch (err) {
      console.warn("[pending-actions] insert failed for kind", kind, err);
    }
  }
  return result;
}
