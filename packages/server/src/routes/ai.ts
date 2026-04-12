/* NorthStar server — AI routes
 *
 * HTTP mirror of the ai:* IPC channels. Each route forwards to handleAIRequest
 * with the corresponding RequestType. Scoping is per-request via req.userId
 * + AsyncLocalStorage so repositories read/write the right tenant.
 */

import { randomUUID } from "node:crypto";
import { Router } from "express";
import { handleAIRequest, type RequestType } from "../ai/router";
import { asyncHandler } from "../middleware/errorHandler";
import { loadMemory, buildMemoryContext } from "../memory";
import { enrichWithEnvironment, type ClientEnvironment } from "../environment";
import { getClient } from "../ai/client";
import {
  buildHomeChatRequest,
  parseHomeChatIntent,
  buildGoalPlanChatRequest,
  parseGoalPlanChatResult,
  extractReplyFromText,
} from "@northstar/core/handlers";
import type { AIPayloadMap, GoalPlan, GoalPlanMessage } from "@northstar/core";
import { applyPlanPatch } from "@northstar/core";
import * as chatRepo from "../repositories/chatRepo";
import * as repos from "../repositories";
import { emitViewInvalidate } from "../ws/events";
import { getEffectiveDate } from "../dateUtils";

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
  "news-briefing": "general",
  onboarding: "general",
  "classify-goal": "general",
  "analyze-monthly-context": "planning",
};

function makeAIRoute(channel: string, type: RequestType) {
  aiRouter.post(
    `/${channel}`,
    asyncHandler(async (req, res) => {
      const payload = (req.body ?? {}) as Record<string, unknown>;
      // Enrich payload with weather + formatted environment context
      const env = payload._environmentContext as ClientEnvironment | undefined;
      await enrichWithEnvironment(payload, env);
      // Load the user's memory store and build a personalization block to
      // inject into the AI prompt. Channels with no useful memory mapping
      // fall back to "general".
      const memory = await loadMemory(req.userId);
      const ctxType = CONTEXT_TYPE_BY_CHANNEL[channel] ?? "general";
      const memoryContext = buildMemoryContext(memory, ctxType);
      const result = await handleAIRequest(type, payload, memoryContext);
      res.json(result);
    }),
  );
}

