/* NorthStar server — commands route
 *
 * POST /commands/:kind — single entry point for every mutation in the
 * system. `kind` in the URL is the raw slug without the `command:`
 * prefix, i.e. POST /commands/toggle-task → command:toggle-task.
 *
 * Each case in the big switch delegates to a per-command handler
 * defined right below that reads args out of req.body, calls the
 * matching repository mutation, and returns an arbitrary payload that
 * we then wrap in the standardized envelope. After a successful
 * mutation we also emit `view:invalidate` over WS so connected clients
 * know to refetch the affected views.
 *
 * AI-backed commands (chat streams, plan regeneration, reallocation)
 * invoke the existing ai/router handleAIRequest — we do not
 * reimplement any AI plumbing here; we just translate command args to
 * the payload shape the handler expects.
 *
 * Failed commands do NOT emit view:invalidate — a client that sees an
 * error shouldn't then refetch the view and think nothing changed.
 */

import { Router } from "express";
import { envelope, envelopeError } from "@northstar/core";
import type { CommandKind, QueryKind } from "@northstar/core";
import * as repos from "../repositories";
import { getPool } from "../db/pool";
import { getCurrentUserId } from "../middleware/requestContext";
import { emitViewInvalidate } from "../ws/events";
import { commandToInvalidations } from "../views/_invalidation";
import { handleAIRequest, type RequestType } from "../ai/router";
import { loadMemory, buildMemoryContext } from "../memory";
import { extractReplyFromText } from "@northstar/core/handlers";
import { applyPlanPatch } from "@northstar/core";
import type { TimeBlock, UserProfile, UserSettings } from "@northstar/core";

const commandsRouter = Router();

// ── Small helpers ────────────────────────────────────────────

function invalidate(kind: CommandKind, extraViews: QueryKind[] = []): void {
  const userId = getCurrentUserId();
  const base = commandToInvalidations[kind] ?? [];
  const merged = Array.from(new Set<QueryKind>([...base, ...extraViews]));
  emitViewInvalidate(userId, { viewKinds: merged });
}

async function runAI(
  type: RequestType,
  payload: Record<string, unknown>,
  contextType: "planning" | "daily" | "recovery" | "general" = "general",
): Promise<unknown> {
  const userId = getCurrentUserId();
  const memory = await loadMemory(userId);
  const memoryContext = buildMemoryContext(memory, contextType);
  return handleAIRequest(type, payload, memoryContext);
}

// ── Per-command handlers ─────────────────────────────────────

async function cmdCreateGoal(body: Record<string, unknown>): Promise<unknown> {
  const goal = body.goal as Parameters<typeof repos.goals.upsert>[0];
  if (!goal || typeof goal !== "object" || !(goal as { id?: string }).id) {
    throw new Error("command:create-goal requires args.goal with an id");
  }
  await repos.goals.upsert(goal);
  return { ok: true, goalId: goal.id };
}

async function cmdUpdateGoal(body: Record<string, unknown>): Promise<unknown> {
  const goal = body.goal as Parameters<typeof repos.goals.upsert>[0];
  if (!goal || typeof goal !== "object" || !(goal as { id?: string }).id) {
    throw new Error("command:update-goal requires args.goal with an id");
  }
  await repos.goals.upsert(goal);
  return { ok: true, goalId: goal.id };
}

async function cmdDeleteGoal(body: Record<string, unknown>): Promise<unknown> {
  const goalId = body.goalId as string | undefined;
  if (!goalId) throw new Error("command:delete-goal requires args.goalId");
  await repos.goalPlan.deleteForGoal(goalId);
  await repos.goals.remove(goalId);
  return { ok: true, goalId };
}

async function cmdSkipTask(body: Record<string, unknown>): Promise<unknown> {
  const taskId = body.taskId as string | undefined;
  if (!taskId) throw new Error("command:skip-task requires args.taskId");

  const task = await repos.dailyTasks.get(taskId);
  if (!task) return { ok: true, taskId, skipped: null };

  const isSkipped = !(task.payload as Record<string, unknown>)?.skipped;
  await repos.dailyTasks.update(taskId, {
    payload: { skipped: isSkipped },
  });
  return { ok: true, taskId, skipped: isSkipped };
}

