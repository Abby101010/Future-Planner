/**
 * Chat command handlers (home chat + goal-plan chat).
 */

import { repos, runAI, extractReplyFromText, applyPlanPatch } from "./_helpers";

/** Append a message onto a goal's persistent planChat array and upsert
 *  the goal. Used by both start-chat-stream and send-chat-message on the
 *  goal-plan target so chat history actually survives a refetch. */
async function appendGoalPlanChatMessage(
  goalId: string,
  msg: import("@northstar/core").GoalPlanMessage,
): Promise<void> {
  const goal = await repos.goals.get(goalId);
  if (!goal) return;
  const nextChat = [...(goal.planChat ?? []), msg];
  await repos.goals.upsert({ ...goal, planChat: nextChat });
}

export async function cmdStartChatStream(
  body: Record<string, unknown>,
): Promise<unknown> {
  const target = body.target as string | undefined;
  const goalId = body.goalId as string | undefined;
  const message = body.message as Record<string, unknown> | undefined;
  const streamId = (body.streamId as string | undefined) ?? crypto.randomUUID();

  if (target === "goal-plan" && goalId && message && (message as { id?: string }).id) {
    // Goal-plan chat: persist the user message onto the goal, not the
    // home chat table. The SSE wiring proper lives on /ai/goal-plan-chat/stream;
    // this command just seeds the transcript so the view resolver sees
    // the message if the client falls back to non-streaming.
    try {
      await appendGoalPlanChatMessage(
        goalId,
        message as unknown as import("@northstar/core").GoalPlanMessage,
      );
    } catch (err) {
      console.warn("[cmd:start-chat-stream] failed to append goal chat:", err);
    }
    return { ok: true, streamId, _invalidateExtra: ["view:goal-plan"] };
  }

  // Home chat path (legacy / default).
  if (message && typeof message === "object" && (message as { id?: string }).id) {
    await repos.chat.insertHomeMessage(
      message as unknown as Parameters<typeof repos.chat.insertHomeMessage>[0],
    );
  }
  return { ok: true, streamId };
}

export async function cmdSendChatMessage(
  body: Record<string, unknown>,
): Promise<unknown> {
  const target = body.target as string | undefined;
  const goalId = body.goalId as string | undefined;
  const payload = (body.payload as Record<string, unknown> | undefined) ?? {};
  const message = body.message as Record<string, unknown> | undefined;

  // Goal-plan chat: invoke the goal-plan-chat handler, persist the
  // user + assistant messages onto goal.planChat, and merge any plan
  // update the AI returned. Never touches home_chat_messages.
  if (target === "goal-plan" && goalId) {
    const result = (await runAI(
      "goal-plan-chat",
      payload,
      "planning",
    )) as {
      reply?: string;
      planReady?: boolean;
      plan?: Record<string, unknown> | null;
      planPatch?: Record<string, unknown> | null;
    };

    // Persist user message.
    if (message && typeof message === "object" && (message as { id?: string }).id) {
      try {
        await appendGoalPlanChatMessage(
          goalId,
          message as unknown as import("@northstar/core").GoalPlanMessage,
        );
      } catch (err) {
        console.warn("[cmd:send-chat-message] append user msg failed:", err);
      }
    }

    // Persist assistant reply.
    const replyText = typeof result?.reply === "string"
      ? extractReplyFromText(result.reply)
      : "";
    if (replyText) {
      try {
        await appendGoalPlanChatMessage(goalId, {
          id: crypto.randomUUID(),
          role: "assistant",
          content: replyText,
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        console.warn("[cmd:send-chat-message] append assistant msg failed:", err);
      }
    }

    // If the handler returned a full plan or a patch, apply it.
    let planReplaced = false;
    if (result?.planReady && result.plan && typeof result.plan === "object") {
      try {
        const planObj = result.plan as unknown as import("@northstar/core").GoalPlan;
        if (Array.isArray(planObj.years)) {
          const existing = await repos.goals.get(goalId);
          const gStartDate = existing?.createdAt?.split("T")[0];
          const gEndDate = existing?.targetDate;
          await repos.goalPlan.replacePlan(goalId, planObj, gStartDate, gEndDate);
          if (existing) {
            await repos.goals.upsert({ ...existing, plan: planObj });
          }
          planReplaced = true;
        }
      } catch (err) {
        console.warn("[cmd:send-chat-message] replacePlan failed:", err);
      }
    } else if (result?.planPatch && typeof result.planPatch === "object") {
      // Sparse patch — merge into existing plan.
      try {
        const existing = await repos.goals.get(goalId);
        if (existing) {
          // Reconstruct plan from flat nodes (canonical) or inline.
          let currentPlan: import("@northstar/core").GoalPlan | null = null;
          const planNodes = await repos.goalPlan.listForGoal(goalId);
          if (planNodes.length > 0) {
            const reconstructed = repos.goalPlan.reconstructPlan(planNodes);
            if (reconstructed.years.length > 0 || reconstructed.milestones.length > 0) {
              currentPlan = reconstructed;
            }
          }
          if (!currentPlan) currentPlan = existing.plan ?? null;

          if (currentPlan) {
            const patched = applyPlanPatch(currentPlan, result.planPatch);
            const gStartDate = existing.createdAt?.split("T")[0];
            const gEndDate = existing.targetDate;
            await repos.goalPlan.replacePlan(goalId, patched, gStartDate, gEndDate);
            await repos.goals.upsert({ ...existing, plan: patched });
            planReplaced = true;
          }
        }
      } catch (err) {
        console.warn("[cmd:send-chat-message] planPatch failed:", err);
      }
    }

    return {
      ok: true,
      reply: replyText,
      planReady: Boolean(result?.planReady),
      plan: result?.plan ?? null,
      planPatch: result?.planPatch ?? null,
      _invalidateExtra: planReplaced
        ? ["view:goal-plan", "view:tasks", "view:dashboard"]
        : ["view:goal-plan"],
    };
  }

  // Home chat path (legacy / default).
  const reply = await runAI("home-chat", payload, "general");
  if (message && typeof message === "object" && (message as { id?: string }).id) {
    await repos.chat.insertHomeMessage(
      message as unknown as Parameters<typeof repos.chat.insertHomeMessage>[0],
    );
  }
  return { ok: true, reply };
}

export async function cmdClearHomeChat(): Promise<unknown> {
  // Snapshot the current home_chat_messages into chat_sessions so the
  // sidebar shows previous chats instead of silently dropping them when
  // the user starts a new conversation. Empty transcripts are a no-op.
  const existing = await repos.chat.listHomeMessages(1000);
  let archivedSessionId: string | null = null;
  if (existing.length > 0) {
    const firstUserMsg = existing.find((m) => m.role === "user");
    const rawTitle = firstUserMsg?.content ?? "Home chat";
    const title =
      rawTitle.length > 60 ? `${rawTitle.slice(0, 57)}...` : rawTitle;
    archivedSessionId = crypto.randomUUID();
    const now = new Date().toISOString();
    await repos.chat.saveChatSession({
      id: archivedSessionId,
      title,
      messages: existing,
      createdAt: existing[0]?.timestamp || now,
      updatedAt: now,
    });
  }
  await repos.chat.clearHome();
  return { ok: true, archivedSessionId };
}