// Register all 13 ai:* channels as POST /ai/<channel>
makeAIRoute("onboarding", "onboarding");
makeAIRoute("goal-breakdown", "goal-breakdown");
makeAIRoute("reallocate", "reallocate");
// daily-tasks is registered below with a custom handler that persists
// the generated DailyLog (tasks + heatmap + log row) so TasksPage and
// DashboardPage actually see the new data after a refetch. The pure
// handler in ai/handlers/dailyTasks.ts returns the shape but does not
// touch the database — same class of bug we already fixed for
// home-chat and regenerate-goal-plan.
makeAIRoute("recovery", "recovery");
makeAIRoute("pace-check", "pace-check");
makeAIRoute("classify-goal", "classify-goal");
makeAIRoute("goal-plan-chat", "goal-plan-chat");
makeAIRoute("generate-goal-plan", "generate-goal-plan");
makeAIRoute("goal-plan-edit", "goal-plan-edit");
makeAIRoute("analyze-quick-task", "analyze-quick-task");
makeAIRoute("analyze-monthly-context", "analyze-monthly-context");
makeAIRoute("news-briefing", "news-briefing");
// home-chat is registered below with a custom handler that also persists
// the user message + assistant reply into home_chat_messages so the
// dashboard view shows real history on refetch / restart. The client
// may pass `userMessageId` in the payload so optimistic UI state lines
// up with the persisted row.
aiRouter.post(
  "/home-chat",
  asyncHandler(async (req, res) => {
    const payload = (req.body ?? {}) as Record<string, unknown>;
    // Enrich with weather + environment context
    const env = payload._environmentContext as ClientEnvironment | undefined;
    await enrichWithEnvironment(payload, env);
    const memory = await loadMemory(req.userId);
    const memoryContext = buildMemoryContext(memory, "general");
    const result = (await handleAIRequest(
      "home-chat",
      payload,
      memoryContext,
    )) as { reply: string; intent: unknown };

    const nowIso = new Date().toISOString();
    // User message — reuse client-supplied id when present so the
    // dashboard's optimistic merge drops its in-flight copy on refetch.
    const userText =
      typeof payload.query === "string"
        ? payload.query
        : typeof payload.message === "string"
          ? (payload.message as string)
          : "";
    const userMessageId =
      typeof payload.userMessageId === "string"
        ? (payload.userMessageId as string)
        : randomUUID();
    if (userText) {
      try {
        await chatRepo.insertHomeMessage({
          id: userMessageId,
          role: "user",
          content: userText,
          timestamp: nowIso,
        });
      } catch (err) {
        console.warn("[ai/home-chat] failed to persist user message:", err);
      }
    }

    // Assistant reply — always a fresh id; return it so the client can
    // reconcile its optimistic placeholder against the canonical row.
    const assistantMessageId = randomUUID();
    if (result && typeof result.reply === "string" && result.reply) {
      try {
        await chatRepo.insertHomeMessage({
          id: assistantMessageId,
          role: "assistant",
          content: result.reply,
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        console.warn("[ai/home-chat] failed to persist assistant reply:", err);
      }
    }

    res.json({ ...result, userMessageId, assistantMessageId });
  }),
);

// daily-tasks — AI generates today's task list + heatmap entry + briefing.
// The handler returns a full DailyLog shape; we persist it here so the
// tasks view resolver can join daily_logs + daily_tasks + heatmap_entries
// and actually render something after the client refetches.
aiRouter.post(
  "/daily-tasks",
  asyncHandler(async (req, res) => {
    const payload = (req.body ?? {}) as Record<string, unknown>;
    // Enrich with weather + environment context
    const env = payload._environmentContext as ClientEnvironment | undefined;
    await enrichWithEnvironment(payload, env);
    const memory = await loadMemory(req.userId);
    const memoryContext = buildMemoryContext(memory, "daily");
    const result = (await handleAIRequest(
      "daily-tasks",
      payload,
      memoryContext,
    )) as {
      id?: string;
      date: string;
      tasks: Array<{
        id: string;
        title: string;
        description?: string;
        durationMinutes?: number;
        cognitiveWeight?: number;
        whyToday?: string;
        priority?: string;
        isMomentumTask?: boolean;
        progressContribution?: string;
        category?: string;
        completed?: boolean;
        goalId?: string | null;
        planNodeId?: string | null;
      }>;
      heatmapEntry?: {
        date: string;
        completionLevel: 0 | 1 | 2 | 3 | 4;
        currentStreak: number;
        totalActiveDays: number;
        longestStreak: number;
      };
      notificationBriefing?: string;
      adaptiveReasoning?: string;
      milestoneCelebration?: unknown;
      progress?: unknown;
      yesterdayRecap?: unknown;
      encouragement?: string;
    };

    const date = result.date;
    try {
      // Wipe any prior tasks for this date — regeneration replaces the list
      // rather than appending to it. Do this before insert so a partial
      // failure doesn't leave stale rows mixed with fresh ones.
      await repos.dailyTasks.removeForDate(date);

      for (let i = 0; i < result.tasks.length; i++) {
        const t = result.tasks[i];
        await repos.dailyTasks.insert({
          id: t.id,
          date,
          title: t.title,
          completed: t.completed ?? false,
          orderIndex: i,
          goalId: t.goalId ?? null,
          planNodeId: t.planNodeId ?? null,
          payload: {
            description: t.description,
            durationMinutes: t.durationMinutes,
            cognitiveWeight: t.cognitiveWeight,
            whyToday: t.whyToday,
            priority: t.priority,
            isMomentumTask: t.isMomentumTask,
            progressContribution: t.progressContribution,
            category: t.category,
          },
        });
      }

      await repos.dailyLogs.upsert({
        date,
        payload: {
          id: result.id ?? `log-${date}`,
          notificationBriefing: result.notificationBriefing ?? "",
          adaptiveReasoning: result.adaptiveReasoning ?? "",
          milestoneCelebration: result.milestoneCelebration ?? null,
          progress: result.progress ?? null,
          yesterdayRecap: result.yesterdayRecap ?? null,
          encouragement: result.encouragement ?? "",
          heatmapEntry: result.heatmapEntry ?? null,
        },
      });

      if (result.heatmapEntry) {
        await repos.heatmap.upsert(result.heatmapEntry);
      }

      // Tell every connected client for this user to refetch the tasks
      // and dashboard views so the new log shows up without a manual
      // reload. This mirrors what command handlers do via commandsRouter.
      emitViewInvalidate(req.userId, {
        viewKinds: ["view:tasks", "view:dashboard"],
      });
    } catch (err) {
      console.warn("[ai/daily-tasks] failed to persist daily log:", err);
    }

    res.json(result);
  }),
);

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
    const client = getClient();
    if (!client) {
      res.status(500).json({ ok: false, error: "AI client unavailable" });
      return;
    }

    const payload = (req.body ?? {}) as AIPayloadMap["home-chat"];
    // Stamp effective "today" so the intent parser lands on the same date
    // the TasksView filter uses (6 AM boundary + TZ). Without this, a
    // reminder created at 00:30 local gets stored for the wrong calendar
    // day and silently drops out of tasksView.todayReminders.
    payload.todayDate = getEffectiveDate();
    // Enrich with weather + environment context
    const envRaw = (payload as unknown as Record<string, unknown>)._environmentContext as ClientEnvironment | undefined;
    await enrichWithEnvironment(payload as unknown as Record<string, unknown>, envRaw);
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
      const intent = parseHomeChatIntent(trimmed, payload.userInput, payload.todayDate);
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

// ── SSE streaming: goal-plan-chat ────────────────────────
//
// Counterpart of /ai/home-chat/stream for the chat panel inside a
// GoalPlanPage. Streams the LLM reply token-by-token, then on finalization
// persists both user + assistant messages to goal.planChat and (if the
// handler returned a full plan) replaces goal.plan via the flat
// goal_plan_nodes table. Emits view:invalidate for view:goal-plan and
// — when the plan changed — view:tasks / view:dashboard.
aiRouter.post(
  "/goal-plan-chat/stream",
  asyncHandler(async (req, res) => {
    const client = getClient();
    if (!client) {
      res.status(500).json({ ok: false, error: "AI client unavailable" });
      return;
    }

    const payload = (req.body ?? {}) as AIPayloadMap["goal-plan-chat"] & {
      goalId?: string;
      userMessageId?: string;
    };
    const goalId = typeof payload.goalId === "string" ? payload.goalId : "";
    const memory = await loadMemory(req.userId);
    const memoryContext = buildMemoryContext(memory, "planning");
    const request = buildGoalPlanChatRequest(payload, memoryContext);

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
      const result = parseGoalPlanChatResult(fullText);

      console.log("[goal-plan-chat/stream] raw LLM output (first 500 chars):", fullText.slice(0, 500));
      console.log("[goal-plan-chat/stream] parsed result:", {
        replyLen: result.reply?.length ?? 0,
        planReady: result.planReady,
        hasPlan: !!result.plan,
        hasPlanPatch: !!result.planPatch,
        planPatchKeys: result.planPatch ? Object.keys(result.planPatch) : [],
      });

      // Persist user + assistant onto goal.planChat and (if plan is
      // ready) replace the plan tree. All best-effort: SSE delivery to
      // the client must not fail because of DB issues.
      let planReplaced = false;
      if (goalId) {
        try {
          const goal = await repos.goals.get(goalId);
          if (goal) {
            const nextChat: GoalPlanMessage[] = [...(goal.planChat ?? [])];
            if (
              payload.userMessageId &&
              typeof payload.userMessage === "string"
            ) {
              nextChat.push({
                id: payload.userMessageId,
                role: "user",
                content: payload.userMessage,
                timestamp: new Date().toISOString(),
              });
            }
            if (result.reply) {
              // Safety net: never persist raw JSON as a chat message.
              // extractReplyFromText strips JSON envelopes if the reply
              // somehow still contains one.
              nextChat.push({
                id: randomUUID(),
                role: "assistant",
                content: extractReplyFromText(result.reply),
                timestamp: new Date().toISOString(),
              });
            }

            // Build the plan to patch against. Prefer reconstructing
            // from flat goal_plan_nodes (the canonical source); fall
            // back to inline goal.plan for legacy/simple cases.
            let nextPlan: GoalPlan | null = null;
            const planNodes = await repos.goalPlan.listForGoal(goalId);
            console.log("[goal-plan-chat/stream] planNodes count:", planNodes.length);
            if (planNodes.length > 0) {
              const reconstructed = repos.goalPlan.reconstructPlan(planNodes);
              console.log("[goal-plan-chat/stream] reconstructed plan:", {
                yearsCount: reconstructed.years?.length ?? 0,
                milestonesCount: reconstructed.milestones?.length ?? 0,
              });
              if (reconstructed.years.length > 0 || reconstructed.milestones.length > 0) {
                nextPlan = reconstructed;
              }
            }
            if (!nextPlan) {
              nextPlan = goal.plan ?? null;
              console.log("[goal-plan-chat/stream] using inline goal.plan:", {
                hasPlan: !!nextPlan,
                yearsCount: nextPlan?.years?.length ?? 0,
              });
            }

            if (
              result.planReady &&
              result.plan &&
              Array.isArray((result.plan as { years?: unknown }).years)
            ) {
              // Full replacement — user asked to start over.
              console.log("[goal-plan-chat/stream] FULL PLAN REPLACEMENT");
              const planObj = result.plan as unknown as GoalPlan;
              await repos.goalPlan.replacePlan(goalId, planObj);
              nextPlan = planObj;
              planReplaced = true;
            } else if (result.planPatch && nextPlan) {
              // Sparse patch — merge by id into the existing plan tree.
              console.log("[goal-plan-chat/stream] APPLYING PLAN PATCH");
              console.log("[goal-plan-chat/stream] planPatch:", JSON.stringify(result.planPatch).slice(0, 2000));
              console.log("[goal-plan-chat/stream] existing plan year IDs:", nextPlan.years?.map(y => y.id));
              console.log("[goal-plan-chat/stream] existing plan structure:", nextPlan.years?.map(y => ({
                id: y.id,
                months: y.months?.map(m => ({
                  id: m.id,
                  weeks: m.weeks?.map(w => ({
                    id: w.id,
                    days: w.days?.map(d => ({
                      id: d.id,
                      label: d.label,
                      taskCount: d.tasks?.length ?? 0,
                    })),
                  })),
                })),
              })));
              const patched = applyPlanPatch(nextPlan, result.planPatch);
              // Log the result to confirm tasks were actually changed
              const daysBefore = nextPlan.years?.flatMap(y => y.months?.flatMap(m => m.weeks?.flatMap(w => w.days ?? []) ?? []) ?? []) ?? [];
              const daysAfter = patched.years?.flatMap(y => y.months?.flatMap(m => m.weeks?.flatMap(w => w.days ?? []) ?? []) ?? []) ?? [];
              const taskCountBefore = daysBefore.reduce((s, d) => s + (d.tasks?.length ?? 0), 0);
              const taskCountAfter = daysAfter.reduce((s, d) => s + (d.tasks?.length ?? 0), 0);
              console.log("[goal-plan-chat/stream] patch result: tasks before=%d, after=%d", taskCountBefore, taskCountAfter);
              await repos.goalPlan.replacePlan(goalId, patched);
              nextPlan = patched;
              planReplaced = true;
            } else {
              console.log("[goal-plan-chat/stream] NO PLAN CHANGE:", {
                hasPlanPatch: !!result.planPatch,
                hasNextPlan: !!nextPlan,
                planReady: result.planReady,
                hasPlan: !!result.plan,
              });
            }

            await repos.goals.upsert({
              ...goal,
              planChat: nextChat,
              plan: nextPlan,
            });
          }
        } catch (err) {
          console.warn("[ai/goal-plan-chat/stream] persist failed:", err);
        }

        try {
          emitViewInvalidate(req.userId, {
            viewKinds: planReplaced
              ? ["view:goal-plan", "view:tasks", "view:dashboard"]
              : ["view:goal-plan"],
          });
        } catch (err) {
          console.warn("[ai/goal-plan-chat/stream] invalidate failed:", err);
        }
      }

      send("done", {
        reply: extractReplyFromText(result.reply),
        planReady: result.planReady,
        plan: result.plan,
        planPatch: result.planPatch,
      });
    } catch (err) {
      send("error", {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      res.end();
    }
  }),
);