async function cmdToggleTask(body: Record<string, unknown>): Promise<unknown> {
  const taskId = body.taskId as string | undefined;
  if (!taskId) throw new Error("command:toggle-task requires args.taskId");

  // Try toggling as a daily task first.
  const next = await repos.dailyTasks.toggleCompleted(taskId);

  if (next !== null) {
    // Successfully toggled a daily task — sync state to the linked
    // goal plan node so the goal-plan page reflects it.
    const task = await repos.dailyTasks.get(taskId);
    if (task?.planNodeId) {
      try {
        await repos.goalPlan.patchNodePayload(task.planNodeId, {
          completed: next,
          completedAt: next ? new Date().toISOString() : null,
        });
      } catch (err) {
        console.warn("[toggle-task] failed to sync plan node:", err);
      }
    }
    return { ok: true, taskId, completed: next };
  }

  // Not found in daily_tasks — the id might be a goal_plan_node id
  // (user toggled directly on the goal plan page).
  const planNode = await repos.goalPlan.getNode(taskId);
  if (planNode && planNode.nodeType === "task") {
    const wasCompleted = Boolean(planNode.payload.completed);
    const nowCompleted = !wasCompleted;
    await repos.goalPlan.patchNodePayload(taskId, {
      completed: nowCompleted,
      completedAt: nowCompleted ? new Date().toISOString() : null,
    });
    return { ok: true, taskId, completed: nowCompleted };
  }

  return { ok: true, taskId, completed: null };
}

async function cmdConfirmPendingTask(
  body: Record<string, unknown>,
): Promise<unknown> {
  const pendingId = body.pendingId as string | undefined;
  if (!pendingId) {
    throw new Error("command:confirm-pending-task requires args.pendingId");
  }

  // Mark the pending task as confirmed.
  await repos.pendingTasks.updateStatus(pendingId, "confirmed");

  // Read the pending task to extract its analysis, then insert a real
  // daily task so it shows up in the Tasks page.
  const pending = await repos.pendingTasks.get(pendingId);
  if (pending) {
    const pl = pending.payload;
    const analysis = (pl.analysis ?? null) as {
      title?: string;
      description?: string;
      suggestedDate?: string;
      durationMinutes?: number;
      cognitiveWeight?: number;
      priority?: string;
      category?: string;
      reasoning?: string;
    } | null;

    const today = new Date().toISOString().split("T")[0];
    const date = analysis?.suggestedDate || today;

    // Determine orderIndex: append after existing tasks for that date.
    const existing = await repos.dailyTasks.listForDate(date);
    const orderIndex = existing.length;

    await repos.dailyTasks.insert({
      id: crypto.randomUUID(),
      date,
      title: analysis?.title || (pl.userInput as string) || pending.title || "Untitled task",
      completed: false,
      orderIndex,
      payload: {
        description: analysis?.description || "",
        durationMinutes: analysis?.durationMinutes ?? 30,
        cognitiveWeight: analysis?.cognitiveWeight ?? 3,
        priority: analysis?.priority || "should-do",
        category: analysis?.category || "planning",
        whyToday: analysis?.reasoning || "",
        source: "pending-task",
        pendingTaskId: pendingId,
      },
    });
  }

  return { ok: true, pendingId };
}

async function cmdRejectPendingTask(
  body: Record<string, unknown>,
): Promise<unknown> {
  const pendingId = body.pendingId as string | undefined;
  if (!pendingId) {
    throw new Error("command:reject-pending-task requires args.pendingId");
  }
  await repos.pendingTasks.updateStatus(pendingId, "rejected");
  return { ok: true, pendingId };
}

