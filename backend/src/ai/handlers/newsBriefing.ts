/* NorthStar — News Briefing handler (sub-agent: "news")
 *
 * Generates a personalised insights feed based on the user's active
 * goals. Since the AI cannot browse the web, we frame the output as
 * curated tips, relevant knowledge, and actionable advice rather than
 * live headlines.
 */

import Anthropic from "@anthropic-ai/sdk";
import { getModelForTask } from "@northstar/core";
import { personalizeSystem } from "@northstar/core";
import { runStreamingHandler } from "../streaming";
import { emitAgentProgress } from "../../ws";
import { getCurrentUserId } from "../../middleware/requestContext";
import type { NewsBriefing } from "@northstar/core";

interface NewsBriefingPayload {
  goals: Array<{
    id: string;
    title: string;
    description?: string;
    targetDate?: string;
    isHabit?: boolean;
  }>;
  /** When set, generate a focused research briefing on this topic
   *  instead of the default goal-based insights feed. */
  topic?: string;
}

const NEWS_SYSTEM = `You are the "News & Insights" sub-agent of NorthStar, a personal goal-planning app.

Your job: generate a short, highly relevant insights feed tailored to the user's active goals.

Rules:
- Produce 4–6 items. Each item should be a practical tip, science-backed insight, motivational nudge, or actionable piece of advice directly relevant to at least one of the user's goals.
- Vary the categories — mix fitness science, psychology, productivity research, nutrition, expert advice, habit formation, industry knowledge, etc. as appropriate for the goals.
- Keep summaries concise (2–3 sentences) and action-oriented.
- The "relevance" field should explain specifically why this item matters for the user's goal.
- Write an overall "summary" (1–2 sentences) tying the feed to the user's journey.
- Write a short "relevanceNote" acknowledging which goals informed the feed.
- Do NOT invent URLs. Set "url" to "" for every item.
- Do NOT hallucinate specific studies with fake DOIs or author names. You can reference well-known general findings (e.g. "research shows…") but keep it honest.

Return ONLY valid JSON — no markdown fences, no commentary outside the JSON.`;

const RESEARCH_SYSTEM = `You are the "Research" sub-agent of NorthStar, a personal goal-planning app.

The user has asked you to research a specific topic. Your job: produce a focused, in-depth
briefing on that topic with practical, actionable insights the user can apply to their goals.

Rules:
- Produce 5–8 items. Each item should be a specific finding, technique, best practice, or
  actionable tip related to the user's research topic.
- Go deep on the topic — give real, useful knowledge, not surface-level advice.
- Each item's "source" should describe the type of knowledge (e.g., "Sports Science",
  "Cognitive Psychology", "Nutrition Research", "Industry Best Practice", "Expert Consensus").
- Keep summaries informative (2–4 sentences) and practical.
- The "relevance" field should explain how this specific finding applies to the user's situation.
- Write an overall "summary" synthesizing the key takeaways.
- Write a "relevanceNote" connecting the research to the user's goals.
- Do NOT invent URLs. Set "url" to "" for every item.
- Do NOT hallucinate specific studies with fake DOIs or author names. You can reference
  well-known general findings (e.g. "research shows…") but keep it honest.
- Be thorough and genuinely helpful — the user came here to learn.

Return ONLY valid JSON — no markdown fences, no commentary outside the JSON.`;

export async function handleNewsBriefing(
  client: Anthropic,
  payload: NewsBriefingPayload,
  memoryContext: string,
): Promise<NewsBriefing> {
  const { goals, topic } = payload;
  const userId = getCurrentUserId();
  const handlerKind = "newsBriefing";

  const isFocusedResearch = !!topic;

  emitAgentProgress(userId, {
    agentId: "news",
    phase: "running",
    message: isFocusedResearch
      ? `Researching "${topic}"…`
      : "Generating personalised insights…",
  });

  const today = new Date().toISOString().split("T")[0];
  const goalBlock = goals
    .map(
      (g) =>
        `- ${g.title}${g.description ? `: ${g.description}` : ""}${g.targetDate ? ` (target: ${g.targetDate})` : ""}${g.isHabit ? " [habit]" : ""}`,
    )
    .join("\n");

  const userPrompt = isFocusedResearch
    ? `Today is ${today}.

The user's active goals:
${goalBlock}

The user has asked you to research: "${topic}"

Generate a focused research briefing on this topic. Return JSON matching this schema exactly:
{
  "date": "${today}",
  "articles": [
    { "title": "string", "source": "string", "url": "", "summary": "string", "relevance": "string" }
  ],
  "summary": "string",
  "relevanceNote": "string"
}`
    : `Today is ${today}.

The user's active goals:
${goalBlock}

Generate a personalised insights feed. Return JSON matching this schema exactly:
{
  "date": "${today}",
  "articles": [
    { "title": "string", "source": "string", "url": "", "summary": "string", "relevance": "string" }
  ],
  "summary": "string",
  "relevanceNote": "string"
}`;

  const result = await runStreamingHandler<NewsBriefing>({
    handlerKind,
    client,
    forwardTextDeltas: false,
    createRequest: () => ({
      model: getModelForTask("news-briefing"),
      max_tokens: 2048,
      system: personalizeSystem(
        isFocusedResearch ? RESEARCH_SYSTEM : NEWS_SYSTEM,
        memoryContext,
      ),
      messages: [{ role: "user", content: userPrompt }],
    }),
    parseResult: (finalText) => {
      const cleaned = finalText
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found in AI response");
      const parsed = JSON.parse(jsonMatch[0]) as NewsBriefing;
      return {
        date: parsed.date ?? today,
        articles: parsed.articles ?? [],
        summary: parsed.summary ?? "",
        relevanceNote: parsed.relevanceNote ?? "",
      };
    },
  });

  emitAgentProgress(userId, { agentId: "news", phase: "done" });
  return result;
}
