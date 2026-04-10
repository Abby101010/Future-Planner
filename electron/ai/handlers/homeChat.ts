/* NorthStar — Home Chat handler */

import Anthropic from "@anthropic-ai/sdk";
import { getModelForTask } from "../../model-config";
import { HOME_CHAT_SYSTEM } from "../prompts";
import { personalizeSystem } from "../personalize";

export async function handleHomeChat(
  client: Anthropic,
  payload: Record<string, unknown>,
  memoryContext: string,
): Promise<unknown> {
  const userInput = payload.userInput as string;
  const chatHistory = (payload.chatHistory || []) as Array<{
    role: string;
    content: string;
  }>;
  const goals = (payload.goals || []) as Array<{
    title: string;
    scope: string;
    status: string;
  }>;
  const todayTasks = (payload.todayTasks || []) as Array<{
    title: string;
    completed: boolean;
    cognitiveWeight?: number;
    durationMinutes?: number;
  }>;
  const todayCalendarEvents = (payload.todayCalendarEvents || []) as Array<{
    title: string;
    startDate: string;
    endDate: string;
    category: string;
  }>;

  const goalsSummary =
    goals.length > 0
      ? goals.map((g) => `- ${g.title} (${g.scope}, ${g.status})`).join("\n")
      : "No goals set.";

  const tasksSummary =
    todayTasks.length > 0
      ? todayTasks
          .map(
            (t) =>
              `- [${t.completed ? "✓" : " "}] ${t.title} (weight: ${t.cognitiveWeight || 3}, ${t.durationMinutes || 30}min)`,
          )
          .join("\n")
      : "No tasks today.";

  const totalWeight = todayTasks.reduce(
    (sum, t) => sum + (t.cognitiveWeight || 3),
    0,
  );
  const totalMinutes = todayTasks.reduce(
    (sum, t) => sum + (t.durationMinutes || 30),
    0,
  );
  const completedCount = todayTasks.filter((t) => t.completed).length;
  const taskCount = todayTasks.filter((t) => !t.completed).length;

  const calendarSummary =
    todayCalendarEvents.length > 0
      ? todayCalendarEvents
          .map((e) => `- ${e.title} (${e.startDate}, ${e.category})`)
          .join("\n")
      : "No calendar events.";

  const environmentFormatted =
    (payload._environmentContextFormatted as string) || "";
  const environmentBlock = environmentFormatted
    ? `\n${environmentFormatted}\n`
    : "";

  const schedulingContextFormatted =
    (payload._schedulingContextFormatted as string) || "";
  const schedulingBlock = schedulingContextFormatted
    ? `\n${schedulingContextFormatted}\n`
    : "";

  const contextBlock = `USER CONTEXT:
${environmentBlock}${schedulingBlock}Goals:
${goalsSummary}

Today's tasks (${completedCount}/${todayTasks.length} done, ${taskCount} pending):
  Cognitive load: ${totalWeight}/12 points used
  Time committed: ${totalMinutes}/180 minutes used
  Active tasks: ${taskCount}/5 slots used
${tasksSummary}

Today's calendar:
${calendarSummary}`;

  const attachments = (payload.attachments || []) as Array<{
    type: string;
    name: string;
    base64: string;
    mediaType: string;
  }>;

  const messages = chatHistory.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  if (attachments.length > 0) {
    const contentBlocks: Array<
      | { type: "text"; text: string }
      | {
          type: "image";
          source: { type: "base64"; media_type: string; data: string };
        }
      | {
          type: "document";
          source: {
            type: "base64";
            media_type: "application/pdf";
            data: string;
          };
        }
    > = [];

    for (const att of attachments) {
      if (att.type === "image") {
        contentBlocks.push({
          type: "image",
          source: {
            type: "base64",
            media_type: att.mediaType,
            data: att.base64,
          },
        });
      } else if (att.type === "pdf") {
        contentBlocks.push({
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: att.base64,
          },
        });
      }
    }

    contentBlocks.push({ type: "text", text: userInput });
    messages.push({
      role: "user",
      content: contentBlocks as unknown as string,
    });
  } else {
    messages.push({ role: "user", content: userInput });
  }

  const response = await client.messages.create({
    model: getModelForTask("home-chat"),
    max_tokens: 512,
    system: personalizeSystem(
      `${HOME_CHAT_SYSTEM}\n\n${contextBlock}`,
      memoryContext,
    ),
    messages,
  });

  const chatText =
    response.content[0].type === "text" ? response.content[0].text : "";
  return { reply: chatText.trim() };
}