async function cmdCreatePendingTask(
  body: Record<string, unknown>,
): Promise<unknown> {
  const id = body.id as string | undefined;
  const userInput = body.userInput as string | undefined;
  const analysis = body.analysis as Record<string, unknown> | undefined;
  const status = (body.status as string) ?? "ready";
  if (!id || !userInput) {
    throw new Error(
      "command:create-pending-task requires args.id and args.userInput",
    );
  }
  await repos.pendingTasks.insert({
    id,
    source: "home-chat",
    title: (analysis?.title as string) ?? userInput,
    status: status as "ready" | "pending" | "analyzing",
    payload: { userInput, analysis: analysis ?? null },
  });
  return { ok: true, id };
}

async function cmdUpsertCalendarEvent(
  body: Record<string, unknown>,
): Promise<unknown> {
  const event = body.event as Parameters<typeof repos.calendar.upsert>[0];
  if (!event || typeof event !== "object" || !(event as { id?: string }).id) {
    throw new Error(
      "command:upsert-calendar-event requires args.event with an id",
    );
  }
  await repos.calendar.upsert(event);
  return { ok: true, eventId: event.id };
}

async function cmdDeleteCalendarEvent(
  body: Record<string, unknown>,
): Promise<unknown> {
  const eventId = body.eventId as string | undefined;
  if (!eventId) {
    throw new Error("command:delete-calendar-event requires args.eventId");
  }
  await repos.calendar.remove(eventId);
  return { ok: true, eventId };
}

async function cmdUpsertReminder(
  body: Record<string, unknown>,
): Promise<unknown> {
  const reminder = body.reminder as Parameters<
    typeof repos.reminders.upsert
  >[0];
  if (
    !reminder ||
    typeof reminder !== "object" ||
    !(reminder as { id?: string }).id
  ) {
    throw new Error("command:upsert-reminder requires args.reminder with an id");
  }
  await repos.reminders.upsert(reminder);
  return { ok: true, reminderId: reminder.id };
}

async function cmdAcknowledgeReminder(
  body: Record<string, unknown>,
): Promise<unknown> {
  const reminderId = body.reminderId as string | undefined;
  if (!reminderId) {
    throw new Error("command:acknowledge-reminder requires args.reminderId");
  }
  await repos.reminders.acknowledge(reminderId);
  return { ok: true, reminderId };
}

async function cmdDeleteReminder(
  body: Record<string, unknown>,
): Promise<unknown> {
  const reminderId = body.reminderId as string | undefined;
  if (!reminderId) {
    throw new Error("command:delete-reminder requires args.reminderId");
  }
  await repos.reminders.remove(reminderId);
  return { ok: true, reminderId };
}

async function cmdSaveMonthlyContext(
  body: Record<string, unknown>,
): Promise<unknown> {
  const context = body.context as Parameters<
    typeof repos.monthlyContext.upsert
  >[0];
  if (!context || typeof context !== "object") {
    throw new Error("command:save-monthly-context requires args.context");
  }
  await repos.monthlyContext.upsert(context);
  return { ok: true, month: (context as { month: string }).month };
}

async function cmdDeleteMonthlyContext(
  body: Record<string, unknown>,
): Promise<unknown> {
  const month = body.month as string | undefined;
  if (!month) {
    throw new Error("command:delete-monthly-context requires args.month");
  }
  await repos.monthlyContext.remove(month);
  return { ok: true, month };
}

async function cmdUpdateSettings(
  body: Record<string, unknown>,
): Promise<unknown> {
  const patch = (body.settings as Partial<UserSettings>) ?? {};
  await repos.users.updateSettings(patch);
  return { ok: true };
}

