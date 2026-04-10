/* NorthStar — AI IPC handlers (ai:* + ai:news-briefing) */

import { ipcMain } from "electron";
import { handleAIRequest } from "../ai-handler";
import type { RequestType } from "../ai-handler";
import { coordinateNewsBriefing } from "../agents/coordinator";
import type { AgentProgressEvent } from "../agents/types";
import { getIpcContext } from "./context";

export function registerAiIpc(): void {
  const ctx = getIpcContext();

  const makeProgressCb = () => (evt: AgentProgressEvent) => {
    ctx.getMainWindow()?.webContents.send("agent:progress", evt);
  };

  const register = (channel: string, type: RequestType) => {
    ipcMain.handle(channel, async (_event, payload) => {
      return handleAIRequest(type, payload, ctx.loadDataSync, makeProgressCb());
    });
  };

  register("ai:onboarding", "onboarding");
  register("ai:goal-breakdown", "goal-breakdown");
  register("ai:reallocate", "reallocate");
  register("ai:daily-tasks", "daily-tasks");
  register("ai:recovery", "recovery");
  register("ai:pace-check", "pace-check");
  register("ai:classify-goal", "classify-goal");
  register("ai:goal-plan-chat", "goal-plan-chat");
  register("ai:generate-goal-plan", "generate-goal-plan");
  register("ai:goal-plan-edit", "goal-plan-edit");
  register("ai:analyze-quick-task", "analyze-quick-task");
  register("ai:home-chat", "home-chat");

  // ── News Briefing (agent-powered) ───────────────────────
  ipcMain.handle("ai:news-briefing", async (_event, payload) => {
    try {
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      let apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        const data = ctx.loadDataSync();
        const user = data.user as Record<string, unknown> | undefined;
        const settings = user?.settings as
          | Record<string, unknown>
          | undefined;
        apiKey = settings?.apiKey as string | undefined;
      }
      if (!apiKey) return { ok: false, error: "No API key" };

      const client = new Anthropic({ apiKey });
      const goalTitles = (payload?.goalTitles || []) as string[];
      const userInterests = (payload?.userInterests || []) as string[];
      const result = await coordinateNewsBriefing(
        client,
        goalTitles,
        userInterests,
        makeProgressCb(),
      );
      return { ok: result.success, data: result.data };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });
}
