/* ──────────────────────────────────────────────────────────
   NorthStar — Research Agent (Web Search)
   Uses Claude's built-in web_search tool to gather real-world
   data for goal planning: timelines, benchmarks, peer advice.
   
   COST CONTROL: Only invoked at two trigger points:
     1. Daily news background task (once per day)
     2. First goal setup (initial research for big goals)
   ────────────────────────────────────────────────────────── */

import Anthropic from "@anthropic-ai/sdk";
import type { ResearchResult, PeerContext, NewsBriefing, ProgressCallback } from "./types";

const MODEL = "claude-sonnet-4-6";

/** Web search tool config for Claude API */
const WEB_SEARCH_TOOL = { type: "web_search_20250305" as const, name: "web_search" as const };

/**
 * Research a goal topic — search the web for realistic timelines,
 * peer experiences, common pitfalls, and best practices.
 */
export async function researchGoal(
  client: Anthropic,
  goalTitle: string,
  goalDescription: string,
  targetDate: string,
  isHabit: boolean,
  onProgress?: ProgressCallback
): Promise<ResearchResult> {
  onProgress?.({
    agentId: "research",
    status: "searching",
    message: `Researching: "${goalTitle}"...`,
    timestamp: new Date().toISOString(),
    progress: 10,
  });

  const systemPrompt = `You are a research assistant helping someone plan their goal. 
Use the web_search tool to find real-world data about this goal domain.

RESEARCH OBJECTIVES:
1. Realistic timelines — how long does it actually take most people?
2. Common milestones and phases people go through
3. Typical mistakes beginners make
4. Best practices from people who've succeeded
5. Resources and learning paths that are highly recommended

After searching, synthesize your findings into a structured analysis.
Be honest about what's realistic. Don't sugarcoat timelines.

Respond with valid JSON:
{
  "query": "the main search topic",
  "findings": ["key insight 1", "key insight 2", ...],
  "sources": ["source description 1", ...],
  "summary": "A 2-3 paragraph synthesis of what you found, with specific numbers and timelines where possible."
}`;

  const userMessage = `Research this goal for me:
Goal: "${goalTitle}"
${goalDescription ? `Context: ${goalDescription}` : ""}
Type: ${isHabit ? "Ongoing habit" : `Goal with target date: ${targetDate || "flexible"}`}

Please search for:
1. How long it typically takes to achieve this
2. What a realistic learning/progress path looks like
3. Common pitfalls to avoid
4. Best practices from people who've done this successfully`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: systemPrompt,
    tools: [WEB_SEARCH_TOOL],
    messages: [{ role: "user", content: userMessage }],
  });

  onProgress?.({
    agentId: "research",
    status: "analyzing",
    message: "Analyzing search results...",
    timestamp: new Date().toISOString(),
    progress: 60,
  });

  // Extract text from response (may have multiple content blocks due to tool use)
  let text = "";
  for (const block of response.content) {
    if (block.type === "text") {
      text += block.text;
    }
  }

  onProgress?.({
    agentId: "research",
    status: "done",
    message: "Research complete",
    timestamp: new Date().toISOString(),
    progress: 100,
  });

  try {
    const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    return JSON.parse(cleaned) as ResearchResult;
  } catch {
    return {
      query: goalTitle,
      findings: [text.slice(0, 500)],
      sources: [],
      summary: text,
    };
  }
}

/**
 * Get peer context — what others in the same domain are doing,
 * typical progression, and community wisdom.
 */
export async function getPeerContext(
  client: Anthropic,
  goalTitle: string,
  goalDescription: string,
  onProgress?: ProgressCallback
): Promise<PeerContext> {
  onProgress?.({
    agentId: "research",
    status: "searching",
    message: `Finding peer experiences for "${goalTitle}"...`,
    timestamp: new Date().toISOString(),
    progress: 10,
  });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: `You are a research assistant. Search the web to find what peers and communities
say about pursuing this type of goal. Look for Reddit posts, forum discussions, blog posts,
and community resources. Focus on REAL experiences, not generic advice.

Respond with valid JSON:
{
  "domain": "the field/domain name",
  "insights": ["real insight from peer experiences..."],
  "typicalTimelines": "What realistic timelines look like based on peer data",
  "commonMistakes": ["mistake 1", "mistake 2"],
  "bestPractices": ["practice 1", "practice 2"]
}`,
    tools: [WEB_SEARCH_TOOL],
    messages: [{
      role: "user",
      content: `Find peer context for this goal: "${goalTitle}"
${goalDescription ? `Context: ${goalDescription}` : ""}
Search for real experiences, community discussions, and practical advice from people who've done this.`,
    }],
  });

  onProgress?.({
    agentId: "research",
    status: "done",
    message: "Peer context gathered",
    timestamp: new Date().toISOString(),
    progress: 100,
  });

  let text = "";
  for (const block of response.content) {
    if (block.type === "text") text += block.text;
  }

  try {
    const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    return JSON.parse(cleaned) as PeerContext;
  } catch {
    return {
      domain: goalTitle,
      insights: [text.slice(0, 500)],
      typicalTimelines: "Could not determine",
      commonMistakes: [],
      bestPractices: [],
    };
  }
}

/**
 * Generate a daily news digest relevant to the user's goals.
 * Called once per day as a background task.
 */
export async function generateNewsBriefing(
  client: Anthropic,
  goalTitles: string[],
  userInterests: string[],
  onProgress?: ProgressCallback
): Promise<NewsBriefing> {
  onProgress?.({
    agentId: "news",
    status: "searching",
    message: "Searching for relevant news and updates...",
    timestamp: new Date().toISOString(),
    progress: 10,
  });

  const topics = [...goalTitles, ...userInterests].join(", ");

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: `You are a news curator for a goal-tracking productivity app. Search for the latest
news, articles, and updates related to the user's goals and interests.

RULES:
- Find 3-5 relevant articles/news items from the past 24-48 hours
- Prioritize practical, actionable content over hype
- Each article needs a 1-2 sentence summary
- Explain why each article is relevant to the user's specific goals
- Include the source and URL when available

Respond with valid JSON:
{
  "date": "YYYY-MM-DD",
  "articles": [
    {
      "title": "Article title",
      "source": "Source name",
      "url": "https://...",
      "summary": "1-2 sentence summary",
      "relevance": "Why this matters for the user's goals"
    }
  ],
  "summary": "A brief overview of today's relevant news landscape",
  "relevanceNote": "Why these articles were selected based on the user's goals"
}`,
    tools: [WEB_SEARCH_TOOL],
    messages: [{
      role: "user",
      content: `Find today's most relevant news and articles for someone working on these goals/interests: ${topics}

Today's date: ${new Date().toISOString().split("T")[0]}`,
    }],
  });

  onProgress?.({
    agentId: "news",
    status: "done",
    message: "News briefing ready",
    timestamp: new Date().toISOString(),
    progress: 100,
  });

  let text = "";
  for (const block of response.content) {
    if (block.type === "text") text += block.text;
  }

  try {
    const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    return JSON.parse(cleaned) as NewsBriefing;
  } catch {
    return {
      date: new Date().toISOString().split("T")[0],
      articles: [],
      summary: text.slice(0, 500),
      relevanceNote: "Auto-generated briefing",
    };
  }
}