async function cmdCompleteOnboarding(
  body: Record<string, unknown>,
): Promise<unknown> {
  // Accepts either a full UserProfile in `body.user` (onboarding finalize)
  // or a partial patch. Full profile → upsert; partial → fall back to
  // completeOnboarding helper with defaults pulled from the current row.
  const patch = (body.user as Partial<UserProfile> | undefined) ?? {};
  const current = await repos.users.get();
  const name = patch.name ?? current?.name ?? "";
  const goalRaw = patch.goalRaw ?? current?.goalRaw ?? "";
  const weeklyAvailability: TimeBlock[] =
    patch.weeklyAvailability ?? current?.weeklyAvailability ?? [];

  // If the caller passed a full profile shape, upsert it whole; otherwise
  // use the narrow completeOnboarding helper.
  if (patch.settings || patch.createdAt) {
    const next: UserProfile = {
      id: current?.id ?? "",
      createdAt: current?.createdAt ?? new Date().toISOString(),
      settings: patch.settings ?? current?.settings ?? ({} as UserSettings),
      ...current,
      ...patch,
      name,
      goalRaw,
      weeklyAvailability,
      onboardingComplete: true,
    };
    await repos.users.upsert(next);
  } else {
    await repos.users.completeOnboarding(name, goalRaw, weeklyAvailability);
  }
  return { ok: true };
}

async function cmdResetData(): Promise<unknown> {
  const userId = getCurrentUserId();
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("begin");
    // Per-entity tables first so FKs (if any) clear cleanly.
    const tables = [
      "goal_plan_nodes",
      "daily_tasks",
      "daily_logs",
      "pending_tasks",
      "heatmap_entries",
      "home_chat_messages",
      "conversations",
      "nudges",
      "behavior_profile_entries",
      "vacation_mode",
      "goals",
      "roadmap",
      "users",
      "app_store",
    ];
    for (const t of tables) {
      await client.query(`delete from ${t} where user_id = $1`, [userId]);
    }
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
  return { ok: true };
}

// ── Chat / AI-backed commands ────────────────────────────────

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

async function cmdStartChatStream(
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

async function cmdSendChatMessage(
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
          await repos.goalPlan.replacePlan(goalId, planObj);
          const existing = await repos.goals.get(goalId);
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
            await repos.goalPlan.replacePlan(goalId, patched);
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

async function cmdClearHomeChat(): Promise<unknown> {
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

async function cmdRegenerateGoalPlan(
  body: Record<string, unknown>,
): Promise<unknown> {
  const payload =
    (body.payload as Record<string, unknown> | undefined) ?? body ?? {};
  const goalId = payload.goalId as string | undefined;
  if (!goalId) {
    throw new Error(
      "command:regenerate-goal-plan requires args.payload.goalId",
    );
  }
  const result = await runAI("generate-goal-plan", payload, "planning");
  // handleGenerateGoalPlan returns the raw parsed JSON. The prompt asks
  // for { reply, plan: {...} } but be tolerant of a bare plan.
  const resultObj = (result ?? {}) as Record<string, unknown>;
  const planCandidate =
    (resultObj.plan as Record<string, unknown> | undefined) ?? resultObj;
  if (
    !planCandidate ||
    typeof planCandidate !== "object" ||
    !Array.isArray((planCandidate as { years?: unknown }).years)
  ) {
    throw new Error("AI returned invalid plan shape");
  }
  const plan = planCandidate as unknown as import("@northstar/core").GoalPlan;
  await repos.goalPlan.replacePlan(goalId, plan);
  // Flip planConfirmed on the goal so dashboards/goal-plan view stop
  // showing the "not planned" state.
  const existing = await repos.goals.get(goalId);
  if (existing) {
    await repos.goals.upsert({
      ...existing,
      plan,
      planConfirmed: true,
      status: existing.status === "planning" ? "active" : existing.status,
    });
  }
  const reply = resultObj.reply as string | undefined;
  return { ok: true, goalId, reply };
}

async function cmdReallocateGoalPlan(
  body: Record<string, unknown>,
): Promise<unknown> {
  const payload =
    (body.payload as Record<string, unknown> | undefined) ?? body ?? {};
  const result = await runAI("reallocate", payload, "daily");
  return { ok: true, result };
}

async function cmdConfirmGoalPlan(
  body: Record<string, unknown>,
): Promise<unknown> {
  const goalId = body.goalId as string | undefined;
  if (!goalId) throw new Error("command:confirm-goal-plan requires args.goalId");
  const existing = await repos.goals.get(goalId);
  if (!existing) throw new Error(`goal ${goalId} not found`);
  await repos.goals.upsert({ ...existing, planConfirmed: true });
  return { ok: true, goalId };
}

// ── Dispatcher ───────────────────────────────────────────────

commandsRouter.post("/:kind", async (req, res) => {
  const slug = req.params.kind;
  const kind = `command:${slug}` as CommandKind;
  // Transport wraps command args in `{ v, kind, args: {...} }`. Unwrap so
  // individual cmd* handlers can read fields flat off `body`. Fall back to
  // the raw body for any caller that still posts args at the top level.
  const rawBody = (req.body ?? {}) as Record<string, unknown>;
  const body =
    (rawBody.args as Record<string, unknown> | undefined) ?? rawBody;
  try {
    let result: unknown;
    switch (kind) {
      case "command:create-goal":
        result = await cmdCreateGoal(body);
        break;
      case "command:update-goal":
        result = await cmdUpdateGoal(body);
        break;
      case "command:delete-goal":
        result = await cmdDeleteGoal(body);
        break;
      case "command:toggle-task":
        result = await cmdToggleTask(body);
        break;
      case "command:skip-task":
        result = await cmdSkipTask(body);
        break;
      case "command:confirm-pending-task":
        result = await cmdConfirmPendingTask(body);
        break;
      case "command:reject-pending-task":
        result = await cmdRejectPendingTask(body);
        break;
      case "command:create-pending-task":
        result = await cmdCreatePendingTask(body);
        break;
      case "command:upsert-calendar-event":
        result = await cmdUpsertCalendarEvent(body);
        break;
      case "command:delete-calendar-event":
        result = await cmdDeleteCalendarEvent(body);
        break;
      case "command:upsert-reminder":
        result = await cmdUpsertReminder(body);
        break;
      case "command:acknowledge-reminder":
        result = await cmdAcknowledgeReminder(body);
        break;
      case "command:delete-reminder":
        result = await cmdDeleteReminder(body);
        break;
      case "command:save-monthly-context":
        result = await cmdSaveMonthlyContext(body);
        break;
      case "command:delete-monthly-context":
        result = await cmdDeleteMonthlyContext(body);
        break;
      case "command:update-settings":
        result = await cmdUpdateSettings(body);
        break;
      case "command:complete-onboarding":
        result = await cmdCompleteOnboarding(body);
        break;
      case "command:reset-data":
        result = await cmdResetData();
        break;
      case "command:start-chat-stream":
        result = await cmdStartChatStream(body);
        break;
      case "command:send-chat-message":
        result = await cmdSendChatMessage(body);
        break;
      case "command:clear-home-chat":
        result = await cmdClearHomeChat();
        break;
      case "command:regenerate-goal-plan":
        result = await cmdRegenerateGoalPlan(body);
        break;
      case "command:reallocate-goal-plan":
        result = await cmdReallocateGoalPlan(body);
        break;
      case "command:confirm-goal-plan":
        result = await cmdConfirmGoalPlan(body);
        break;
      default: {
        // Unknown slug: the URL didn't match any known command. 404 with
        // a standardized error envelope so the client can distinguish
        // this from a runtime handler failure.
        res
          .status(404)
          .json(
            envelopeError(
              kind,
              "unknown_command",
              `Unknown command kind: ${kind}`,
            ),
          );
        return;
      }
    }
    // Success: fire the view invalidation WS event THEN respond.
    // If invalidation throws we still want the caller to see the write
    // succeeded, so we swallow the error (logging it) — losing an
    // invalidation is a soft failure.
    // Handlers may return `_invalidateExtra` to dynamically add views
    // that depend on runtime target (e.g. goal-plan vs. home chat).
    try {
      const extra =
        (result && typeof result === "object"
          ? ((result as { _invalidateExtra?: QueryKind[] })._invalidateExtra ??
            [])
          : []) as QueryKind[];
      invalidate(kind, extra);
    } catch (err) {
      console.warn("[commands] view invalidation failed:", err);
    }
    res.json(envelope(kind, result));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Intentionally do NOT fire view:invalidate on failure.
    res.status(500).json(envelopeError(kind, "command_failed", message));
  }
});

export default commandsRouter;
